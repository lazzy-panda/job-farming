import type { DocumentContext, DocumentSection } from '../core/document-context';
import type { ParsedTech, RuleTrace } from '../model/types';

// Use require() to avoid requiring resolveJsonModule in consumer tsconfigs (e.g. api webpack build).
// This is a static JSON asset copied to dist alongside compiled JS.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const techDict = require('../rules/common/tech.json') as { tokens: Array<{ t: string; a: string[] }> };

export interface TechExtractResult {
  tech: ParsedTech;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type DictToken = { t: string; a: string[] };

type Bucket = 'must' | 'plus' | 'all';

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

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTokenRegex(token: string): RegExp {
  const escaped = escapeRe(token);
  // Safe boundary across languages: token must be separated by non-letter/digit (Unicode).
  // This prevents false positives like "Cоздание" (latin C + Cyrillic word) matching "C".
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})([^\\p{L}\\p{N}]|$)`, 'iu');
}

function detectBucket(section: DocumentSection): Bucket {
  if (section.name === 'requirements') {
    return 'must';
  }
  if (section.name === 'nice_to_have') {
    return 'plus';
  }
  return 'all';
}

function pushFound(
  buckets: { must: string[]; plus: string[]; all: string[] },
  bucket: Bucket,
  canonical: string,
): void {
  if (bucket === 'must') {
    buckets.must.push(canonical);
    return;
  }
  if (bucket === 'plus') {
    buckets.plus.push(canonical);
    return;
  }
  buckets.all.push(canonical);
}

export function extractTech(ctx: DocumentContext, opts: { enableTraces: boolean }): TechExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const tokens: DictToken[] = techDict.tokens ?? [];

  const buckets = { must: [] as string[], plus: [] as string[], all: [] as string[] };

  for (const section of ctx.sections) {
    const text = section.text;
    if (!text) {
      continue;
    }

    const bucket = detectBucket(section);

    for (const entry of tokens) {
      const candidates = [entry.t, ...(entry.a ?? [])];
      let matched = false;
      let matchedBy = '';
      for (const c of candidates) {
        const re = buildTokenRegex(c);
        const m = re.exec(text);
        if (!m) {
          continue;
        }
        matched = true;
        matchedBy = c;
        break;
      }
      if (!matched) {
        continue;
      }

      pushFound(buckets, bucket, entry.t);

      if (opts.enableTraces) {
        traces.push({
          extractor: 'tech',
          ruleId: `dict:${entry.t}`,
          section: section.name,
          snippet: matchedBy,
          scoreDelta: bucket === 'must' ? 3 : bucket === 'plus' ? 2 : 1,
        });
      }
    }
  }

  const must = uniq(buckets.must);
  const plus = uniq(buckets.plus);
  const all = uniq(buckets.all);

  // avoid duplicates across buckets (must > plus > all)
  const mustSet = new Set(must);
  const plusFiltered = plus.filter((t) => !mustSet.has(t));
  const plusSet = new Set(plusFiltered);
  const allFiltered = all.filter((t) => !mustSet.has(t) && !plusSet.has(t));

  const total = must.length + plusFiltered.length + allFiltered.length;
  const confidence = total === 0 ? 0 : Math.min(1, 0.25 + total * 0.03);

  if (total === 0) {
    warnings.push('tech_not_found');
  }

  return {
    tech: { must, plus: plusFiltered, all: allFiltered },
    confidence,
    warnings,
    traces,
  };
}
