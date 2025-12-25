import type { DocumentLang } from '../model/types';

export function detectLang(text: string): DocumentLang {
  const value = text ?? '';
  if (!value.trim()) {
    return 'unknown';
  }

  const ruMatches = value.match(/[А-Яа-яЁё]/g) ?? [];
  const enMatches = value.match(/[A-Za-z]/g) ?? [];

  const ru = ruMatches.length;
  const en = enMatches.length;

  const total = ru + en;
  if (total === 0) {
    return 'unknown';
  }

  const ruRatio = ru / total;
  const enRatio = en / total;

  if (ruRatio >= 0.8) {
    return 'ru';
  }
  if (enRatio >= 0.8) {
    return 'en';
  }
  return 'mixed';
}
