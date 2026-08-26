import type { ParseOptions } from '../model/types';
import { detectLang } from './detect-lang';
import type { DocumentContext } from './document-context';
import { preprocess } from './preprocess';
import { segment } from './segment';

function inferDefaultCountry(opts: ParseOptions): string | null {
  const hint = opts.defaultCountry?.trim();
  if (hint) {
    return hint.toUpperCase();
  }
  const url = opts.sourceUrl ?? '';
  if (!url) {
    return null;
  }
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // keep raw string
  }
  const normalizedHost = host.toLowerCase();
  if (normalizedHost.includes('arbeitsagentur')) {
    return 'DE';
  }
  return null;
}

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
    defaultCountry: inferDefaultCountry(opts),
    currencyHint: opts.currencyHint ?? null,
    sections,
    traces: [],
  };
}
