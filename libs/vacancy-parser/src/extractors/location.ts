import type { DocumentContext } from '../core/document-context';
import type { LocationInfo, ParsedLocation, RuleTrace } from '../model/types';

export interface LocationExtractResult {
  location: ParsedLocation;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type Hit = {
  city: string | null;
  country: string | null;
  relocation: boolean;
  visaSupport: boolean;
  section: string;
  snippet: string;
  score: number;
  ruleId: string;
};

const NON_LOCATION_TOKENS = new Set<string>([
  'django',
  'fastapi',
  'node.js',
  'nodejs',
  'nestjs',
  'react',
  'angular',
  'vue',
  'postgresql',
  'mysql',
  'kafka',
  'docker',
  'kubernetes',
  'gitlab',
  'github',
  'prometheus',
  'grafana',
  'sentry',
  // url/email noise
  'http',
  'https',
  'www',
  't',
  'me',
  'com',
  'net',
  'org',
  'io',
  'ai',
  'app',
  'dev',
] as const);

const BANNED_LOCATION_WORDS = new Set<string>([
  'year',
  'years',
  'working',
  'hours',
  'working hours',
  'experience',
  'benefits',
  'requirements',
  'responsibilities',
  'compensation',
  'salary',
  'offer',
  'retirement',
  'pto',
  'bonus',
  'ote',
  'k',
] as const);

function isCamelLike(value: string): boolean {
  return /[a-z][A-Z]/.test(value);
}

function isAllLowerAsciiWords(value: string): boolean {
  const v = value.trim();
  return /^[a-z][a-z\s-]+$/.test(v);
}

const COUNTRY_ALIASES: Array<{ re: RegExp; country: string }> = [
  { re: /\b(russia|rf|ru)\b/i, country: 'Russia' },
  // NOTE: do not rely on \b for Cyrillic (JS word boundary is ASCII-ish)
  // IMPORTANT: keep "рф" as a standalone token (avoid matching inside words like "интерфейс")
  { re: /(?:^|[^А-Яа-яЁё])(?:россия|рф)(?:$|[^А-Яа-яЁё])/i, country: 'Russia' },
  { re: /\b(usa|us|united\s+states)\b/i, country: 'USA' },
  { re: /\b(uk|united\s+kingdom|great\s+britain|gb)\b/i, country: 'UK' },
  { re: /\b(ireland|ie)\b/i, country: 'Ireland' },
  { re: /\b(portugal|pt)\b/i, country: 'Portugal' },
  { re: /\b(belgium|be)\b/i, country: 'Belgium' },
  { re: /\b(austria|at)\b/i, country: 'Austria' },
  { re: /\b(czechia|czech\s+republic|cz)\b/i, country: 'Czechia' },
  { re: /\b(hungary|hu)\b/i, country: 'Hungary' },
  { re: /\b(romania|ro)\b/i, country: 'Romania' },
  { re: /\b(bulgaria|bg)\b/i, country: 'Bulgaria' },
  { re: /\b(finland|fi)\b/i, country: 'Finland' },
  { re: /\b(estonia|ee)\b/i, country: 'Estonia' },
  { re: /\b(latvia|lv)\b/i, country: 'Latvia' },
  { re: /\b(lithuania|lt)\b/i, country: 'Lithuania' },
  { re: /\b(croatia|hr)\b/i, country: 'Croatia' },
  { re: /\b(slovenia|si)\b/i, country: 'Slovenia' },
  { re: /\b(slovakia|sk)\b/i, country: 'Slovakia' },
  { re: /\b(luxembourg|lu)\b/i, country: 'Luxembourg' },
  { re: /\b(iceland|is)\b/i, country: 'Iceland' },
  { re: /\b(greece|hellas|ellada|ελλάδα|hellenic)\b/i, country: 'Greece' },
  { re: /\b(cyprus|κύπρος)\b/i, country: 'Cyprus' },
  // Cyrillic alias (do not rely on \b for Cyrillic)
  { re: /кипр/iu, country: 'Cyprus' },
  { re: /\b(switzerland|schweiz|suisse)\b/i, country: 'Switzerland' },
  { re: /\b(sweden|sverige)\b/i, country: 'Sweden' },
  { re: /\b(norway|norge)\b/i, country: 'Norway' },
  { re: /\b(denmark|danmark)\b/i, country: 'Denmark' },
  { re: /\b(france)\b/i, country: 'France' },
  { re: /\b(netherlands|holland)\b/i, country: 'Netherlands' },
  { re: /\b(spain|españa)\b/i, country: 'Spain' },
  { re: /\b(italy|italia)\b/i, country: 'Italy' },
  { re: /\b(germany|deutschland)\b/i, country: 'Germany' },
  { re: /\b(pol\w*|poland)\b/i, country: 'Poland' },
  { re: /\b(georgia)\b/i, country: 'Georgia' },
  { re: /\b(armenia)\b/i, country: 'Armenia' },
  { re: /\b(serbia)\b/i, country: 'Serbia' },
  { re: /\b(uae|united\s+arab\s+emirates)\b/i, country: 'UAE' },
  { re: /\b(kazakhstan)\b|\bказахстан\b/i, country: 'Kazakhstan' },
  { re: /\b(ukraine)\b|\bукраина\b/i, country: 'Ukraine' },
];

function isKnownCountryToken(value: string): boolean {
  const v = value.trim();
  if (!v) {
    return false;
  }
  if (/^[A-Z]{2,3}$/.test(v)) {
    return true;
  }
  for (const a of COUNTRY_ALIASES) {
    if (a.re.test(v)) {
      return true;
    }
  }
  return false;
}

const CITY_ALIASES: Array<{ re: RegExp; city: string; country?: string }> = [
  // NOTE: do not rely on \b for Cyrillic (JS word boundary is ASCII-ish)
  { re: /(\bmoscow\b|москва)/i, city: 'Moscow', country: 'Russia' },
  { re: /(\bsaint\s*petersburg\b|\bspb\b|санкт-?петербург|питер)/i, city: 'Saint Petersburg', country: 'Russia' },
  { re: /(\bnovosibirsk\b|новосибирск)/i, city: 'Novosibirsk', country: 'Russia' },
  { re: /(\bminsk\b|минск)/i, city: 'Minsk' },
  { re: /(\btbilisi\b|тбилиси)/i, city: 'Tbilisi', country: 'Georgia' },
  { re: /(\byerevan\b|ереван)/i, city: 'Yerevan', country: 'Armenia' },
  { re: /(\bbatumi\b|батуми)/i, city: 'Batumi', country: 'Georgia' },
  { re: /(\bwarsaw\b|варшава)/i, city: 'Warsaw', country: 'Poland' },
  { re: /(\bberlin\b|берлин)/i, city: 'Berlin', country: 'Germany' },
  { re: /(\blondon\b|лондон)/i, city: 'London', country: 'UK' },
  { re: /\bamsterdam\b/i, city: 'Amsterdam', country: 'Netherlands' },
  { re: /\bparis\b/i, city: 'Paris', country: 'France' },
  { re: /\bmadrid\b/i, city: 'Madrid', country: 'Spain' },
  { re: /\bbarcelona\b/i, city: 'Barcelona', country: 'Spain' },
  { re: /\brome\b|\broma\b/i, city: 'Rome', country: 'Italy' },
  { re: /\bmilan\b|\bmilano\b/i, city: 'Milan', country: 'Italy' },
  { re: /\bdublin\b/i, city: 'Dublin', country: 'Ireland' },
  { re: /\blisbon\b|\blisboa\b/i, city: 'Lisbon', country: 'Portugal' },
  { re: /\bporto\b/i, city: 'Porto', country: 'Portugal' },
  { re: /\bvienna\b|\bwien\b/i, city: 'Vienna', country: 'Austria' },
  { re: /\bprague\b|\bpraha\b/i, city: 'Prague', country: 'Czechia' },
  { re: /\bbrno\b/i, city: 'Brno', country: 'Czechia' },
  { re: /\bbudapest\b/i, city: 'Budapest', country: 'Hungary' },
  { re: /\bbucharest\b|\bbucurești\b/i, city: 'Bucharest', country: 'Romania' },
  { re: /\bsofia\b/i, city: 'Sofia', country: 'Bulgaria' },
  { re: /\bhelsinki\b/i, city: 'Helsinki', country: 'Finland' },
  { re: /\btallinn\b/i, city: 'Tallinn', country: 'Estonia' },
  { re: /\briga\b/i, city: 'Riga', country: 'Latvia' },
  { re: /\bvilnius\b/i, city: 'Vilnius', country: 'Lithuania' },
  { re: /\bzagreb\b/i, city: 'Zagreb', country: 'Croatia' },
  { re: /\bljubljana\b/i, city: 'Ljubljana', country: 'Slovenia' },
  { re: /\bbratislava\b/i, city: 'Bratislava', country: 'Slovakia' },
  { re: /\bluxembourg\b/i, city: 'Luxembourg', country: 'Luxembourg' },
  { re: /\breykjav[ií]k\b/i, city: 'Reykjavik', country: 'Iceland' },
  // Kazakhstan
  { re: /(\balmaty\b|алматы)/i, city: 'Almaty', country: 'Kazakhstan' },
  // Greece
  { re: /\bathens\b|αθήνα/i, city: 'Athens', country: 'Greece' },
  { re: /\bthessaloniki\b|θεσσαλονίκη/i, city: 'Thessaloniki', country: 'Greece' },
  // Cyprus
  { re: /\bnicosia\b|lefkosia|λευκωσία/i, city: 'Nicosia', country: 'Cyprus' },
  { re: /\blimassol\b|λεμεσός/i, city: 'Limassol', country: 'Cyprus' },
  { re: /\blarnaca\b|λά[ρr]νακα/i, city: 'Larnaca', country: 'Cyprus' },
  // US common aliases (minimal, for better normalization)
  { re: /\bnyc\b|\bnew\s+york\s+city\b/i, city: 'New York', country: 'USA' },
  { re: /\bnew\s+york\b/i, city: 'New York', country: 'USA' },
  { re: /\bsf\b|\bsan\s+francisco\b/i, city: 'San Francisco', country: 'USA' },
];

const US_STATE_CODES = new Set<string>([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
] as const);

function sectionWeight(sectionName: string): number {
  if (sectionName === 'head') {
    return 3;
  }
  if (sectionName === 'benefits') {
    return 2;
  }
  if (sectionName === 'body') {
    return 1;
  }
  return 1;
}

function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + len + 50);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function detectRelocation(text: string): boolean {
  const v = text.toLowerCase();
  return /\brelocation\b|релокац|переезд|\brelocate\b/.test(v);
}

