import type { DocumentContext } from '../core/document-context';
import type { ParsedSchedule, RuleTrace } from '../model/types';

export interface ScheduleExtractResult {
  schedule: ParsedSchedule;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type Hit = { kind: string; section: string; snippet: string; score: number; ruleId: string };

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

function pushHit(hits: Hit[], text: string, sectionName: string, ruleId: string, kind: string, re: RegExp): void {
  const m = re.exec(text);
  if (!m || m.index === undefined) {
    return;
  }
  hits.push({
    kind,
    section: sectionName,
    ruleId,
    score: sectionWeight(sectionName),
    snippet: snippetAround(text, m.index, m[0].length),
  });
}

function extractHoursPerWeek(text: string): number | null {
  const v = text.toLowerCase();
  const re1 = /(\d{2,3})\s*h\s*\/\s*week/;
  const re2 = /(\d{2,3})\s*hours\s*per\s*week/;
  const re3 = /(\d{2,3})\s*час(?:а|ов)?\s*в\s*недел/;

  const m = re1.exec(v) ?? re2.exec(v) ?? re3.exec(v);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) {
    return null;
  }
  if (n < 1 || n > 168) {
    return null;
  }
  return Math.trunc(n);
}

export function extractSchedule(
  ctx: DocumentContext,
  opts: { enableTraces: boolean },
): ScheduleExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const patterns: string[] = [];
  const hits: Hit[] = [];

  let hasNightShifts = false;
  let hasWeekends = false;
  let isFlexible = false;
  let hoursPerWeek: number | null = null;

  for (const section of ctx.sections) {
    const text = section.text;
    if (!text) {
      continue;
    }

    // common schedule patterns 5/2 etc.
    const frac = text.match(/\b[1-6]\s*\/\s*[1-6]\b/g) ?? [];
    for (const f of frac) {
      patterns.push(f.replace(/\s+/g, ''));
    }

    pushHit(hits, text, section.name, 'kw:shift', 'shift', /\b(shift|сменн(?:ый|ая)|вахта|rotat(?:ion|e))\b/i);
    pushHit(hits, text, section.name, 'kw:flex', 'flex', /\b(flex(?:ible)?|гибк(?:ий|ая)|свободный\s+график)\b/i);
    pushHit(hits, text, section.name, 'kw:night', 'night', /\b(night\s+shift|ночн(?:ая|ые)|ночью)\b/i);
    pushHit(hits, text, section.name, 'kw:weekends', 'weekends', /\b(weekends?|выходн(?:ые|ой)|on[- ]?call|дежурств)\b/i);

    const hpw = extractHoursPerWeek(text);
    if (hpw !== null && hoursPerWeek === null) {
      hoursPerWeek = hpw;
      if (opts.enableTraces) {
        traces.push({
          extractor: 'schedule',
          ruleId: 'regex:hours_per_week',
          section: section.name,
          snippet: snippetAround(text, Math.max(0, text.toLowerCase().indexOf(String(hpw))), String(hpw).length),
          scoreDelta: sectionWeight(section.name),
        });
      }
    }

    const lower = text.toLowerCase();
    if (/\bночн/.test(lower) || /night\s+shift/.test(lower)) {
      hasNightShifts = true;
    }
    if (/\bвыходн/.test(lower) || /weekends?/.test(lower) || /on[- ]?call/.test(lower) || /дежурств/.test(lower)) {
      hasWeekends = true;
    }
    if (/\bгибк/.test(lower) || /flex/.test(lower) || /свободный\s+график/.test(lower)) {
      isFlexible = true;
    }
  }

  const uniqPatterns = uniq(patterns);

  // derive extra patterns from hits
  if (hits.some((h) => h.kind === 'shift')) {
    uniqPatterns.push('shift');
  }
  if (hits.some((h) => h.kind === 'flex')) {
    uniqPatterns.push('flex');
  }

  const score = Math.min(8, hits.reduce((acc, h) => acc + h.score, 0) + uniqPatterns.length);
  const confidence = (uniqPatterns.length === 0 && hoursPerWeek === null && !hasNightShifts && !hasWeekends && !isFlexible)
    ? 0
    : Math.min(1, 0.3 + score * 0.1);

  if (confidence === 0) {
    warnings.push('schedule_not_found');
  }

  if (opts.enableTraces) {
    for (const h of hits) {
      traces.push({
        extractor: 'schedule',
        ruleId: h.ruleId,
        section: h.section,
        snippet: h.snippet,
        scoreDelta: h.score,
      });
    }
  }

  const schedule: ParsedSchedule = {
    patterns: uniq(uniqPatterns),
    hoursPerWeek,
    hasNightShifts,
    hasWeekends,
    isFlexible,
  };

  return { schedule, confidence, warnings, traces };
}
