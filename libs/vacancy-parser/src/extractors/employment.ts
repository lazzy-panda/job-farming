import type { DocumentContext } from '../core/document-context';
import type { EmploymentType, ParsedEmployment, RuleTrace } from '../model/types';

export interface EmploymentExtractResult {
  employment: ParsedEmployment;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type Hit = { type: EmploymentType; section: string; snippet: string; score: number; ruleId: string };

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

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
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + len + 40);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function pushMatches(
  hits: Hit[],
  text: string,
  sectionName: string,
  type: EmploymentType,
  ruleId: string,
  re: RegExp,
): void {
  const m = re.exec(text);
  if (!m || m.index === undefined) {
    return;
  }
  const score = sectionWeight(sectionName);
  hits.push({
    type,
    section: sectionName,
    ruleId,
    score,
    snippet: snippetAround(text, m.index, m[0].length),
  });
}

export function extractEmployment(
  ctx: DocumentContext,
  opts: { enableTraces: boolean },
): EmploymentExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const hits: Hit[] = [];

  for (const section of ctx.sections) {
    const text = section.text;
    if (!text) {
      continue;
    }

    // full-time
    // NOTE: do not use \\b with Cyrillic (JS word boundary is ASCII-ish)
    pushMatches(hits, text, section.name, 'full_time', 'kw:full_time', /(full[- ]?time|полная\s+занятость|полный\s+день)/i);

    // part-time
    pushMatches(hits, text, section.name, 'part_time', 'kw:part_time', /(part[- ]?time|частичная\s+занятость|неполный\s+день)/i);

    // contract / b2b
    pushMatches(hits, text, section.name, 'contract', 'kw:contract', /(contract|срочн(?:ый|ого)\s+договор|гпх|по\s+договору)/i);
    pushMatches(hits, text, section.name, 'b2b', 'kw:b2b', /(b2b|ип|самозанят|sp\.?\s*z\s*o\.?\s*o\.?|llc)/i);

    // freelance
    pushMatches(hits, text, section.name, 'freelance', 'kw:freelance', /(freelance|фриланс|project[- ]?based|проектная\s+работа)/i);

    // internship - используем границы слов, чтобы не находить "intern" в "individual contributor"
    pushMatches(hits, text, section.name, 'internship', 'kw:internship', /(?:^|[^\w])(internship|intern\b|стажировк[аи])(?:[^\w]|$)/i);

    // temporary
    pushMatches(hits, text, section.name, 'temporary', 'kw:temporary', /(temporary|временная\s+работа|на\s+срок)/i);
  }

  const types = uniq(hits.map((h) => h.type));

  let score = hits.reduce((acc, h) => acc + h.score, 0);
  score = Math.min(score, 8);
  const confidence = types.length === 0 ? 0 : Math.min(1, 0.35 + score * 0.1);

  if (types.includes('full_time') && types.includes('part_time')) {
    warnings.push('employment_conflict_full_part');
  }

  if (types.length === 0) {
    warnings.push('employment_not_found');
  }

  if (opts.enableTraces) {
    for (const h of hits) {
      traces.push({
        extractor: 'employment',
        ruleId: h.ruleId,
        section: h.section,
        snippet: h.snippet,
        scoreDelta: h.score,
      });
    }
  }

  return {
    employment: { types },
    confidence,
    warnings,
    traces,
  };
}
