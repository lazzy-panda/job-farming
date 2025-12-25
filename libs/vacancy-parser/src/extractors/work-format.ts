import type { DocumentContext } from '../core/document-context';
import type { ParsedWorkFormat, RuleTrace, WorkFormat } from '../model/types';

export interface WorkFormatExtractResult {
  workFormat: ParsedWorkFormat;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type Hit = { value: WorkFormat; section: string; snippet: string; score: number; ruleId: string };

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

function isAntiPattern(text: string): boolean {
  const v = text.toLowerCase();
  return /remote\s+interview|удал[её]нн(?:ое|ый)\s+интервью/.test(v);
}

function pushHit(
  hits: Hit[],
  text: string,
  sectionName: string,
  value: WorkFormat,
  ruleId: string,
  re: RegExp,
  opts: { skipIfAntiPattern: boolean },
): void {
  const m = re.exec(text);
  if (!m || m.index === undefined) {
    return;
  }
  const snippet = snippetAround(text, m.index, m[0].length);
  if (opts.skipIfAntiPattern && isAntiPattern(snippet)) {
    return;
  }
  hits.push({
    value,
    section: sectionName,
    ruleId,
    score: sectionWeight(sectionName),
    snippet,
  });
}

export function extractWorkFormat(
  ctx: DocumentContext,
  opts: { enableTraces: boolean },
): WorkFormatExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const hits: Hit[] = [];

  for (const section of ctx.sections) {
    const text = section.text;
    if (!text) {
      continue;
    }

    // NOTE: do not use \\b with Cyrillic (JS word boundary is ASCII-ish)
    pushHit(
      hits,
      text,
      section.name,
      'remote',
      'kw:remote',
      /(remote|удал[её]нк[ау]|удал[её]нн(?:ая|ый)|удал[её]нно|полностью\s+удал[её]нно|можно\s+работать\s+удал[её]нно|work\s+from\s+home|work\s+remotely|can\s+work\s+remotely|wfh)/i,
      { skipIfAntiPattern: true },
    );
    pushHit(
      hits,
      text,
      section.name,
      'hybrid',
      'kw:hybrid',
      /(hybrid|гибрид|частично\s+в\s+офисе|частично\s+удал[её]нно)/i,
      { skipIfAntiPattern: false },
    );
    pushHit(
      hits,
      text,
      section.name,
      'onsite',
      'kw:onsite',
      /(on\s*site|on[- ]?site|onsite|office|офис|в\s+офисе|на\s+месте|на\s+территории)/i,
      { skipIfAntiPattern: false },
    );
  }

  const foundRemote = hits.some((h) => h.value === 'remote');
  const foundHybrid = hits.some((h) => h.value === 'hybrid');
  const foundOnsite = hits.some((h) => h.value === 'onsite');

  let value: WorkFormat = 'unknown';
  if (foundHybrid) {
    value = 'hybrid';
  } else if (foundRemote && foundOnsite) {
    value = 'hybrid';
    warnings.push('work_format_conflict_remote_onsite');
  } else if (foundRemote) {
    value = 'remote';
  } else if (foundOnsite) {
    value = 'onsite';
  }

  const score = Math.min(8, hits.reduce((acc, h) => acc + h.score, 0));
  const confidence = value === 'unknown' ? 0 : Math.min(1, 0.35 + score * 0.1);

  if (value === 'unknown') {
    warnings.push('work_format_not_found');
  }

  if (opts.enableTraces) {
    for (const h of hits) {
      traces.push({
        extractor: 'workFormat',
        ruleId: h.ruleId,
        section: h.section,
        snippet: h.snippet,
        scoreDelta: h.score,
      });
    }
  }

  return {
    workFormat: { value },
    confidence,
    warnings,
    traces,
  };
}
