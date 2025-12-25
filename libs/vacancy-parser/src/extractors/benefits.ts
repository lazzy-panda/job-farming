import type { DocumentContext, DocumentSection } from '../core/document-context';
import type { BenefitCategory, RuleTrace } from '../model/types';

export interface BenefitsExtractResult {
  benefits: BenefitCategory[];
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type Rule = { cat: BenefitCategory; re: RegExp; ruleId: string };

const RULES: Rule[] = [
  { cat: 'insurance', ruleId: 'benefit:insurance', re: /(dms|insurance|medical\s+insurance|health\s+insurance|страховк|дмс)/i },
  { cat: 'vacation', ruleId: 'benefit:vacation', re: /(vacation|pto|paid\s+time\s+off|отпуск|28\s*дн)/i },
  { cat: 'sick_leave', ruleId: 'benefit:sick_leave', re: /(sick\s+leave|paid\s+sick|болничн)/i },
  { cat: 'parental_leave', ruleId: 'benefit:parental_leave', re: /(parental\s+leave|maternity\s+leave|paternity\s+leave|декрет|материнск|отцовск)/i },
  { cat: 'retirement', ruleId: 'benefit:retirement', re: /(401k|retirement|pension)/i },
  { cat: 'equipment', ruleId: 'benefit:equipment', re: /(equipment|macbook|laptop|work\s+device|техник|оборудован|ноутбук|макбук)/i },
  { cat: 'learning', ruleId: 'benefit:learning', re: /(learning|education|course|courses|certification|обучен|курс|конференц|сертифик)/i },
  { cat: 'bonus', ruleId: 'benefit:bonus', re: /(bonus|kpi|13\s*salary|13-?я\s*зарплат|преми[яи])/i },
  { cat: 'stock', ruleId: 'benefit:stock', re: /(stock|equity|esop|rsu)/i },
  { cat: 'gym', ruleId: 'benefit:gym', re: /(gym|fitness|спортзал|фитнес)/i },
  { cat: 'flexible', ruleId: 'benefit:flexible', re: /(flexible|flex\s*time|гибк(?:ий|ая)\s+график|свободный\s+график)/i },
  { cat: 'remote', ruleId: 'benefit:remote', re: /(remote|удал[её]нн(?:ая|ый)|wfh)/i },
  { cat: 'relocation', ruleId: 'benefit:relocation', re: /(relocation|релокац|переезд)/i },
  { cat: 'visa', ruleId: 'benefit:visa', re: /(visa\s+support|work\s+permit|виза|визовая\s+поддержка)/i },
];

function uniq(values: BenefitCategory[]): BenefitCategory[] {
  return Array.from(new Set(values));
}

function sectionWeight(section: DocumentSection): number {
  if (section.name === 'benefits') {
    return 3;
  }
  if (section.name === 'head') {
    return 2;
  }
  return 1;
}

export function extractBenefits(ctx: DocumentContext, opts: { enableTraces: boolean }): BenefitsExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const found: BenefitCategory[] = [];
  let score = 0;

  for (const section of ctx.sections) {
    if (section.name === 'head') {
      continue;
    }
    const text = section.text;
    if (!text) {
      continue;
    }

    for (const r of RULES) {
      const m = r.re.exec(text);
      if (!m) {
        continue;
      }
      found.push(r.cat);
      const delta = sectionWeight(section);
      score += delta;
      if (opts.enableTraces) {
        traces.push({
          extractor: 'benefits',
          ruleId: r.ruleId,
          section: section.name,
          snippet: m[0],
          scoreDelta: delta,
        });
      }
    }
  }

  const benefits = uniq(found);
  const confidence = benefits.length === 0 ? 0 : Math.min(1, 0.25 + Math.min(10, score) * 0.07);

  if (benefits.length === 0) {
    warnings.push('benefits_not_found');
  }

  return { benefits, confidence, warnings, traces };
}
