import type { DocumentContext } from '../core/document-context';
import type {
  MoneyCurrency,
  MoneyPeriod,
  ParsedSalary,
  RuleTrace,
  SalaryType,
} from '../model/types';

export interface SalaryExtractResult {
  salary: ParsedSalary;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type CurrencyHit = { currency: MoneyCurrency; raw: string };

type AmountHit = {
  min: number | null;
  max: number | null;
  raw: string;
  currency: MoneyCurrency;
  period: MoneyPeriod;
  salaryType: SalaryType;
  score: number;
};

const CURRENCY_CODES: Array<{ re: RegExp; currency: MoneyCurrency }> = [
  { re: /\bRUB\b|\bRUR\b|₽|руб(?:\.|ля|лей|ли)?/i, currency: 'RUB' },
  { re: /\bUSD\b|\$|доллар(?:ов|а|ы)?/i, currency: 'USD' },
  { re: /\bEUR\b|€|евро/i, currency: 'EUR' },
  { re: /\bGBP\b|£/i, currency: 'GBP' },
  { re: /\bCHF\b|fr\./i, currency: 'CHF' },
  { re: /\bSEK\b/i, currency: 'SEK' },
  { re: /\bNOK\b/i, currency: 'NOK' },
  { re: /\bDKK\b/i, currency: 'DKK' },
  { re: /\bCZK\b/i, currency: 'CZK' },
  { re: /\bHUF\b/i, currency: 'HUF' },
  { re: /\bUAH\b|₴/i, currency: 'UAH' },
  { re: /\bKZT\b|₸/i, currency: 'KZT' },
  { re: /\bBYN\b/i, currency: 'BYN' },
  { re: /\bPLN\b|zł/i, currency: 'PLN' },
  { re: /\bRON\b|\blei\b/i, currency: 'RON' },
  { re: /\bBGN\b|\bлв\b|\blev\b/i, currency: 'BGN' },
  { re: /\bTRY\b|₺/i, currency: 'TRY' },
];

function normalizeCountryCode(input: string | null): string | null {
  const v = (input ?? '').trim().toUpperCase();
  if (!v) {
    return null;
  }
  // Common forms: "SE", "SWE", "Sweden"
  if (v === 'SWE' || v === 'SWEDEN') return 'SE';
  if (v === 'NOR' || v === 'NORWAY') return 'NO';
  if (v === 'DNK' || v === 'DENMARK') return 'DK';
  if (v === 'GBR' || v === 'UK') return 'GB';
  if (v === 'USA') return 'US';
  return v;
}

function detectCurrency(text: string, defaultCountryHint: string | null): CurrencyHit | null {
  for (const c of CURRENCY_CODES) {
    const m = c.re.exec(text);
    if (m) {
      return { currency: c.currency, raw: m[0] };
    }
  }

  // "kr" is common across Sweden/Norway/Denmark; map it only with a country hint.
  const mKr = /\bkr\b/i.exec(text);
  if (mKr) {
    const cc = normalizeCountryCode(defaultCountryHint);
    if (cc === 'SE') return { currency: 'SEK', raw: mKr[0] };
    if (cc === 'NO') return { currency: 'NOK', raw: mKr[0] };
    if (cc === 'DK') return { currency: 'DKK', raw: mKr[0] };
    return { currency: 'UNKNOWN', raw: mKr[0] };
  }

  return null;
}

function detectPeriod(text: string): MoneyPeriod {
  const v = text.toLowerCase();
  if (/\bper\s*hour\b|\b\/\s*h\b|\b\/\s*hour\b|\bчас\b|\bв\s*час\b|\bчасов\b/.test(v)) {
    return 'hour';
  }
  if (/\bper\s*day\b|\b\/\s*d\b|\b\/\s*day\b|\bдень\b|\bв\s*день\b/.test(v)) {
    return 'day';
  }
  if (/\bper\s*week\b|\b\/\s*w\b|\b\/\s*week\b|\bнедел\b|\bв\s*недел\b/.test(v)) {
    return 'week';
  }
  if (/\bper\s*year\b|\b\/\s*y\b|\b\/\s*year\b|\bгод\b|\bв\s*год\b|\byearly\b|\bannual\b|\bper\s*annum\b|\bp\.?a\.?\b|\bpa\b|\bote\b|on-?target/.test(v)) {
    return 'year';
  }
  if (/\bproject\b|\bза\s*проект\b/.test(v)) {
    return 'project';
  }
  if (/\bpro\s*jahr\b|\bper\s*jahr\b|\bper\s*anno\b|\b jährlich\b/.test(v)) {
    return 'year';
  }
  // default assumption for vacancies
  return 'month';
}

function hasSalarySignal(text: string): boolean {
  const v = text.toLowerCase();
  // Keep this EN-focused: this signal is used in scoring and false-positive guards.
  // RU salary parsing is primarily number-driven; adding RU here inflates confidence across many fixtures.
  return /\bsalary\b|\bcompensation\b|\bpay\b|\brate\b|\bremuneration\b|\bbase\b|\btotal\s+comp\b|\bote\b|on-?target/.test(v);
}

function hasSalarySignalAny(text: string): boolean {
  const v = text.toLowerCase();
  return hasSalarySignal(v) || /зарплат|зп\b|оклад|оплат[аы]|вознагражден/.test(v);
}

function looksLikeYearAmount(min: number | null, max: number | null, text: string): boolean {
  if (min === null && max === null) {
    return false;
  }
  const a = min ?? max ?? null;
  const b = max ?? min ?? null;
  if (a === null || b === null) {
    return false;
  }
  const y1 = a >= 1900 && a <= 2100;
  const y2 = b >= 1900 && b <= 2100;
  if (!y1 || !y2) {
    return false;
  }
  const v = text.toLowerCase();
  // Typical non-salary patterns: "since 2013", "founded in 2013", "с 2013 года"
  if (/\bsince\s+\d{4}\b|\bfounded\b|\bestablished\b|\bс\s*\d{4}\s*года\b|\bс\s*\d{4}\b/.test(v)) {
    return true;
  }
  // If no explicit salary signal, treat year-like numbers as non-salary.
  return !hasSalarySignal(v);
}

function detectSalaryType(text: string): SalaryType {
  const v = text.toLowerCase();
  if (/\bnet\b|на\s*руки|после\s*налогов/.test(v)) {
    return 'net';
  }
  if (/\bgross\b|до\s*налогов|before\s*tax/.test(v)) {
    return 'gross';
  }
  return 'unknown';
}

function isAntiPattern(text: string): boolean {
  const v = text.toLowerCase();

  // experience
  if (/\b(years?|yrs?)\b|\bлет\b\s*опыт|\bопыт\b|\bexperience\b/.test(v)) {
    return true;
  }

  // schedule time like 9-18 / 9:00-18:00
  if (/\b\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}\b/.test(v)) {
    return true;
  }
  if (/\b\d{1,2}\s*[-–]\s*\d{1,2}\b/.test(v) && /\b(раб|work|office|график|schedule|часов)\b/.test(v)) {
    return true;
  }

