function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

// maps score (can be negative) to confidence 0..1
export function scoreToConfidence(score: number, strict: boolean): number {
  const s = Number.isFinite(score) ? score : 0;
  const k = strict ? 0.35 : 0.25;
  const x0 = strict ? 3 : 2;
  const logistic = 1 / (1 + Math.exp(-k * (s - x0)));
  return clamp01(logistic);
}

export function mergeConfidence(values: number[]): number {
  const list = values.filter((v) => Number.isFinite(v));
  if (list.length === 0) {
    return 0;
  }
  const sum = list.reduce((acc, v) => acc + v, 0);
  return clamp01(sum / list.length);
}
