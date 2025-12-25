import type { DocumentContext, DocumentSection } from '../core/document-context';
import type { InterviewInfo, RuleTrace } from '../model/types';

export interface InterviewExtractResult {
  interview: InterviewInfo;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type StepHit = { step: string; section: string; snippet: string; score: number; ruleId: string };

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

function sectionWeight(section: DocumentSection): number {
  if (section.name === 'head') {
    return 2;
  }
  if (section.name === 'benefits') {
    return 2;
  }
  return 1;
}

function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + len + 50);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function detectTestTask(text: string): boolean {
  const v = text.toLowerCase();
  return /(test\s*task|coding\s+challenge|home\s+assignment|тестов(ое|ая)\s+задан|тестовое|задачка)/.test(v);
}

function normalizeStep(raw: string): string {
  const v = raw.trim().replace(/^\d+[).\s-]+/, '').trim();
  if (!v) {
    return '';
  }
  // simple canonicalization
  const lower = v.toLowerCase();
  if (/\bhr\b|recruiter|скрининг|рекрутер|hr\s*-?интервью/.test(lower)) {
    return 'HR';
  }
  if (/tech|technical|технич|собеседование\s+с\s+тех/.test(lower)) {
    return 'Tech';
  }
  if (/final|финал|cto|lead|manager/.test(lower)) {
    return 'Final';
  }
  return v;
}

export function extractInterview(ctx: DocumentContext, opts: { enableTraces: boolean }): InterviewExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const hits: StepHit[] = [];
  let hasTestTask = false;

  for (const section of ctx.sections) {
    if (section.name === 'head') {
      continue;
    }
    const text = section.text;
    if (!text) {
      continue;
    }

    if (detectTestTask(text)) {
      hasTestTask = true;
      if (opts.enableTraces) {
        traces.push({
          extractor: 'interview',
          ruleId: 'kw:test_task',
          section: section.name,
          snippet: 'test_task',
          scoreDelta: sectionWeight(section),
        });
      }
    }

    // Detect numbered steps: "1) HR 2) Tech 3) Final" (inline)
    const stepRe = /(\d{1,2})\s*[).]\s*([^0-9\n]{1,80})/g;
    let sm: RegExpExecArray | null;
    while ((sm = stepRe.exec(text)) !== null) {
      const rawStep = (sm[2] ?? '').trim();
      const step = normalizeStep(rawStep);
      if (!step) {
        continue;
      }
      hits.push({
        step,
        section: section.name,
        snippet: snippetAround(text, sm.index, sm[0].length),
        score: sectionWeight(section) + 1,
        ruleId: 'regex:steps_inline',
      });
    }

    // Lines that look like steps
    for (const line of section.lines.slice(0, 40)) {
      const m = /^\s*\d\s*[).]\s*(.+)$/.exec(line);
      if (!m) {
        continue;
      }
      const step = normalizeStep(m[1]);
      if (!step) {
        continue;
      }
      hits.push({
        step,
        section: section.name,
        snippet: snippetAround(text, Math.max(0, text.indexOf(line)), line.length),
        score: sectionWeight(section) + 2,
        ruleId: 'regex:steps_lines',
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const steps = uniq(hits.map((h) => h.step));

  const score = Math.min(10, hits.reduce((acc, h) => acc + h.score, 0) + (hasTestTask ? 2 : 0));
  const confidence = (steps.length === 0 && !hasTestTask) ? 0 : Math.min(1, 0.25 + score * 0.06);

  if (confidence === 0) {
    warnings.push('interview_not_found');
  }

  if (opts.enableTraces) {
    for (const h of hits.slice(0, 5)) {
      traces.push({
        extractor: 'interview',
        ruleId: h.ruleId,
        section: h.section,
        snippet: h.snippet,
        scoreDelta: h.score,
      });
    }
  }

  const interview: InterviewInfo = { steps, hasTestTask };

  return { interview, confidence, warnings, traces };
}