  // percent
  if (/\b\d{1,3}\s*[-–]\s*\d{1,3}\s*%\b|\b\d{1,3}\s*%\b/.test(v)) {
    return true;
  }

  // dates like 2024-2025
  if (/\b20\d{2}\s*[-–]\s*20\d{2}\b/.test(v)) {
    return true;
  }

  // bonus / referral amounts (avoid common false positives)
  if (/\bbonus\b|\bбонус\b|\breferral\b|\bреферал\b|\b401k\b|\bpto\b/.test(v)) {
    // If there is a clear salary/compensation signal, do not discard the window.
    // This keeps "Base $120k + OTE $150k + 401k" parsable while still filtering "bonus 100$".
    if (!hasSalarySignal(v)) {
      return true;
    }
  }

  if (/\bmitarbeit\w*|\bemployees?\b|\bstaff\b|\bколлег|\bсотрудник|\bpeople\b/.test(v) && !hasSalarySignal(v)) {
    return true;
  }

  return false;
}

function parseAmount(raw: string): number | null {
  const compact = raw.replace(/\s+/g, '').replace(/[^0-9,\.]/g, '');

  if (!compact) {
    return null;
  }

  // Handle EU (1.200,50) vs US (1,200.50)
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  const hasComma = lastComma >= 0;
  const hasDot = lastDot >= 0;

  let normalized = compact;
  if (hasComma && hasDot) {
    const commaIsDecimal = lastComma > lastDot;
    normalized = commaIsDecimal ? compact.replace(/\./g, '').replace(/,/g, '.') : compact.replace(/,/g, '');
  } else if (hasComma && !hasDot) {
    const tail = compact.slice(lastComma + 1);
    normalized = tail.length <= 2 ? compact.replace(/,/g, '.') : compact.replace(/,/g, '');
  } else if (!hasComma && hasDot) {
    // EU thousand separator (65.000) vs decimal (65.5)
    const tail = compact.slice(lastDot + 1);
    const hasThousandGroups = /\.\d{3}(\.|$)/.test(compact);
    normalized = (tail.length === 3 && hasThousandGroups) ? compact.replace(/\./g, '') : compact;
  }
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num;
}

