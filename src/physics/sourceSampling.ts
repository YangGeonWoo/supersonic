/**
 * 원판 발생기를 동심원 점음원으로 나눈다.
 * 각 점은 맡은 면적 ΔA_j를 가중치로 갖는다 (ΣΔA_j = π·a²).
 */

export interface DiscSample {
  /** 점 x 좌표 [m] (원판 중심 기준) */
  x: Float64Array;
  /** 점 y 좌표 [m] */
  y: Float64Array;
  /** 점이 맡는 면적 [m²] */
  area: Float64Array;
}

/**
 * 반지름 a 원판을 간격 ≤ hMax로 샘플링.
 * 고리 폭 dr = a/Nr (Nr = ceil(a/hMax)). 0번 고리는 중심 한 점(원 반지름 dr),
 * i번 고리는 반지름 (i+0.5)·dr에 둘레 간격 ≤ hMax가 되도록 점을 놓는다.
 * 각도는 2πm/n이라 y → −y 대칭이다 (y = 0 단면에서 ∂P/∂y = 0).
 */
export function sampleDisc(a: number, hMax: number): DiscSample {
  const Nr = Math.max(1, Math.ceil(a / hMax));
  const dr = a / Nr;
  const xs: number[] = [0];
  const ys: number[] = [0];
  const areas: number[] = [Math.PI * dr * dr];
  for (let i = 1; i < Nr; i++) {
    const rho = (i + 0.5) * dr;
    const n = Math.max(3, Math.ceil((2 * Math.PI * rho) / hMax));
    const ringArea = Math.PI * dr * dr * ((i + 1) * (i + 1) - i * i);
    for (let m = 0; m < n; m++) {
      const th = (2 * Math.PI * m) / n;
      xs.push(rho * Math.cos(th));
      ys.push(rho * Math.sin(th));
      areas.push(ringArea / n);
    }
  }
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), area: Float64Array.from(areas) };
}

/** 두 발생기 점음원 전체 */
export interface SourceSet {
  n: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** 복소 계수 c_j = ΔA_j·exp(i·위상) (s = 1 기준) */
  cRe: Float64Array;
  cIm: Float64Array;
  /** 방사 방향 부호: 아래 발생기 +1(+z로 방사), 위 발생기 −1 */
  side: Int8Array;
}

/**
 * 아래 발생기(z = 0, 위상 0)와 위 발생기(z = d, 위상 φ, 진폭 배율 ampUpper).
 * 원판 샘플(disc)은 한 번 만들어 재사용할 수 있게 인자로 받는다.
 */
export function makeSourceSet(disc: DiscSample, d: number, phi: number, ampUpper = 1): SourceSet {
  const m = disc.x.length;
  const n = 2 * m;
  const set: SourceSet = {
    n,
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    cRe: new Float64Array(n),
    cIm: new Float64Array(n),
    side: new Int8Array(n),
  };
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  for (let j = 0; j < m; j++) {
    set.x[j] = disc.x[j];
    set.y[j] = disc.y[j];
    set.z[j] = 0;
    set.cRe[j] = disc.area[j];
    set.cIm[j] = 0;
    set.side[j] = 1;

    const t = m + j;
    set.x[t] = disc.x[j];
    set.y[t] = disc.y[j];
    set.z[t] = d;
    set.cRe[t] = ampUpper * disc.area[j] * cp;
    set.cIm[t] = ampUpper * disc.area[j] * sp;
    set.side[t] = -1;
  }
  return set;
}

/** 반사 차수: R^N ≤ 0.05가 되는 N (최대 6). R = 0이면 0 */
export function reflectionOrders(R: number): number {
  if (!(R > 0)) return 0;
  return Math.min(6, Math.ceil(Math.log(0.05) / Math.log(R)));
}

/**
 * 상대 발생기 면(z = 0, z = d)에서의 반사를 거울상 점음원으로 더한다 (반사계수 R, 강체 면이라 위상 변화 없음).
 * 각 점음원이 내는 파는 먼저 마주 보는 면에서 반사되고, 이후 두 면을 번갈아 오간다:
 *   위로 가는 파(side +1)는 z = d 면에서 z → 2d − z,  아래로 가는 파(side −1)는 z = 0 면에서 z → −z.
 * 반사될 때마다 진폭 × R, 방사 방향 반전.
 *
 * near: 1차 거울상에 쓸 원본(세밀한 샘플), far: 2차 이상 거울상에 쓸 원본(거칠게 샘플 — 계산 영역에서 2d 이상 떨어져 있음).
 * 근사: 면을 무한 평면으로 본다 (실제 발생기는 반지름 a_t 원판).
 */
export function withReflections(near: SourceSet, far: SourceSet, d: number, R: number, orders: number): SourceSet {
  if (orders <= 0 || !(R > 0)) return near;
  const n = near.n + near.n + (orders - 1) * far.n;
  const out: SourceSet = {
    n,
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    cRe: new Float64Array(n),
    cIm: new Float64Array(n),
    side: new Int8Array(n),
  };
  let k = 0;
  const put = (x: number, y: number, z: number, cr: number, ci: number, side: number) => {
    out.x[k] = x;
    out.y[k] = y;
    out.z[k] = z;
    out.cRe[k] = cr;
    out.cIm[k] = ci;
    out.side[k] = side;
    k++;
  };
  for (let j = 0; j < near.n; j++) put(near.x[j], near.y[j], near.z[j], near.cRe[j], near.cIm[j], near.side[j]);
  const emit = (src: SourceSet, fromOrder: number, toOrder: number) => {
    for (let j = 0; j < src.n; j++) {
      let z = src.z[j];
      let side = src.side[j];
      let amp = 1;
      for (let m = 1; m <= toOrder; m++) {
        if (side > 0) z = 2 * d - z;
        else z = -z;
        side = -side;
        amp *= R;
        if (m >= fromOrder) put(src.x[j], src.y[j], z, amp * src.cRe[j], amp * src.cIm[j], side);
      }
    }
  };
  emit(near, 1, 1);
  if (orders >= 2) emit(far, 2, orders);
  return out;
}
