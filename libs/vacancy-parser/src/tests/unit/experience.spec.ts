import { buildContext } from '../../core/build-context';
import { extractExperience } from '../../extractors/experience';

describe('experience extractor', () => {
  it('extracts RU range', () => {
    const ctx = buildContext('Требования: опыт 3-5 лет', {});
    const res = extractExperience(ctx, { enableTraces: false });
    expect(res.experience.minYears).toBe(3);
    expect(res.experience.maxYears).toBe(5);
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('extracts EN at least', () => {
    const ctx = buildContext('Requirements: at least 4 years experience', {});
    const res = extractExperience(ctx, { enableTraces: false });
    expect(res.experience.minYears).toBe(4);
    expect(res.experience.maxYears).toBeNull();
  });

  it('does not confuse salary with experience', () => {
    const ctx = buildContext('Salary: $3000 per month. Great culture.', {});
    const res = extractExperience(ctx, { enableTraces: false });
    expect(res.experience.minYears).toBeNull();
    expect(res.experience.maxYears).toBeNull();
  });
});
