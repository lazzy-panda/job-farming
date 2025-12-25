import { buildContext } from '../../core/build-context';
import { extractSchedule } from '../../extractors/schedule';

describe('schedule extractor', () => {
  it('detects 5/2 and hours per week', () => {
    const ctx = buildContext('График 5/2, 40 часов в неделю', {});
    const res = extractSchedule(ctx, { enableTraces: false });
    expect(res.schedule.patterns).toContain('5/2');
    expect(res.schedule.hoursPerWeek).toBe(40);
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('detects night shifts and weekends', () => {
    const ctx = buildContext('Night shift, weekends, on-call', {});
    const res = extractSchedule(ctx, { enableTraces: false });
    expect(res.schedule.hasNightShifts).toBe(true);
    expect(res.schedule.hasWeekends).toBe(true);
  });

  it('detects flexible schedule', () => {
    const ctx = buildContext('Гибкий график (flexible)', {});
    const res = extractSchedule(ctx, { enableTraces: false });
    expect(res.schedule.isFlexible).toBe(true);
  });
});
