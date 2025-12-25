import { buildContext } from '../../core/build-context';
import { extractBenefits } from '../../extractors/benefits';

describe('benefits extractor', () => {
  it('detects multiple benefit categories', () => {
    const ctx = buildContext('We offer: medical insurance, learning budget, equipment (laptop)', {});
    const res = extractBenefits(ctx, { enableTraces: false });
    expect(res.benefits).toEqual(expect.arrayContaining(['insurance', 'learning', 'equipment']));
    expect(res.confidence).toBeGreaterThan(0);
  });
});