function applyMultiplier(amount: number | null, raw: string): number | null {
  if (amount === null) {
    return null;
  }
  const v = raw.toLowerCase();
  if (/\bк\b|\bk\b/.test(v)) {
    return Math.round(amount * 1000);
  }
  if (/тыс|тысяч/.test(v)) {
    return Math.round(amount * 1000);
  }
  return Math.round(amount);
}

function clampReasonable(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value > 10_000_000) {
    return null;
  }
  return value;
}

function applyFloorByPeriod(value: number | null, period: MoneyPeriod): number | null {
  if (value === null) {
    return null;
  }

  const floors: Record<MoneyPeriod, number> = {
    hour: 5,
    day: 50,
    week: 100,
    month: 200,
    year: 5000,
    project: 50,
    unknown: 50,
  };

  const floor = floors[period] ?? 50;
  return value < floor ? null : value;
}

function baseScore(sectionName: string): number {
  // head / benefits usually more trustworthy for compensation info
  if (sectionName === 'head') {
    return 3;
  }
  if (sectionName === 'benefits') {
    return 2;
  }
  if (sectionName === 'body') {
    return 1;
  }
  return 0;
}

function tryRange(text: string, currency: MoneyCurrency): { min: number | null; max: number | null; raw: string } | null {
  // supports: 100-150, 100–150, 3,000–5,000, 100k-150k, 100 тыс - 150 тыс
  const num = '(?:\\d{1,3}(?:[\\s.,\'’]\\d{3})+|\\d+)';
  const cur = '(?:[$€£₽₴₸₺]|\\b(?:RUB|RUR|USD|EUR|GBP|CHF|SEK|NOK|DKK|CZK|HUF|PLN|RON|BGN|UAH|KZT|BYN|TRY)\\b)?\\s*';
  const re = new RegExp(
    `(?:(от)\\s*)?${cur}(${num})(\\s*(?:k|к|тыс\\.?|тысяч)\\b)?\\s*[-–]\\s*${cur}(${num})(\\s*(?:k|к|тыс\\.?|тысяч)\\b)?`,
    'i',
  );
  const m = re.exec(text);
  if (!m) {
    return null;
  }

  const leftSuffix = (m[3] ?? '').trim();
  const rightSuffix = (m[5] ?? '').trim();
  const inheritedLeftSuffix = leftSuffix || rightSuffix;
  const inheritedRightSuffix = rightSuffix || leftSuffix;

  const leftRaw = `${m[2]}${inheritedLeftSuffix ? ` ${inheritedLeftSuffix}` : ''}`;
  const rightRaw = `${m[4]}${inheritedRightSuffix ? ` ${inheritedRightSuffix}` : ''}`;

  const left = clampReasonable(applyMultiplier(parseAmount(m[2]), leftRaw));
  const right = clampReasonable(applyMultiplier(parseAmount(m[4]), rightRaw));

  if (left === null && right === null) {
    return null;
  }

  const raw = m[0];
  const min = left;
  const max = right;
  if (min !== null && max !== null && min > max) {
    return { min: max, max: min, raw };
  }

  return { min, max, raw };
}

