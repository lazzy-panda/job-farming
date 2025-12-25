import type { ParseResult } from '../model/types';

function clampInt(value: number | null, min: number, max: number): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  const v = Math.trunc(value);
  return Math.max(min, Math.min(max, v));
}

export function applyGuards(res: ParseResult): ParseResult {
  res.experience.minYears = clampInt(res.experience.minYears, 0, 30);
  res.experience.maxYears = clampInt(res.experience.maxYears, 0, 30);

  if (res.salary.min !== null && res.salary.min < 0) {
    res.salary.min = null;
  }
  if (res.salary.max !== null && res.salary.max < 0) {
    res.salary.max = null;
  }

  if (res.schedule.hoursPerWeek !== null) {
    res.schedule.hoursPerWeek = clampInt(res.schedule.hoursPerWeek, 1, 168);
  }

  return res;
}
