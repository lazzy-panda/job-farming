import type { DocumentContext } from '../core/document-context';
import type { ParsedCompany, RuleTrace } from '../model/types';

export interface CompanyExtractResult {
  company: ParsedCompany;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

function cleanName(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:\s]+/, '')
    .replace(/\s*[-–—:\s]+$/, '')
    .trim();
}

function cutCompanyTail(raw: string): string {
  const v = raw.trim();
  if (!v) {
    return '';
  }
  // Cut common glued blocks after company name.
  // NOTE: do not use \\b with Cyrillic (JS word boundary is ASCII-ish)
  const stopRe =
    /(?:^|[^\p{L}])(?:локац[\p{L}]*|location|формат[\p{L}]*|format|salary|compensation|заработн[\p{L}]*|зарплат[\p{L}]*|зп|оплата|requirements|responsibilities|benefits|требовани[\p{L}]*|обязанност[\p{L}]*|услови[\p{L}]*)\s*[:\-–—]/iu;
  const m = stopRe.exec(v);
  const sliced = m && m.index > 1 ? v.slice(0, m.index).trim() : v;
  // Also cut at common separators.
  const sepIdx = sliced.search(/\s[|•·]\s|\s[-–—]\s/);
  return (sepIdx > 1 ? sliced.slice(0, sepIdx) : sliced).trim();
}

function isPlausibleCompanyName(name: string): boolean {
  const v = name.trim();
  if (!v) {
    return false;
  }
  if (v.length < 2 || v.length > 80) {
    return false;
  }
  // Not a section header / obvious non-company.
  if (/\b(requirements|responsibilities|benefits|обязанности|требования|условия|контакты)\b/i.test(v)) {
    return false;
  }
  if (/^(remote|hybrid|onsite|офис|удал[её]н)/i.test(v)) {
    return false;
  }
  if (/https?:\/\//i.test(v)) {
    return false;
  }
  return true;
}

