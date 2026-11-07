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
 * 아래 발생기(z = 0, 위상 0)와 위 발생기(z = d, 위상 φ).
 * 원판 샘플(disc)은 한 번 만들어 재사용할 수 있게 인자로 받는다.
 */
export function makeSourceSet(disc: DiscSample, d: number, phi: number): SourceSet {
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
    set.cRe[t] = disc.area[j] * cp;
    set.cIm[t] = disc.area[j] * sp;
    set.side[t] = -1;
  }
  return set;
}
