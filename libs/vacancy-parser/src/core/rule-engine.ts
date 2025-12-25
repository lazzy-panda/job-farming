import type { RuleTrace } from '../model/types';
import type { DocumentContext, DocumentSection } from './document-context';

export interface RuleDefinition {
  id: string;
  extractor: string;
  weight: number;
  sections?: Array<DocumentSection['name']>;
  keywords?: string[];
  patterns?: string[]; // regex strings
  antiPatterns?: string[]; // if matched -> ignore rule
  maxSnippets?: number;
}

export interface RuleMatch {
  ruleId: string;
  section: string;
  snippet: string;
  scoreDelta: number;
}

function safeRegExp(source: string): RegExp | null {
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

function normalizeForKeyword(text: string): string {
  return text.toLowerCase();
}

function pickSections(ctx: DocumentContext, rule: RuleDefinition): DocumentSection[] {
  const allowed = rule.sections;
  if (!allowed || allowed.length === 0) {
    return ctx.sections;
  }
  return ctx.sections.filter((s) => allowed.includes(s.name));
}

function matchSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function anyAntiPattern(text: string, antiPatterns: string[] | undefined): boolean {
  if (!antiPatterns || antiPatterns.length === 0) {
    return false;
  }
  for (const raw of antiPatterns) {
    const re = safeRegExp(raw);
    if (!re) {
      continue;
    }
    if (re.test(text)) {
      return true;
    }
  }
  return false;
}

export function applyRules(
  ctx: DocumentContext,
  extractor: string,
  rules: RuleDefinition[],
  enableTraces: boolean,
): { score: number; matches: RuleMatch[]; traces: RuleTrace[] } {
  let score = 0;
  const matches: RuleMatch[] = [];
  const traces: RuleTrace[] = [];

  for (const rule of rules) {
    if (rule.extractor !== extractor) {
      continue;
    }

    const sections = pickSections(ctx, rule);
    for (const section of sections) {
      const text = section.text;
      if (!text) {
        continue;
      }
      if (anyAntiPattern(text, rule.antiPatterns)) {
        continue;
      }

      let localHits = 0;
      const max = rule.maxSnippets ?? 3;

      if (rule.keywords && rule.keywords.length > 0) {
        const hay = normalizeForKeyword(text);
        for (const kw of rule.keywords) {
          const needle = normalizeForKeyword(kw);
          const idx = hay.indexOf(needle);
          if (idx >= 0) {
            const delta = rule.weight;
            score += delta;
            localHits += 1;
            const snippet = matchSnippet(text, idx, needle.length);
            matches.push({ ruleId: rule.id, section: section.name, snippet, scoreDelta: delta });
            if (enableTraces) {
              traces.push({ extractor, ruleId: rule.id, section: section.name, snippet, scoreDelta: delta });
            }
            if (localHits >= max) {
              break;
            }
          }
        }
      }

      if (localHits >= max) {
        continue;
      }

      if (rule.patterns && rule.patterns.length > 0) {
        for (const raw of rule.patterns) {
          const re = safeRegExp(raw);
          if (!re) {
            continue;
          }
          const m = re.exec(text);
          if (m && m.index >= 0) {
            const delta = rule.weight;
            score += delta;
            localHits += 1;
            const snippet = matchSnippet(text, m.index, m[0].length);
            matches.push({ ruleId: rule.id, section: section.name, snippet, scoreDelta: delta });
            if (enableTraces) {
              traces.push({ extractor, ruleId: rule.id, section: section.name, snippet, scoreDelta: delta });
            }
            if (localHits >= max) {
              break;
            }
          }
        }
      }
    }
  }

  return { score, matches, traces };
}