export function extractCompany(ctx: DocumentContext, opts: { enableTraces: boolean }): CompanyExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const candidates: Array<{ source: string; text: string }> = [];
  const pageTitle = (ctx.pageTitle ?? '').trim();
  if (pageTitle) {
    candidates.push({ source: 'pageTitle', text: pageTitle });
  }
  if (ctx.headLines.length) {
    candidates.push({ source: 'head', text: ctx.headLines.slice(0, 6).join('\n') });
  }
  candidates.push({ source: 'body', text: ctx.normalizedText });

  const patterns: Array<{ ruleId: string; re: RegExp; group: number }> = [
    // Explicit labels anywhere in the line (not only at line start).
    { ruleId: 'company:ru:label', re: /(?:компания|работодатель)\s*[:\-–—]\s*([^\n]{2,120})/i, group: 1 },
    { ruleId: 'company:en:label', re: /(?:company|employer)\s*[:\-–—]\s*([^\n]{2,120})/i, group: 1 },
    // Russian "в <Company>:" patterns in titles (common in posts: "Product Manager ... в AIBY:")
    { ruleId: 'company:ru:in', re: /(?:^|[^A-Za-zА-Яа-яЁё])в\s+([A-Z][A-Za-z0-9&'.-]{2,60})\s*[:\-–—]/, group: 1 },
    // English "at <Company>:" patterns
    { ruleId: 'company:en:at', re: /(?:^|[^A-Za-zА-Яа-яЁё])at\s+([A-Z][A-Za-z0-9&'.-]{2,60})\s*[:\-–—]/i, group: 1 },
    { ruleId: 'company:ooo', re: /(ООО\s+"?[A-Za-zА-Яа-яЁё0-9 ._-]{2,60}"?)/, group: 1 },
    // Company with legal suffix (LTD, LLC, INC, Corp, GmbH) - может быть слипшимся с названием должности
    // Ищем паттерн: "AnalystSTARTRIBE LTD" или "Analyst STARTRIBE LTD"
    // Важно: ищем название компании ПЕРЕД суффиксом, даже если оно слиплось с должностью
    { ruleId: 'company:ltd', re: /([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9\s&'.-]{2,50})\s*(?:LTD|LLC|INC|Corp|Corporation|GmbH)\b/i, group: 1 },
    // Слипшееся название компании после должности (например, "AnalystSTARTRIBE LTD" или "Finance / Data AnalystSTARTRIBE LTD")
    // Паттерн: строчные/цифры/пробелы/слэши, затем заглавные буквы (название компании), затем LTD/LLC или запятая/двоеточие
    // Пример: "Finance / Data AnalystSTARTRIBE LTD" -> захватывает "STARTRIBE"
    { ruleId: 'company:glued', re: /[a-zа-яё0-9\s/&-]+([A-ZА-ЯЁ][A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9\s&'.-]{2,40})(?:\s*(?:LTD|LLC|INC|Corp|GmbH)\b|\s*[,:])/i, group: 1 },
    // Слипшееся название компании без суффикса (например, "данныхITea" или "СербияITea")
    // Паттерн: кириллическая/строчная буква + заглавная латинская буква (название компании)
    // Пример: "Специалист по сверке данныхITea" -> захватывает "ITea"
    { ruleId: 'company:glued_no_suffix', re: /([а-яёА-ЯЁ0-9\s,/-]+)([A-Z][A-Za-z0-9]{2,30})(?=\s|$|,|:|\n)/, group: 2 },
  ];

  for (const c of candidates) {
    const text = c.text;
    if (!text) {
      continue;
    }
    for (const p of patterns) {
      const m = p.re.exec(text);
      if (!m) {
        continue;
      }
      let picked = m[p.group] ?? '';
      
      // Для слипшихся названий компаний (ruleId: 'company:glued' или 'company:glued_no_suffix') нужно дополнительно очистить
      if (p.ruleId === 'company:glued' || p.ruleId === 'company:glued_no_suffix') {
        // Убираем возможные префиксы перед названием компании
        picked = picked.replace(/^(?:в|at|from|из)\s+/i, '').trim();
      }
      
      const raw = cleanName(cutCompanyTail(picked));
      if (!isPlausibleCompanyName(raw)) {
        continue;
      }
      
      // Для слипшихся названий проверяем, что это действительно название компании
      // (начинается с заглавных букв, не слишком короткое)
      if ((p.ruleId === 'company:glued' || p.ruleId === 'company:glued_no_suffix') && (!/^[A-ZА-ЯЁ]/.test(raw) || raw.length < 2)) {
        continue;
      }
      
      // Для склеенных названий без суффикса дополнительная проверка: не должно быть валидным токеном
      if (p.ruleId === 'company:glued_no_suffix') {
        // Исключаем валидные токены (B2B, iOS, API и т.д.)
        if (/^(B2B|3D|C4D|iOS|iPad|iPhone|macOS|tvOS|watchOS|API|URL|HTTP|HTTPS|CSS|HTML|XML|JSON|PDF|JPG|PNG|GIF|SVG|MP4|AVI|MOV|RS|UK|US|EU|DE|FR|IT|ES|PT|NL|BE|AT|CH|SE|NO|DK|FI|PL|CZ|HU|RO|BG|GR|CY|IE|IS|LV|LT|EE|SK|SI|HR|UA|BY|KZ|GE|AM|AZ|TR|IL|AE|SA|QA|KW|BH|OM|CN|JP|KR|IN|SG|TH|VN|PH|ID|MY|TW|HK)$/i.test(raw)) {
          continue;
        }
        // Проверяем, что это не короткий код страны (1-3 буквы) в начале текста
        if (/^[A-Z]{1,3}$/.test(raw) && picked.length < 15) {
          continue;
        }
      }
      
      if (opts.enableTraces) {
        traces.push({
          extractor: 'company',
          ruleId: p.ruleId,
          section: c.source,
          snippet: raw,
          scoreDelta: p.ruleId === 'company:glued' ? 2 : 3, // Немного ниже confidence для слипшихся
        });
      }
      const confidence = (p.ruleId === 'company:glued' || p.ruleId === 'company:glued_no_suffix') ? 0.6 : 0.75;
      return { company: { name: raw }, confidence, warnings, traces };
    }
  }

  warnings.push('company_not_found');
  return { company: { name: null }, confidence: 0, warnings, traces };
}
