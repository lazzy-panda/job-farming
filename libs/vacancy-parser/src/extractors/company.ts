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
      const picked = m[p.group] ?? '';
      const raw = cleanName(cutCompanyTail(picked));
      if (!isPlausibleCompanyName(raw)) {
        continue;
      }
      if (opts.enableTraces) {
        traces.push({
          extractor: 'company',
          ruleId: p.ruleId,
          section: c.source,
          snippet: raw,
          scoreDelta: 3,
        });
      }
      return { company: { name: raw }, confidence: 0.75, warnings, traces };
    }
  }

  warnings.push('company_not_found');
  return { company: { name: null }, confidence: 0, warnings, traces };
}
