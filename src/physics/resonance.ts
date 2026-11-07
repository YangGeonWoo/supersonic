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

/**
 * 두 발생기를 모두 구동할 때의 공진 이득 (1차원 평면파, 양쪽 면 반사계수 R, 위 발생기 위상 φ).
 *   위로 가는 파 u = A + R·v·e^{ikd},  아래로 가는 파 v = A·e^{iφ} + R·u·e^{ikd}
 *   → |u|/|A| = |1 + R·e^{i(kd+φ)}| / |1 − R²·e^{2ikd}|
 * φ = 0이면 d = nλ(λ/2의 짝수배)에서 1/(1−R)로 최대, d = (n+½)λ(홀수배)에서는 1/(1+R)로 오히려 약하다.
 * (SPEC 2.3의 G(d) = 1/|1 − R·e^{2ikd}|는 발생기 하나 + 반사판 모델이라 이 차이를 담지 못한다)
 */
export function drivenPairGain(d: number, k: number, R: number, phi: number): number {
  const a = k * d + phi;
  const nr = 1 + R * Math.cos(a);
  const ni = R * Math.sin(a);
  const th = 2 * k * d;
  const dr = 1 - R * R * Math.cos(th);
  const di = -R * R * Math.sin(th);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** d 근처(±λ/2)에서 drivenPairGain이 최대인 간격 (범위 [dMin, dMax] 안) */
export function nearestPairResonance(d: number, lambda: number, R: number, phi: number, dMin: number, dMax: number): number {
  const k = (2 * Math.PI) / lambda;
  const lo = Math.max(dMin, d - lambda / 2);
  const hi = Math.min(dMax, d + lambda / 2);
  const n = Math.max(2, Math.ceil((hi - lo) / (lambda / 800)));
  let best = d;
  let bestG = -Infinity;
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n;
    const g = drivenPairGain(x, k, R, phi);
    // 같은 이득이면 원래 d에 가까운 쪽
    if (g > bestG + 1e-12 || (Math.abs(g - bestG) <= 1e-12 && Math.abs(x - d) < Math.abs(best - d))) {
      bestG = g;
      best = x;
    }
  }
  return best;
}