function tryFromTo(text: string, currency: MoneyCurrency): { min: number | null; max: number | null; raw: string } | null {
  // RU: от 120k, до 200k; EN: from 3000, up to 5000
  const v = text.toLowerCase();
  const num = '(?:\\d{1,3}(?:[\\s.,\'’]\\d{3})+|\\d+)';
  const cur = '(?:[$€£₽₴₸₺]|\\b(?:RUB|RUR|USD|EUR|GBP|CHF|SEK|NOK|DKK|CZK|HUF|PLN|RON|BGN|UAH|KZT|BYN|TRY)\\b)?\\s*';
  const fromRe = new RegExp(`(от|from|starting\\s+from)\\s*${cur}(${num})(\\s*(?:k|к|тыс\\.?|тысяч)\\b)?`, 'i');
  const toRe = new RegExp(`(до|up\\s*to|to)\\s*${cur}(${num})(\\s*(?:k|к|тыс\\.?|тысяч)\\b)?`, 'i');

  const fm = fromRe.exec(v);
  const tm = toRe.exec(v);

  if (!fm && !tm) {
    return null;
  }

  const rawParts: string[] = [];
  let min: number | null = null;
  let max: number | null = null;

  if (fm) {
    const raw = `${fm[2]}${fm[3] ?? ''}`;
    min = clampReasonable(applyMultiplier(parseAmount(fm[2]), raw));
    rawParts.push(fm[0]);
  }

  if (tm) {
    const raw = `${tm[2]}${tm[3] ?? ''}`;
    max = clampReasonable(applyMultiplier(parseAmount(tm[2]), raw));
    rawParts.push(tm[0]);
  }

  if (min === null && max === null) {
    return null;
  }

  const raw = rawParts.join(' ');
  return { min, max, raw };
}

function trySingle(text: string, currency: MoneyCurrency): { min: number | null; max: number | null; raw: string } | null {
  // single: 120k, 3000 EUR
  const num = '(?:\\d{1,3}(?:[\\s.,\'’]\\d{3})+|\\d+)';
  const cur = '(?:[$€£₽₴₸₺]|\\b(?:RUB|RUR|USD|EUR|GBP|CHF|SEK|NOK|DKK|CZK|HUF|PLN|RON|BGN|UAH|KZT|BYN|TRY)\\b)?\\s*';
  const re = new RegExp(`${cur}(${num})(\\s*(?:k|к|тыс\\.?|тысяч)\\b)?`, 'i');
  const m = re.exec(text);
  if (!m) {
    return null;
  }

  const raw = `${m[1]}${m[2] ?? ''}`;
  const value = clampReasonable(applyMultiplier(parseAmount(m[1]), raw));
  if (value === null) {
    return null;
  }

  return { min: value, max: value, raw: m[0] };
}

function buildHit(
  section: string,
  windowText: string,
  rawSnippet: string,
  currencyHint: MoneyCurrency | null,
  defaultCountryHint: string | null,
  sectionText: string,
  strict: boolean,
): AmountHit | null {
  if (isAntiPattern(windowText)) {
    return null;
  }

  const currencyHit = detectCurrency(windowText, defaultCountryHint);
  let currency = currencyHit?.currency ?? currencyHint ?? 'UNKNOWN';
  // Fallback: if currency is mentioned elsewhere in the same section, use it.
  if (currency === 'UNKNOWN' && !currencyHint) {
    const sectionCurrency = detectCurrency(sectionText, defaultCountryHint)?.currency ?? null;
    if (sectionCurrency && hasSalarySignalAny(sectionText)) {
      currency = sectionCurrency;
    }
  }

  const period = detectPeriod(windowText);
  const salaryType = detectSalaryType(windowText);

  // prefer range, then from/to, then single
  const range = tryRange(windowText, currency);
  const fromTo = range ? null : tryFromTo(windowText, currency);
  const single = range || fromTo ? null : trySingle(windowText, currency);

  const parsed = range ?? fromTo ?? single;
  if (!parsed) {
    return null;
  }

  const min = applyFloorByPeriod(parsed.min, period);
  const max = applyFloorByPeriod(parsed.max, period);
  if (min === null && max === null) {
    return null;
  }

  // Strict mode: do not guess salary from naked numbers without currency or salary keywords.
  // This prevents false positives like "50-70 vacancies per month" or promo texts with years.
  if (strict && currency === 'UNKNOWN' && !hasSalarySignal(windowText)) {
    return null;
  }

  if (looksLikeYearAmount(min, max, windowText)) {
    return null;
  }

  const base = baseScore(section);

  let score = base;
  if (hasSalarySignal(windowText)) {
    score += 1;
  }
  if (currency !== 'UNKNOWN') {
    score += 2;
  }
  if (range) {
    score += 3;
  } else if (fromTo) {
    score += 2;
  } else {
    score += 1;
  }

  if (period !== 'month') {
    score += 1;
  }
  if (salaryType !== 'unknown') {
    score += 1;
  }

  if (min !== null && max !== null && min !== max) {
    score += 1;
  }

  return {
    min,
    max,
    raw: rawSnippet,
    currency,
    period,
    salaryType,
    score,
  };
}

function windowAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + len + 60);
  return text.slice(start, end);
}

function findCandidateWindows(text: string): Array<{ index: number; len: number; snippet: string }> {
  // anchor on any digits; then extract window
  const out: Array<{ index: number; len: number; snippet: string }> = [];
  const re = /\d{2,}(?:[\s.,'’]\d{3})*(?:\s*(?:k|к|тыс\.?|тысяч)\b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, len: m[0].length, snippet: m[0] });
    if (out.length >= 20) {
      break;
    }
  }
  return out;
}

function scoreToConfidence(score: number, strict: boolean): number {
  const cap = strict ? 10 : 8;
  const s = Math.max(0, Math.min(cap, score));
  return s / cap;
}

export function extractSalary(
  ctx: DocumentContext,
  opts: { strict: boolean; enableTraces: boolean },
): SalaryExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const hits: AmountHit[] = [];

  for (const section of ctx.sections) {
    const text = section.text;
    if (!text) {
      continue;
    }

    const candidates = findCandidateWindows(text);
    for (const c of candidates) {
      const w = windowAround(text, c.index, c.len);
      const hit = buildHit(
        section.name,
        w,
        w.replace(/\s+/g, ' ').trim(),
        ctx.currencyHint,
        ctx.defaultCountry,
        text,
        opts.strict,
      );
      if (!hit) {
        continue;
      }
      hits.push(hit);

      if (opts.enableTraces) {
        traces.push({
          extractor: 'salary',
          ruleId: 'heuristic:amount',
          section: section.name,
          snippet: hit.raw,
          scoreDelta: hit.score,
        });
      }

      if (hits.length >= 15) {
        break;
      }
    }

    if (hits.length >= 15) {
      break;
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const best = hits[0] ?? null;

  if (!best) {
    // Fallback: currency is mentioned, but no amount is provided (e.g. "Salary in EUR").
    for (const section of ctx.sections) {
      const text = section.text ?? '';
      if (!text.trim()) {
        continue;
      }
      if (!hasSalarySignalAny(text)) {
        continue;
      }
      const cur = detectCurrency(text, ctx.defaultCountry);
      if (!cur || cur.currency === 'UNKNOWN') {
        continue;
      }

      warnings.push('salary_currency_only');
      return {
        salary: {
          min: null,
          max: null,
          currency: cur.currency,
          period: 'unknown',
          salaryType: 'unknown',
          raw: cur.raw,
        },
        confidence: 0.2,
        warnings,
        traces,
      };
    }

    warnings.push('salary_not_found');
    return {
      salary: {
        min: null,
        max: null,
        currency: 'UNKNOWN',
        period: 'unknown',
        salaryType: 'unknown',
        raw: null,
      },
      confidence: 0,
      warnings,
      traces,
    };
  }

  const confidence = scoreToConfidence(best.score, opts.strict);

  // strict: if currency unknown and only single number -> low confidence
  if (opts.strict && best.currency === 'UNKNOWN' && best.min !== null && best.max !== null && best.min === best.max) {
    warnings.push('salary_low_confidence');
  }

  return {
    salary: {
      min: best.min,
      max: best.max,
      currency: best.currency,
      period: best.period,
      salaryType: best.salaryType,
      raw: best.raw,
    },
    confidence,
    warnings,
    traces,
  };
}
