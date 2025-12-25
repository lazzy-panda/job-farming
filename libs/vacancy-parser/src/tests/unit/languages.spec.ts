import { buildContext } from '../../core/build-context';
import { extractLanguages } from '../../extractors/languages';

describe('languages extractor', () => {
  it('detects English level and bucket', () => {
    const ctx = buildContext('Requirements: English B2', {});
    const res = extractLanguages(ctx, { enableTraces: false });
    expect(res.languages.required).toEqual([{ language: 'English', level: 'B2' }]);
  });

  it('puts nice-to-have into plus', () => {
    const ctx = buildContext('Nice to have: German B1', {});
    const res = extractLanguages(ctx, { enableTraces: false });
    expect(res.languages.plus).toEqual([{ language: 'German', level: 'B1' }]);
  });

  it('does not treat nationality/company origin as required language', () => {
    const ctx = buildContext('Cacao Mobile — польская студия мобильной разработки', {});
    const res = extractLanguages(ctx, { enableTraces: false });
    expect(res.languages.required).toEqual([]);
    expect(res.languages.plus).toEqual([]);
  });

  it('does not pick CEFR levels from student progress narrative', () => {
    const ctx = buildContext(
      'Мы создаём курсы: многие выходят с уровня A1 на B2.\n' +
        'Что нам важно: Английский — C1 — Продвинутый.',
      {},
    );
    const res = extractLanguages(ctx, { enableTraces: false });
    expect(res.languages.required).toEqual([{ language: 'English', level: 'C1' }]);
  });
});
