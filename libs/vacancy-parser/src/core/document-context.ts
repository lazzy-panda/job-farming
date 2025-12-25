import type { DocumentLang, MoneyCurrency, RuleTrace } from '../model/types';

export type DocumentSectionName =
  | 'head'
  | 'body'
  | 'requirements'
  | 'responsibilities'
  | 'benefits'
  | 'contacts'
  | 'about'
  | 'nice_to_have'
  | 'unknown';

export interface DocumentSection {
  name: DocumentSectionName;
  lang: DocumentLang;
  text: string;
  lines: string[];
}

export interface DocumentContext {
  rawText: string;
  normalizedText: string;
  lines: string[];
  headLines: string[];
  pageTitle: string | null;
  lang: DocumentLang;
  defaultCountry: string | null;
  currencyHint: MoneyCurrency | null;
  sections: DocumentSection[];
  traces: RuleTrace[];
}
