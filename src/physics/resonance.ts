/**
 * 공진 이득 G(d) = 1 / |1 − R·exp(i·2kd)|
 * 두 발생기 면 사이 다중 반사를 단순화한 경향 모델 (정량 예측 아님).
 */
export function resonanceGain(d: number, k: number, R: number): number {
  const th = 2 * k * d;
  const re = 1 - R * Math.cos(th);
  const im = -R * Math.sin(th);
  return 1 / Math.sqrt(re * re + im * im);
}

/** d를 λ/2의 가장 가까운 정수배(최소 1배)로 맞춘다 */
export function nearestResonanceGap(d: number, lambda: number): number {
  const half = lambda / 2;
  return Math.max(1, Math.round(d / half)) * half;
}

/** 범위 [dMin, dMax] 안에서 가장 가까운 λ/2 정수배 (범위 안에 없으면 d 그대로) */
export function nearestResonanceGapIn(d: number, lambda: number, dMin: number, dMax: number): number {
  const half = lambda / 2;
  const nLo = Math.ceil(dMin / half - 1e-9);
  const nHi = Math.floor(dMax / half + 1e-9);
  if (nLo > nHi) return d;
  const n = Math.min(nHi, Math.max(nLo, Math.round(d / half)));
  return n * half;
}

/** 그래프용 G(d) 곡선 */
export function resonanceCurve(
  dMin: number,
  dMax: number,
  n: number,
  k: number,
  R: number,
): { d: Float64Array; G: Float64Array } {
  const d = new Float64Array(n);
  const G = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = dMin + ((dMax - dMin) * i) / (n - 1);
    G[i] = resonanceGain(d[i], k, R);
  }
  return { d, G };
}
