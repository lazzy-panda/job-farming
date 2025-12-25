import type { ParseOptions } from '../model/types';
import { detectLang } from './detect-lang';
import type { DocumentContext } from './document-context';
import { preprocess } from './preprocess';
import { segment } from './segment';

export function buildContext(text: string, opts: ParseOptions): DocumentContext {
  const prep = preprocess(text);
  const lang = detectLang(prep.normalizedText);
  const sections = segment(prep.lines, lang);

  return {
    rawText: text,
    normalizedText: prep.normalizedText,
    lines: prep.lines,
    headLines: prep.headLines,
    pageTitle: opts.pageTitle?.trim() ? opts.pageTitle.trim() : null,
    lang,
    defaultCountry: opts.defaultCountry?.trim() ? opts.defaultCountry.trim().toUpperCase() : null,
    currencyHint: opts.currencyHint ?? null,
    sections,
    traces: [],
  };
}
