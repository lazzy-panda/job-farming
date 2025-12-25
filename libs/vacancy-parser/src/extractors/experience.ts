import type { DocumentContext } from '../core/document-context';
import type { ParsedExperience, RuleTrace } from '../model/types';

export interface ExperienceExtractResult {
  experience: ParsedExperience;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type Hit = {
  min: number | null;
  max: number | null;
  section: string;
  snippet: string;
  score: number;
  ruleId: string;
};

function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + len + 50);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function sectionWeight(sectionName: string): number {
  if (sectionName === 'requirements') {
    return 3;
  }
  if (sectionName === 'head') {
    return 2;
  }
  return 1;
}

function isAntiPattern(snippet: string): boolean {
  const v = snippet.toLowerCase();

  // salary markers
  if (/[₽$€£]|\b(usd|eur|rub|gbp|salary|compensation)\b|\b(руб|р\.|оклад|зп|зарплат)\b/i.test(snippet)) {
    return true;
  }

  // percent
  if (/\b\d{1,3}\s*%\b/.test(v)) {
    return true;
  }

  // schedule time
  if (/\b\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}\b/.test(v)) {
    return true;
  }

  // dates
  if (/\b20\d{2}\b/.test(v)) {
    return true;
  }

  // month/year words not about experience
  if (/\bper\s+(month|year)\b/.test(v) && /\d/.test(v) && !/years?/.test(v)) {
    return true;
  }

  return false;
}

function clampYears(v: number): number | null {
  if (!Number.isFinite(v)) {
    return null;
  }
  const n = Math.trunc(v);
  if (n < 0 || n > 30) {
    return null;
  }
  return n;
}

function addHit(hits: Hit[], section: string, snippet: string, min: number | null, max: number | null, ruleId: string, score: number): void {
  const minY = min === null ? null : clampYears(min);
  const maxY = max === null ? null : clampYears(max);
  if (minY === null && maxY === null) {
    return;
  }
  hits.push({ min: minY, max: maxY, section, snippet, ruleId, score });
}

export function extractExperience(ctx: DocumentContext, opts: { enableTraces: boolean }): ExperienceExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];
  const hits: Hit[] = [];

  const patterns: Array<{ ruleId: string; re: RegExp; map: (m: RegExpExecArray) => { min: number | null; max: number | null } }> = [
    // RU
    {
      ruleId: 'ru:exp_from',
      re: /(опыт\s*(?:от|не\s*менее)\s*)(\d{1,2})\s*(?:\+\s*)?(?:лет|года|год)/i,
      map: (m) => ({ min: Number(m[2]), max: null }),
    },
    {
      ruleId: 'ru:exp_plus',
      re: /(\d{1,2})\s*\+\s*(?:лет|года|год)/i,
      map: (m) => ({ min: Number(m[1]), max: null }),
    },
    {
      ruleId: 'ru:exp_range',
      re: /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:лет|года|год)/i,
      map: (m) => ({ min: Number(m[1]), max: Number(m[2]) }),
    },

    // EN
    {
      ruleId: 'en:exp_at_least',
      re: /(at\s+least\s*)(\d{1,2})\s*(?:\+\s*)?(?:years?|yrs?)/i,
      map: (m) => ({ min: Number(m[2]), max: null }),
    },
    {
      ruleId: 'en:exp_plus',
      re: /(\d{1,2})\s*\+\s*(?:years?|yrs?)/i,
      map: (m) => ({ min: Number(m[1]), max: null }),
    },
    {
      ruleId: 'en:exp_range',
      re: /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:years?|yrs?)/i,
      map: (m) => ({ min: Number(m[1]), max: Number(m[2]) }),
    },
  ];

  for (const section of ctx.sections) {
    const text = section.text;
    if (!text) {
      continue;
    }

    for (const p of patterns) {
      const m = p.re.exec(text);
      if (!m || m.index === undefined) {
        continue;
      }
      const snippet = snippetAround(text, m.index, m[0].length);
      if (isAntiPattern(snippet)) {
        continue;
      }
      const mapped = p.map(m);
      addHit(hits, section.name, snippet, mapped.min, mapped.max, p.ruleId, sectionWeight(section.name) + 2);
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const best = hits[0] ?? null;

  if (!best) {
    warnings.push('experience_not_found');
    return { experience: { minYears: null, maxYears: null }, confidence: 0, warnings, traces };
  }

  const hasRange = best.min !== null && best.max !== null;
  const confidence = Math.min(1, 0.4 + best.score * 0.1 + (hasRange ? 0.1 : 0));

  if (opts.enableTraces) {
    traces.push({ extractor: 'experience', ruleId: best.ruleId, section: best.section, snippet: best.snippet, scoreDelta: best.score });
  }

  return {
    experience: { minYears: best.min, maxYears: best.max },
    confidence,
    warnings,
    traces,
  };
}
