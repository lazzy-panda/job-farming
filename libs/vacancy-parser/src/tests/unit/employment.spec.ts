import { buildContext } from '../../core/build-context';
import { extractEmployment } from '../../extractors/employment';

describe('employment extractor', () => {
  it('detects full-time', () => {
    const ctx = buildContext('Формат: полная занятость', {});
    const res = extractEmployment(ctx, { enableTraces: false });
    expect(res.employment.types).toContain('full_time');
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('detects b2b', () => {
    const ctx = buildContext('Оформление: B2B / ИП', {});
    const res = extractEmployment(ctx, { enableTraces: false });
    expect(res.employment.types).toContain('b2b');
  });

  it('warns on full+part conflict', () => {
    const ctx = buildContext('full-time or part-time', {});
    const res = extractEmployment(ctx, { enableTraces: false });
    expect(res.employment.types).toEqual(expect.arrayContaining(['full_time', 'part_time']));
    expect(res.warnings).toContain('employment_conflict_full_part');
  });
});
