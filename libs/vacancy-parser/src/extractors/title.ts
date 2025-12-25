import type { DocumentContext } from '../core/document-context';
import { scoreToConfidence } from '../core/scoring';
import type { ParsedTitle, Role, RuleTrace } from '../model/types';

export interface TitleExtractResult {
  title: ParsedTitle;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type CandidateSource = 'pageTitle' | 'head' | 'caps' | 'pattern';

type Candidate = {
  source: CandidateSource;
  text: string;
  section: string;
  baseScore: number;
};

type RoleRule = { role: Role; re: RegExp };

type Level = ParsedTitle['level'];

const ROLE_RULES: RoleRule[] = [
  { role: 'frontend_developer', re: /(front\s*-?end|frontend|фронт\s*-?енд|фронтенд|angular\s+developer|react\s+developer|vue\s+developer)/i },
  { role: 'backend_developer', re: /(back\s*-?end|backend|бэк\s*-?енд|бэкенд|server\s*-?side|node\.js\s+developer|nestjs\s+developer|java\s+developer|golang\s+developer|python\s+developer|php\s+developer|\.net\s+developer)/i },
  { role: 'fullstack_developer', re: /(full\s*-?stack|fullstack|фулл\s*-?стек|фуллстек)/i },
  { role: 'mobile_developer', re: /(mobile\s+developer|мобильн\w+\s+разработчик)/i },
  { role: 'ios_developer', re: /(ios\s+developer|swift\s+developer)/i },
  { role: 'android_developer', re: /(android\s+developer|kotlin\s+developer)/i },
  { role: 'qa_engineer', re: /(qa\b|quality\s+assurance|тестировщик|qa\s+engineer)/i },
  { role: 'automation_qa', re: /(automation\s+qa|qa\s+automation|автоматизац\w+\s+тестирован)/i },
  { role: 'manual_qa', re: /(manual\s+qa|ручн\w+\s+тестирован)/i },
  { role: 'devops_engineer', re: /(devops|девопс)/i },
  { role: 'sre', re: /(\bsre\b|site\s+reliability)/i },
  { role: 'data_engineer', re: /(data\s+engineer|инженер\w+\s+данных)/i },
  { role: 'data_scientist', re: /(data\s+scientist|дата\s+саентист|аналитик\w+\s+данных)/i },
  { role: 'ml_engineer', re: /(ml\s+engineer|machine\s+learning\s+engineer|инженер\w+\s+машинного\s+обучения)/i },
  { role: 'product_manager', re: /(product\s+manager|продакт\s+менеджер|менеджер\s+продукта|product\s+owner|\bpo\b)/i },
  { role: 'project_manager', re: /(project\s+manager|pm\b|проектн\w+\s+менеджер)/i },
  { role: 'business_analyst', re: /(business\s+analyst|бизнес\s*-?аналитик)/i },
  { role: 'system_analyst', re: /(system\s+analyst|системн\w+\s*-?аналитик)/i },
  { role: 'ux_ui_designer', re: /(ux\s*\/\s*ui|ux\b|ui\b|ux\s+designer|ui\s+designer|web\s*designer|веб-?дизайнер|дизайнер\w+\s+интерфейсов)/i },
  { role: 'product_designer', re: /(product\s+designer|product\s+дизайнер|продуктов\w+\s+дизайнер)/i },
  { role: 'graphic_designer', re: /(graphic\s+designer|графическ\w+\s+дизайнер|motion\s+designer|3d\s+designer|3d\s+motion\s+designer|3d-?аниматор|3d\s+аниматор|моушн\s+дизайнер)/i },
  { role: 'graphic_designer', re: /дизайнер/i },
  { role: 'support_engineer', re: /(support\s+engineer|техподдержк\w+|support)/i },
  { role: 'security_engineer', re: /(security\s+engineer|инженер\w+\s+безопасности|infosec)/i },
  { role: 'solutions_architect', re: /(solutions\s+architect|solution\s+architect)/i },
  { role: 'architect', re: /(\barchitect\b|архитектор)/i },
  { role: 'cto', re: /(\bcto\b|chief\s+technology\s+officer)/i },
  { role: 'team_lead', re: /(team\s+lead|тимлид|teamlead)/i },
  { role: 'tech_lead', re: /(tech\s+lead|техлид|techlead)/i },
  { role: 'scrum_master', re: /(scrum\s+master|скрам\s+мастер)/i },
  { role: 'hr_recruiter', re: /(recruiter|talent\s+acquisition|hr\s+manager|рекрутер)/i },
  { role: 'sales_manager', re: /(sales\s+manager|account\s+executive|account\s+manager|business\s+development|sales\b)/i },
  { role: 'marketing_manager', re: /(marketing\s+manager|digital\s+marketing|performance\s+marketing|growth\s+marketer|marketing\b)/i },
  { role: 'content_manager', re: /(content\s+manager|content\s+specialist|content\b)/i },
  { role: 'copywriter', re: /(copywriter|content\s+writer|writer\b|копирайтер)/i },
  { role: 'accountant', re: /(accountant|bookkeeper|бухгалтер)/i },
  { role: 'lawyer', re: /(lawyer|legal\s+counsel|юрист)/i },
];

const SPECIALIZATION_TOKENS: Array<{ re: RegExp; value: string }> = [
  { re: /(angular)/i, value: 'Angular' },
  { re: /(react)/i, value: 'React' },
  { re: /(vue)/i, value: 'Vue' },
  { re: /(nestjs|nest\s?js)/i, value: 'NestJS' },
  { re: /(node\.js|nodejs|\bnode\b)/i, value: 'Node.js' },
  { re: /(typescript|\bts\b)/i, value: 'TypeScript' },
  { re: /(javascript|\bjs\b)/i, value: 'JavaScript' },
  { re: /(python)/i, value: 'Python' },
  { re: /(golang|\bgo\b)/i, value: 'Go' },
  { re: /(java)/i, value: 'Java' },
  { re: /(kotlin)/i, value: 'Kotlin' },
  { re: /(swift)/i, value: 'Swift' },
  { re: /(c#|\.net|dotnet)/i, value: '.NET' },
  { re: /(php)/i, value: 'PHP' },
];

function uniq(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const key = v.trim();
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return out;
}

function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/[•·●]+/g, ' ')
    .replace(/^[-–—:\s]+/, '')
    .replace(/\s*[-–—:\s]+$/, '')
    .trim();

  const withoutPrefix = cleaned
    // common label prefixes (":" is optional, some channels write "Вакансия 100 тыс. руб.")
    .replace(/^(?:вакансия|позиция|position)(?:(?:\s+|[:\-–—]\s*))/i, '')
    .replace(/^(требуетс[яь]|требуются)\s+/i, '')
    .replace(/^we\s+are\s+looking\s+for\s+/i, '')
    .replace(/^we\s+need\s+/i, '')
    .replace(/^looking\s+for\s+/i, '')
    .replace(/^ищем\s+/i, '')
    .replace(/^мы\s+ищем\s+/i, '')
    .replace(/^нам\s+нужн(?:а|о|ы)\s+/i, '')
    .trim();

  // Remove leading hashtags often used in Telegram posts: "#вакансия #ищу ..."
  // Some channels prepend lots of tags; we strip up to 30.
  const withoutLeadingTags = withoutPrefix
    // leading bracket tags like "(#Москва)" / "(Москва)"
    .replace(/^(?:\(\s*#?[A-Za-zА-Яа-яЁё0-9_-]{2,30}\s*\)\s*){1,5}/, '')
    // leading hashtags
    .replace(/^(?:#\S+\s*){1,30}/, '')
    .trim();

  // Normalize glued boundaries (mostly Cyrillic) inside a single line title candidate.
  const deglued = withoutLeadingTags.replace(/([а-яё])([А-ЯЁ])/g, '$1 $2');

  // Some sources start with non-title blocks (scraping artifacts).
  if (/^(описание\s+(?:вакансии|стажировки)\s*:)/i.test(deglued)) {
    return '';
  }
  if (/^(source|источник|канал|channel)\s*[:\-]/i.test(deglued)) {
    return '';
  }
  // Obvious non-vacancy promo posts in job channels.
  if (/^(последн(ее|яя)\s+спецпредложение|анонсируем\s+акцию|акци[яи]\b|промокод\b)/i.test(deglued)) {
    return '';
  }

  // Remove URLs/emails from title candidates to avoid rejecting valid titles
  // (title is often followed by "(https://...)" in glued text).
  const withoutLinks = deglued
    .replace(/\(\s*https?:\/\/[^\s)]+\s*\)/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '')
    .replace(/\(\s*\)/g, '')
    // remove inline hashtags inside titles: "#менеджер" -> "менеджер"
    .replace(/#([A-Za-zА-Яа-яЁё0-9_+-]{2,})/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove leading salary label fragments that appear BEFORE the role.
  // Example: "+/- 100 тыс. руб. Контент-менеджер ..." -> "Контент-менеджер ..."
  const leadingSalaryLabelRe =
    /^(?:\+\/-|\+|-)?\s*\d{1,3}(?:[ \t.,'’]\d{3})*\s*(?:тыс\.?)?\s*(?:₽|руб\.?|rub|usd|eur|gbp|chf|pln|sek|nok|dkk|ron|bgn|\$|€|£)\.?\s*/i;
  const leadingSalaryM = leadingSalaryLabelRe.exec(withoutLinks);
  const withoutLeadingSalaryLabel =
    leadingSalaryM && leadingSalaryM.index === 0 ? withoutLinks.slice(leadingSalaryM[0].length).trim() : withoutLinks;

  // Cut off inline salary part if it is glued to the title (e.g. "Junior веб-дизайнер90 000 RUB...")
  // Also support amounts starting with 1 digit when using thousand groups: "1 500 $" / "1.800 €"
  const inlineSalaryRe =
    /\b(?:от\s*)?\d{1,3}(?:[ \t.,'’]\d{3})+(?:\s*(?:до|–|—|-|to)\s*\d{1,3}(?:[ \t.,'’]\d{3})+)?\s*(?:₽|RUB|USD|EUR|GBP|CHF|SEK|NOK|DKK|PLN|RON|BGN|\$|€|£)\b/i;
  const salaryM = inlineSalaryRe.exec(withoutLeadingSalaryLabel);
  const withoutInlineSalary = (() => {
    if (!salaryM || salaryM.index === undefined) {
      return withoutLeadingSalaryLabel;
    }
    // Salary at the very beginning is often a label before the role ("Вакансия 100 тыс. руб. Контент-менеджер").
    // In such cases we want to REMOVE the salary chunk and keep the rest.
    if (salaryM.index <= 12) {
      const before = withoutLeadingSalaryLabel.slice(0, salaryM.index);
      const after = withoutLeadingSalaryLabel.slice(salaryM.index + salaryM[0].length);
      return `${before} ${after}`.replace(/\s+/g, ' ').trim();
    }
    // Otherwise treat it as a suffix glued to title and cut it off.
    return withoutLeadingSalaryLabel.slice(0, salaryM.index).trim();
  })();

  // Also cut common "100 тыс. руб." inline salary fragments.
  const inlineSalaryShortRe =
    /(?:\+\/-|\+|-)?\s*\d{1,3}(?:[ \t.,'’]\d{3})*\s*(?:тыс\.?|k)\s*(?:₽|руб\.?|rub|usd|eur|gbp|chf|pln|sek|nok|dkk|ron|bgn|\$|€|£)\b/i;
  const shortSalaryM = inlineSalaryShortRe.exec(withoutInlineSalary);
  const withoutInlineSalary2 = (() => {
    if (!shortSalaryM || shortSalaryM.index === undefined) {
      return withoutInlineSalary;
    }
    if (shortSalaryM.index <= 12) {
      const before = withoutInlineSalary.slice(0, shortSalaryM.index);
      const after = withoutInlineSalary.slice(shortSalaryM.index + shortSalaryM[0].length);
      return `${before} ${after}`.replace(/\s+/g, ' ').trim();
    }
    return withoutInlineSalary.slice(0, shortSalaryM.index).trim();
  })();

  // Cut plain amounts (with thousand groups) even if currency is missing in the title line.
  // Example: "Рекрутер 10 000" / "Node js2 000" -> drop the amount part.
  const inlineAmountRe = /\b\d{1,3}(?:[ \t.,'’]\d{3})+\b/;
  const amountM = inlineAmountRe.exec(withoutInlineSalary2);
  const withoutInlineAmount = (() => {
    if (!amountM || amountM.index === undefined) {
      return withoutInlineSalary2;
    }
    if (amountM.index <= 12) {
      const before = withoutInlineSalary2.slice(0, amountM.index);
      const after = withoutInlineSalary2.slice(amountM.index + amountM[0].length);
      return `${before} ${after}`.replace(/\s+/g, ' ').trim();
    }
    return withoutInlineSalary2.slice(0, amountM.index).trim();
  })();
  const withoutInlineAmount2 = withoutInlineAmount.replace(/(?:^|\s)(?:от|до|from|to)\s*$/i, '').trim();

  // Cut off common inline blocks that are often glued to the title (scraping artifacts)
  const stopRe =
    /(компания\s*:|компания\s+|company\s*:|company\s+|salary\s*:|compensation\s*:|заработн\w*\s*плат\w*|зарплат\w*|зп\s*:|оплата\s*:|формат\s*работ\w*|location\s*:|локац\w*\s*:|помога(?:ем|ют)\s+с\s+релокац\w*|help\w*\s+with\s+relocat\w*|relocat\w*\s+(?:package|support|assistance)|опыт\s+работы\s*:|график\s*:|рабочие\s+часы\s*:|выплаты\s*:|(?:^|\s)ип\s+[А-ЯЁ]|(?:^|\s)г\.?\s*[А-ЯЁ]|кто\s+мы\s*:|кого\s+мы\s+ищем(?:\s+и\s+почему)?\s*:|чем\s+вы\s+будете\s+заниматься\s*:|ключевые\s+навыки\s*:|хотите\s+к\s+нам\?\s*:|какие\s+задачи|мы\s+жд[её]м|что\s+мы\s+предлагаем|как\s+все\s+устроено|о\s+проекте\s*:|about\s+the\s+project\s*:|(?:^|\s)от\s+\d|from\s+\d|требовани\w*|обязанност\w*|requirements\b|responsibilities\b|benefits\b|описани[ея]\s*:|отклик\s*:|откликнутьс[яь]\b|apply\b|задача\s*:|задачи\s*:|с\s+опытом|with\s+experience|(?:австрийск|немецк|французск|итальянск|испанск|польск|британск|американск|швейцарск)[А-Яа-яЁё]+\s+(?:премиальн[А-Яа-яЁё]+\s+)?(?:бренд|компания|студия|agency|brand|startup))/i;
  const m = stopRe.exec(withoutInlineAmount2);
  const sliced = m && m.index > 0 ? withoutInlineAmount2.slice(0, m.index).trim() : withoutInlineAmount2;

  // Cut at common separators between title and company/description.
  const sepRe = /(\s[-–—]\s|\s\|\s)/;
  const sepIdx = sliced.search(sepRe);
  const maybeShortRaw = sepIdx > 10 ? sliced.slice(0, sepIdx).trim() : sliced;
  const maybeShort = maybeShortRaw.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, '').trim();

  // If it's still a long sentence, keep only the first clause.
  const firstClause = (() => {
    const v = maybeShort.trim();
    if (v.length <= 80) {
      return v;
    }
    const commaIdx = v.indexOf(',');
    if (commaIdx > 10) {
      return v.slice(0, commaIdx).trim();
    }
    const dotIdx = v.indexOf('.');
    if (dotIdx > 10) {
      return v.slice(0, dotIdx).trim();
    }
    const dashIdx = v.search(/\s[-–—]\s/);
    if (dashIdx > 10) {
      return v.slice(0, dashIdx).trim();
    }
    return v;
  })();

  // Hard limit to avoid returning whole vacancy text as title.
  return (firstClause.length > 100 ? firstClause.slice(0, 100) : firstClause).trim();
}

function isAllCapsLike(text: string): boolean {
  const letters: string[] = text.match(/[A-Za-zА-Яа-яЁё]/g) ?? [];
  if (letters.length < 6) {
    return false;
  }
  const upper = letters.filter((c) => c === c.toUpperCase()).length;
  return upper / letters.length >= 0.85;
}

function looksLikeTitle(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  // Work format / schedule lines are often present in the first lines and can win by score.
  // Example: "Удаленка, парт-тайм" should NOT be treated as a job title.
  const workFormatTokensRe =
    /(удал[её]нк[\p{L}]*(?:а|о|е)?|удал[её]нно|remote|remotely|hybrid|onsite|on[-\s]*site|office|в\s+офисе|офис|part[-\s]*time|full[-\s]*time|парт[-\s]*тайм|фулл[-\s]*тайм|частичн[\p{L}]*\s+занятост[\p{L}]*|полн[\p{L}]*\s+занятост[\p{L}]*)/giu;
  const leftovers = t
    .toLowerCase()
    .replace(workFormatTokensRe, ' ')
    .replace(/[^a-zа-яё]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!leftovers) {
    return false;
  }
  if (t.length > 140) {
    return false;
  }
  // Not a title: metadata lines from scrapers/feeds.
  if (/^(source|источник|канал|channel)\s*[:\-]/i.test(t)) {
    return false;
  }
  if (/\b(requirements|responsibilities|обязанности|требования)\b/i.test(t)) {
    return false;
  }
  if (/\b(кто\s+мы|кого\s+мы\s+ищем|чем\s+вы\s+будете\s+заниматься|ключевые\s+навыки)\b/i.test(t)) {
    return false;
  }
  if (/https?:\/\//i.test(t)) {
    return false;
  }
  if (/\d{2,}\s*(?:₽|\$|€|usd|eur|rub|k|тыс)/i.test(t)) {
    // likely salary line
    return false;
  }
  return true;
}

function detectLevel(text: string): Level {
  const v = text.toLowerCase();
  if (/intern|internship|стаж(е|ё)р|стажировк/.test(v)) {
    return 'intern';
  }
  if (/junior|\bjr\b|джун/.test(v)) {
    return 'junior';
  }
  if (/middle|mid\b|мидл?/.test(v)) {
    return 'middle';
  }
  if (/senior|\bsr\b|сеньор|старш(ий|ая)/.test(v)) {
    return 'senior';
  }
  if (/lead|leading|лид|руководител/.test(v)) {
    return 'lead';
  }
  if (/principal|staff/.test(v)) {
    return 'principal';
  }
  return 'unknown';
}

function detectRole(text: string): { role: Role; ruleId: string | null } {
  for (const rr of ROLE_RULES) {
    if (rr.re.test(text)) {
      return { role: rr.role, ruleId: `role:${rr.role}` };
    }
  }
  return { role: 'unknown', ruleId: null };
}

function detectSpecialization(text: string): string[] {
  const out: string[] = [];
  for (const t of SPECIALIZATION_TOKENS) {
    if (t.re.test(text)) {
      out.push(t.value);
    }
  }
  return uniq(out);
}

function extractPatternCandidates(lines: string[]): Candidate[] {
  const out: Candidate[] = [];
  const patterns: RegExp[] = [
    /^\s*(?:вакансия|позиция)\s*[:\-]\s*(.+)$/i,
    /^\s*(?:position)\s*[:\-]\s*(.+)$/i,
    /^\s*(?:we\s+are\s+looking\s+for)\s+(.+)$/i,
    /^\s*(?:we\s+need)\s+(.+)$/i,
    /^\s*(?:looking\s+for)\s+(.+)$/i,
    // IMPORTANT: anchor to line start to avoid matching inside phrases like "Кого мы ищем..."
    /^\s*(?:ищем)\s+(.+)$/i,
    /^\s*(?:мы\s+ищем)\s+(.+)$/i,
    /^\s*(?:требуетс[яь])\s+(.+)$/i,
    /^\s*(?:требуются)\s+(.+)$/i,
    /^\s*(?:нужен|нужна|нужны)\s+(.+)$/i,
  ];
  for (const line of lines.slice(0, 20)) {
    for (const p of patterns) {
      const m = p.exec(line);
      if (!m) {
        continue;
      }
      const tail = m[m.length - 1];
      const cleaned = cleanTitle(tail);
      if (!cleaned) {
        continue;
      }
      out.push({ source: 'pattern', text: cleaned, section: 'head', baseScore: 3 });
    }
  }
  return out;
}

function buildCandidates(ctx: DocumentContext): Candidate[] {
  const candidates: Candidate[] = [];

  const pageTitle = ctx.pageTitle?.trim() ?? '';
  if (pageTitle) {
    candidates.push({ source: 'pageTitle', text: cleanTitle(pageTitle), section: 'head', baseScore: 3 });
  }

  const head = ctx.headLines.slice(0, 2);
  for (const line of head) {
    const cleaned = cleanTitle(line);
    if (!cleaned) {
      continue;
    }
    candidates.push({ source: 'head', text: cleaned, section: 'head', baseScore: 2 });
  }

  for (const line of ctx.headLines.slice(0, 10)) {
    const cleaned = cleanTitle(line);
    if (!cleaned) {
      continue;
    }
    if (isAllCapsLike(cleaned)) {
      candidates.push({ source: 'caps', text: cleaned, section: 'head', baseScore: 2 });
    }
  }

  candidates.push(...extractPatternCandidates(ctx.headLines));

  // de-dup by text
  const uniqOut: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = c.text.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqOut.push(c);
  }

  return uniqOut;
}

function scoreCandidate(c: Candidate): { score: number; role: Role; roleRuleId: string | null; level: Level; specialization: string[]; warnings: string[] } {
  const warnings: string[] = [];
  let score = c.baseScore;

  const text = c.text;

  if (looksLikeTitle(text)) {
    score += 1;
  }

  if (text.length > 90) {
    score -= 1;
  }

  if (/\b(requirements|responsibilities|обязанности|требования)\b/i.test(text)) {
    score -= 2;
    warnings.push('title_looks_like_section');
  }

  const roleRes = detectRole(text);
  const role = roleRes.role;
  const roleRuleId = roleRes.ruleId;
  if (role !== 'unknown') {
    score += 2;
  }

  const level = detectLevel(text);
  if (level !== 'unknown') {
    score += 1;
  }

  const specialization = detectSpecialization(text);
  if (specialization.length > 0) {
    score += 1;
  }

  return { score, role, roleRuleId, level, specialization, warnings };
}

export function extractTitle(
  ctx: DocumentContext,
  opts: { strict: boolean; enableTraces: boolean },
): TitleExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const candidates = buildCandidates(ctx);
  if (candidates.length === 0) {
    warnings.push('title_not_found');
    return {
      title: { value: null, role: 'unknown', level: 'unknown', specialization: [], raw: null },
      confidence: 0,
      warnings,
      traces,
    };
  }

  const scored = candidates
    .map((c) => {
      const s = scoreCandidate(c);
      return { c, ...s };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  const confidence = scoreToConfidence(best.score, opts.strict);

  // Strict mode should still allow short, well-formed titles without strong role signals.
  const minConfidence = opts.strict ? 0.55 : 0.45;

  let value: string | null = cleanTitle(best.c.text);
  if (!looksLikeTitle(value)) {
    warnings.push('title_low_confidence');
    value = null;
  } else if (confidence < minConfidence) {
    // If it still looks like a title, keep it for UX, but surface low confidence.
    // This improves coverage on short non-IT roles (e.g. "Designer", "Account Executive").
    warnings.push('title_low_confidence');
  }

  if (best.warnings.length > 0) {
    warnings.push(...best.warnings);
  }

  const title: ParsedTitle = {
    value,
    role: best.role,
    level: best.level,
    specialization: best.specialization,
    raw: best.c.text,
  };

  if (opts.enableTraces) {
    for (const item of scored.slice(0, 5)) {
      traces.push({
        extractor: 'title',
        ruleId: `candidate:${item.c.source}`,
        section: item.c.section,
        snippet: item.c.text,
        scoreDelta: item.score,
      });
      if (item.roleRuleId) {
        traces.push({
          extractor: 'title',
          ruleId: item.roleRuleId,
          section: item.c.section,
          snippet: item.c.text,
          scoreDelta: 2,
        });
      }
    }
  }

  return { title, confidence, warnings, traces };
}
