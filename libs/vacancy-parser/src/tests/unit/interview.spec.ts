import { buildContext } from '../../core/build-context';
import { extractInterview } from '../../extractors/interview';

describe('interview extractor', () => {
  it('extracts steps and test task', () => {
    const ctx = buildContext('Interview: 1) HR 2) Tech 3) Final. Test task included.', {});
    const res = extractInterview(ctx, { enableTraces: false });
    expect(res.interview.steps).toEqual(expect.arrayContaining(['HR', 'Tech', 'Final']));
    expect(res.interview.hasTestTask).toBe(true);
  });
});
