/**
 * 진행파 복사압: 평면 진행파가 구에 가하는 힘 F = Y_p(ka)·π a²·E,  E = I/c (에너지 밀도)
 *
 * Y_p는 강체(움직이지 않는) 구의 부분파 급수로 정확히 계산한다 (King 1934, Hasegawa & Yosioka 1969):
 *   Y_p = −(4/x²) Σ_{n≥0} (n+1)·[α_n + α_{n+1} + 2(α_n·α_{n+1} + β_n·β_{n+1})],   x = ka
 *   산란 계수 s_n = α_n + iβ_n = −j_n'(x) / h_n'(x)   (강체: 표면에서 법선 속도 0)
 *
 * 가정: 스티로폼 공은 공기보다 약 20배 무겁고 압축률이 수백 배 작으므로 강체로 근사한다.
 * 정상파 항(Gor'kov)에 이 힘을 단순히 더하는 것은 근사다 (교차항 무시).
 */

/** 구면 베셀 j_n(x), n = 0..N (작은 x에서도 안정하도록 Miller 하향 점화식) */
export function sphericalJ(N: number, x: number): Float64Array {
  const j = new Float64Array(N + 2);
  if (x === 0) {
    j[0] = 1;
    return j;
  }
  const start = N + 2 + Math.ceil(Math.max(20, 2 * x));
  let jp1 = 0;
  let jn = 1e-300;
  const tmp = new Float64Array(start + 2);
  tmp[start] = jn;
  for (let n = start; n > 0; n--) {
    const jm1 = ((2 * n + 1) / x) * jn - jp1;
    jp1 = jn;
    jn = jm1;
    tmp[n - 1] = jn;
    if (Math.abs(jn) > 1e250) {
      // 넘침 방지 재규격화
      for (let k = n - 1; k <= start; k++) tmp[k] *= 1e-250;
      jn *= 1e-250;
      jp1 *= 1e-250;
    }
  }
  const scale = Math.sin(x) / x / tmp[0];
  for (let n = 0; n < N + 2; n++) j[n] = tmp[n] * scale;
  return j;
}

/** 구면 노이만 y_n(x), n = 0..N (상향 점화식, 안정) */
export function sphericalY(N: number, x: number): Float64Array {
  const y = new Float64Array(N + 2);
  y[0] = -Math.cos(x) / x;
  y[1] = -Math.cos(x) / (x * x) - Math.sin(x) / x;
  for (let n = 1; n < N + 1; n++) y[n + 1] = ((2 * n + 1) / x) * y[n] - y[n - 1];
  return y;
}

/** 강체 구의 산란 계수 α_n, β_n (n = 0..N) */
export function rigidCoefficients(N: number, x: number): { alpha: Float64Array; beta: Float64Array } {
  const j = sphericalJ(N + 1, x);
  const y = sphericalY(N + 1, x);
  const alpha = new Float64Array(N + 1);
  const beta = new Float64Array(N + 1);
  for (let n = 0; n <= N; n++) {
    // f_n' = f_{n−1} − (n+1)/x·f_n,  f_0' = −f_1
    const jd = n === 0 ? -j[1] : j[n - 1] - ((n + 1) / x) * j[n];
    const yd = n === 0 ? -y[1] : y[n - 1] - ((n + 1) / x) * y[n];
    const D = jd * jd + yd * yd;
    alpha[n] = -(jd * jd) / D;
    beta[n] = (jd * yd) / D;
  }
  return { alpha, beta };
}

/** 강체 구의 복사력 함수 Y_p(ka) (평면 진행파) */
export function radiationForceFunction(x: number): number {
  if (!(x > 0)) return 0;
  const N = Math.ceil(x + 4 * Math.cbrt(x) + 10);
  const { alpha: a, beta: b } = rigidCoefficients(N + 1, x);
  let sum = 0;
  for (let n = 0; n <= N; n++) sum += (n + 1) * (a[n] + a[n + 1] + 2 * (a[n] * a[n + 1] + b[n] * b[n + 1]));
  return (-4 / (x * x)) * sum;
}

/**
 * 진행파 복사압 계수 [m²·s/m]: F = pushCoeff · I  (I: 음향 세기 [W/m²])
 * pushCoeff = Y_p(ka)·π a² / c
 */
export function pushCoefficient(a: number, k: number, c: number): number {
  return (radiationForceFunction(k * a) * Math.PI * a * a) / c;
}
