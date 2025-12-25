import type { DocumentContext, DocumentSection } from '../core/document-context';
import type { LanguageLevel, ParsedLanguages, RuleTrace } from '../model/types';

export interface LanguagesExtractResult {
  languages: ParsedLanguages;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type Bucket = 'required' | 'plus';

type LangRule = { name: string; re: RegExp };

const LANGS: LangRule[] = [
  { name: 'English', re: /(\benglish\b|английск)/i },
  { name: 'Russian', re: /(\brussian\b|русск)/i },
  { name: 'German', re: /(\bgerman\b|немецк)/i },
  { name: 'Spanish', re: /(\bspanish\b|испанск)/i },
  { name: 'French', re: /(\bfrench\b|французск)/i },
  { name: 'Italian', re: /(\bitalian\b|итальянск)/i },
  { name: 'Portuguese', re: /(\bportuguese\b|португальск)/i },
  { name: 'Polish', re: /(\bpolish\b|польск)/i },
  { name: 'Ukrainian', re: /(\bukrainian\b|украинск)/i },
];

const LANGUAGE_CUE_RE =
  /(язык|language|speaking|fluent|proficien|владени|знани|уровн|cefr|\b(a1|a2|b1|b2|c1|c2)\b|native|свободн)/i;

const ORG_CUE_RE =
  /(company|studio|agency|startup|firm|компани|студи|агентств|стартап|фирм|work\s+for)/i;

function sliceAround(text: string, index: number, len: number, radius: number): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + len + radius);
  return text.slice(start, end);
}

function shouldTreatAsLanguageMention(section: DocumentSection, text: string, matchIndex: number, matchLen: number): boolean {
  const around = sliceAround(text, matchIndex, matchLen, 60);
  if (LANGUAGE_CUE_RE.test(around)) {
    return true;
  }

  // Common false positive: nationality/adjective used for company origin (e.g., "польская студия", "German startup")
  const after = sliceAround(text, matchIndex + matchLen, 0, 40);
  if (ORG_CUE_RE.test(after) || ORG_CUE_RE.test(around)) {
    return false;
  }

  // Allow short "English / German" mentions in requirement-like sections, even without explicit cues.
  if (section.name === 'requirements' || section.name === 'nice_to_have') {
    const compact = around.replace(/\s+/g, ' ').trim();
    if (compact.length <= 70 && !ORG_CUE_RE.test(compact)) {
      return true;
    }
  }

  return false;
}

function uniqPairs(values: Array<{ language: string; level: LanguageLevel }>): Array<{ language: string; level: LanguageLevel }> {
  const out: Array<{ language: string; level: LanguageLevel }> = [];
  const seen = new Set<string>();
  for (const v of values) {
    const key = `${v.language}::${v.level}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(v);
  }
  return out;
}

function detectBucket(section: DocumentSection): Bucket {
  if (section.name === 'nice_to_have') {
    return 'plus';
  }
  // default: requirements/head/body => required (safer)
  return 'required';
}

function detectLevel(text: string): LanguageLevel {
  const v = text.toLowerCase();
  const cefrRe = /(\b(a1|a2|b1|b2|c1|c2)\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = cefrRe.exec(text)) !== null) {
    const hit = m[2]?.toUpperCase() ?? '';
    const around = sliceAround(text, m.index ?? 0, m[0].length, 10).toLowerCase();
    // Ignore "с уровня A1 на B2" / "from level A1 to B2" (this is about students, not a requirement)
    if (/(с\s+уровн[яе]|from\s+level)\s*$/.test(around.trim())) {
      continue;
    }
    return hit as LanguageLevel;
  }
  if (/upper[-\s]*intermediate|upper\s+intermediate/.test(v)) {
    return 'upper_intermediate';
  }
  if (/intermediate/.test(v)) {
    return 'intermediate';
  }
  if (/advanced/.test(v)) {
    return 'advanced';
  }
  if (/native|fluent|свободн\w+/.test(v)) {
    return 'native';
  }
  if (/basic|начальн\w+/.test(v)) {
    return 'basic';
  }
  return 'unknown';
}

export function extractLanguages(ctx: DocumentContext, opts: { enableTraces: boolean }): LanguagesExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const required: Array<{ language: string; level: LanguageLevel }> = [];
  const plus: Array<{ language: string; level: LanguageLevel }> = [];

  for (const section of ctx.sections) {
    // head duplicates early lines for title candidates; skip to avoid overriding nice-to-have buckets
    if (section.name === 'head') {
      continue;
    }
    const text = section.text;
    if (!text) {
      continue;
    }
    const bucket = detectBucket(section);

    for (const l of LANGS) {
      const m = l.re.exec(text);
      if (!m) {
        continue;
      }
      if (!shouldTreatAsLanguageMention(section, text, m.index ?? 0, m[0].length)) {
        continue;
      }
      // Determine level close to the language mention to avoid picking unrelated CEFR values in long texts.
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 12);
      const end = Math.min(text.length, idx + m[0].length + 140);
      const near = text.slice(start, end);
      const level = detectLevel(near);
      const item = { language: l.name, level };
      if (bucket === 'plus') {
        plus.push(item);
      } else {
        required.push(item);
      }

      if (opts.enableTraces) {
        traces.push({
          extractor: 'languages',
          ruleId: `lang:${l.name}`,
          section: section.name,
          snippet: m[0],
          scoreDelta: bucket === 'plus' ? 1 : 2,
        });
      }
    }
  }

  const reqUniq = uniqPairs(required);
  const plusUniq = uniqPairs(plus).filter((p) => !reqUniq.some((r) => r.language === p.language));

  const total = reqUniq.length + plusUniq.length;
  const confidence = total === 0 ? 0 : Math.min(1, 0.25 + total * 0.15);

  if (total === 0) {
    warnings.push('languages_not_found');
  }

  const languages: ParsedLanguages = { required: reqUniq, plus: plusUniq };

  return { languages, confidence, warnings, traces };
}