function detectVisaSupport(text: string): boolean {
  const v = text.toLowerCase();
  return /\bvisa\b|виза|visa\s+support|work\s+permit|разрешени[ея]\s+на\s+работу/.test(v);
}

function tryExplicitCityCountry(text: string): { city: string | null; country: string | null; index: number; len: number } | null {
  // formats like "Москва, РФ" or "Berlin, Germany" or "г. Москва"
  const m1 = /(г\.?\s*)?([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{1,40})\s*,\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{1,40})/i.exec(text);
  if (m1 && m1.index !== undefined) {
    const full = m1[0];
    // avoid matching emails/urls like "example.com, https" or "mail@x.com, apply"
    if (/@|:\/\//.test(full)) {
      return null;
    }
    const city = m1[2].trim();
    const countryRaw = m1[3].trim();
    // avoid false positives like "Office in Tbilisi, hybrid format"
    const cityWords = city.split(/\s+/).filter(Boolean);
    const countryWords = countryRaw.split(/\s+/).filter(Boolean);
    const cityLower = city.toLowerCase();
    const countryLower = countryRaw.toLowerCase();
    if (cityWords.length > 3 || countryWords.length > 3) {
      return null;
    }
    if (/\boffice\b|\bformat\b|\bhybrid\b|\bremote\b|\bonsite\b/.test(cityLower)) {
      return null;
    }
    if (/формат|гибрид|удал|office|remote|onsite|hybrid/.test(countryLower)) {
      return null;
    }

    // Prevent false positives on tech stacks like "Django, FastAPI"
    if (city.includes('.') || countryRaw.includes('.')) {
      return null;
    }
    if (isCamelLike(city) || isCamelLike(countryRaw)) {
      return null;
    }
    if (NON_LOCATION_TOKENS.has(cityLower) || NON_LOCATION_TOKENS.has(countryLower)) {
      return null;
    }
    if (BANNED_LOCATION_WORDS.has(cityLower) || BANNED_LOCATION_WORDS.has(countryLower)) {
      return null;
    }
    if (cityLower.length <= 2) {
      return null;
    }
    if (isAllLowerAsciiWords(city) && isAllLowerAsciiWords(countryRaw)) {
      return null;
    }
    if (!isKnownCountryToken(countryRaw)) {
      return null;
    }
    return { city, country: countryRaw, index: m1.index, len: m1[0].length };
  }

  // Formats like "Berlin (Germany)" or "Dublin (IE)"
  const mParens = /([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{1,40})\s*\(\s*([A-Za-zА-Яа-яЁё]{2,40})\s*\)/i.exec(text);
  if (mParens && mParens.index !== undefined) {
    const full = mParens[0];
    if (/@|:\/\//.test(full)) {
      return null;
    }
    const city = mParens[1].trim();
    const countryRaw = mParens[2].trim();
    const cityLower = city.toLowerCase();
    const countryLower = countryRaw.toLowerCase();
    if (/\boffice\b|\bformat\b|\bhybrid\b|\bremote\b|\bonsite\b/.test(cityLower)) {
      return null;
    }
    if (/формат|гибрид|удал|office|remote|onsite|hybrid/.test(countryLower)) {
      return null;
    }
    if (NON_LOCATION_TOKENS.has(cityLower) || NON_LOCATION_TOKENS.has(countryLower)) {
      return null;
    }
    if (BANNED_LOCATION_WORDS.has(cityLower) || BANNED_LOCATION_WORDS.has(countryLower)) {
      return null;
    }
    if (cityLower.length <= 2) {
      return null;
    }
    if (isAllLowerAsciiWords(city) && isAllLowerAsciiWords(countryRaw)) {
      return null;
    }
    if (!isKnownCountryToken(countryRaw)) {
      return null;
    }
    return { city, country: countryRaw, index: mParens.index, len: mParens[0].length };
  }

  // Formats like "Berlin - Germany"
  const mDash = /([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{1,40})\s*[-–—]\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{1,40})/i.exec(text);
  if (mDash && mDash.index !== undefined) {
    const full = mDash[0];
    if (/@|:\/\//.test(full)) {
      return null;
    }
    const city = mDash[1].trim();
    const countryRaw = mDash[2].trim();
    const cityLower = city.toLowerCase();
    const countryLower = countryRaw.toLowerCase();
    if (/\boffice\b|\bformat\b|\bhybrid\b|\bremote\b|\bonsite\b/.test(cityLower)) {
      return null;
    }
    if (/формат|гибрид|удал|office|remote|onsite|hybrid/.test(countryLower)) {
      return null;
    }
    if (NON_LOCATION_TOKENS.has(cityLower) || NON_LOCATION_TOKENS.has(countryLower)) {
      return null;
    }
    if (BANNED_LOCATION_WORDS.has(cityLower) || BANNED_LOCATION_WORDS.has(countryLower)) {
      return null;
    }
    if (cityLower.length <= 2) {
      return null;
    }
    if (isAllLowerAsciiWords(city) && isAllLowerAsciiWords(countryRaw)) {
      return null;
    }
    if (!isKnownCountryToken(countryRaw)) {
      return null;
    }
    return { city, country: countryRaw, index: mDash.index, len: mDash[0].length };
  }

  // US format: "City, ST" (e.g., "New York, NY")
  const mUs = /([A-Za-z][A-Za-z .'-]{1,40})\s*,\s*([A-Z]{2})\b/.exec(text);
  if (mUs && mUs.index !== undefined) {
    const city = mUs[1].trim();
    const state = mUs[2].trim().toUpperCase();
    if (US_STATE_CODES.has(state)) {
      const cityLower = city.toLowerCase();
      if (!/\boffice\b|\bformat\b|\bhybrid\b|\bremote\b|\bonsite\b/.test(cityLower)) {
        return { city, country: 'USA', index: mUs.index, len: mUs[0].length };
      }
    }
  }

  const m2 = /(г\.?\s*)([А-Яа-яЁё][А-Яа-яЁё\- ]{1,40})/i.exec(text);
  if (m2 && m2.index !== undefined) {
    const city = m2[2].trim();
    return { city, country: null, index: m2.index, len: m2[0].length };
  }

  return null;
}

function normalizeCountry(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }
  for (const a of COUNTRY_ALIASES) {
    if (a.re.test(value)) {
      return a.country;
    }
  }
  // keep as-is for now (minimal)
  return value;
}

function normalizeCity(raw: string | null): { city: string | null; countryHint: string | null } {
  if (!raw) {
    return { city: null, countryHint: null };
  }
  const value = raw.trim();
  if (!value) {
    return { city: null, countryHint: null };
  }
  for (const a of CITY_ALIASES) {
    if (a.re.test(value)) {
      return { city: a.city, countryHint: a.country ?? null };
    }
  }
  return { city: value, countryHint: null };
}

function findBestHit(hits: Hit[]): Hit | null {
  if (hits.length === 0) {
    return null;
  }
  hits.sort((a, b) => b.score - a.score);
  return hits[0];
}

function detectRegionOnly(text: string): Array<'US' | 'EU' | 'EMEA' | 'APAC'> {
  const v = text.toLowerCase();
  const out: Array<'US' | 'EU' | 'EMEA' | 'APAC'> = [];
  if (/\b(us\s+only|usa\s+only|united\s+states\s+only)\b/.test(v)) {
    out.push('US');
  }
  if (/\b(eu\s+only|european\s+union\s+only|eu-wide|eea\s+only|europe\s+only)\b/.test(v)) {
    out.push('EU');
  }
  if (/\bemea\b/.test(v)) {
    out.push('EMEA');
  }
  if (/\bapac\b/.test(v)) {
    out.push('APAC');
  }
  return out;
}

export function extractLocation(
  ctx: DocumentContext,
  opts: { enableTraces: boolean },
): LocationExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  // flags are global signals (may exist without an explicit city/country mention)
  const relocationFlag = detectRelocation(ctx.normalizedText);
  const visaSupportFlag = detectVisaSupport(ctx.normalizedText);
  const regions = detectRegionOnly(ctx.normalizedText);

  const hits: Hit[] = [];

  for (const section of ctx.sections) {
    const text = section.text;
    if (!text) {
      continue;
    }

    // Avoid matching country codes (ru/us/uk/etc.) from URLs/emails.
    const textNoUrls = text
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ');

    const relocation = detectRelocation(text);
    const visaSupport = detectVisaSupport(text);

    const explicit = tryExplicitCityCountry(textNoUrls);
    if (explicit) {
      const cityNorm = normalizeCity(explicit.city);
      const countryNorm = normalizeCountry(explicit.country) ?? cityNorm.countryHint;
      const snippet = snippetAround(text, explicit.index, explicit.len);
      hits.push({
        city: cityNorm.city,
        country: countryNorm,
        relocation,
        visaSupport,
        section: section.name,
        snippet,
        score: sectionWeight(section.name) + 3,
        ruleId: 'regex:city_country',
      });
    }

    // city-only aliases
    for (const a of CITY_ALIASES) {
      const m = a.re.exec(textNoUrls);
      if (m && m.index !== undefined) {
        hits.push({
          city: a.city,
          country: a.country ?? null,
          relocation,
          visaSupport,
          section: section.name,
          snippet: snippetAround(text, m.index, m[0].length),
          score: sectionWeight(section.name) + 2,
          ruleId: 'dict:city',
        });
      }
    }

    // country-only aliases
    for (const a of COUNTRY_ALIASES) {
      const m = a.re.exec(textNoUrls);
      if (m && m.index !== undefined) {
        hits.push({
          city: null,
          country: a.country,
          relocation,
          visaSupport,
          section: section.name,
          snippet: snippetAround(text, m.index, m[0].length),
          score: sectionWeight(section.name) + 1,
          ruleId: 'dict:country',
        });
      }
    }
  }

  const best = findBestHit(hits);

  const relocation = relocationFlag || hits.some((h) => h.relocation);
  const visaSupport = visaSupportFlag || hits.some((h) => h.visaSupport);

  const countryFallback = best?.country ?? (/кипр/iu.test(ctx.normalizedText) ? 'Cyprus' : null);

  const value: LocationInfo = {
    city: best?.city ?? null,
    country: countryFallback,
    relocation,
    visaSupport,
  };

  const hasAny = Boolean(value.city || value.country || relocation || visaSupport);
  const confidence = !hasAny ? 0 : Math.min(1, 0.3 + Math.min(8, (best?.score ?? 1)) * 0.1);

  if (!hasAny) {
    warnings.push('location_not_found');
  }

  if (!value.city && !value.country && regions.length > 0) {
    for (const r of regions) {
      warnings.push(`location_region_only:${r}`);
    }
  }

  if (opts.enableTraces) {
    for (const h of hits.slice(0, 10)) {
      traces.push({
        extractor: 'location',
        ruleId: h.ruleId,
        section: h.section,
        snippet: h.snippet,
        scoreDelta: h.score,
      });
    }
  }

  return {
    location: { value },
    confidence,
    warnings,
    traces,
  };
}
