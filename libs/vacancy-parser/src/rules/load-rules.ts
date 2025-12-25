import type { DocumentLang } from '../model/types';
import type { RuleDefinition } from '../core/rule-engine';

// NOTE:
// - No fs reads (side-effects) in lib.
// - We use require() so consumer builds do not need resolveJsonModule.
// - JSON files are copied to dist via Nx assets.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const commonBase = require('./common/base.json') as RuleDefinition[];
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ruBase = require('./ru/base.json') as RuleDefinition[];
// eslint-disable-next-line @typescript-eslint/no-var-requires
const enBase = require('./en/base.json') as RuleDefinition[];

export function loadRules(lang: DocumentLang): RuleDefinition[] {
  const common = Array.isArray(commonBase) ? commonBase : [];

  if (lang === 'ru') {
    return [...common, ...(Array.isArray(ruBase) ? ruBase : [])];
  }
  if (lang === 'en') {
    return [...common, ...(Array.isArray(enBase) ? enBase : [])];
  }
  if (lang === 'mixed') {
    return [
      ...common,
      ...(Array.isArray(ruBase) ? ruBase : []),
      ...(Array.isArray(enBase) ? enBase : []),
    ];
  }
  return common;
}
