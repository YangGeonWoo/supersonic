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
  /**
   * 다음에 반사될 면: +1이면 위 발생기 면, −1이면 아래 발생기 면 (원래 점음원은 마주 보는 면).
   * 축대칭(기울기 0)이면 방사 방향의 z 부호와 같다.
   */
  side: Int8Array;
  /** 방사 방향 단위 법선 (지향성 (1 + n·r̂)/2에 쓰임) */
  nx: Float64Array;
  ny: Float64Array;
  nz: Float64Array;
}

/** 위 발생기 자세: x축 둘레 기울기 tilt [rad], x 방향 어긋남 offset [m] (조립 오차) */
export interface UpperPose {
  tilt: number;
  offset: number;
}

export const NO_POSE: UpperPose = { tilt: 0, offset: 0 };

/** 평면: 점 p0와 단위 법선 n */
export interface Plane {
  px: number;
  py: number;
  pz: number;
  nx: number;
  ny: number;
  nz: number;
}

/** 아래 발생기 면 (z = 0, 법선 +z)과 위 발생기 면 (자세 반영, 법선은 아래쪽) */
export function transducerPlanes(d: number, pose: UpperPose = NO_POSE): { lower: Plane; upper: Plane } {
  const c = Math.cos(pose.tilt);
  const s = Math.sin(pose.tilt);
  return {
    lower: { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 1 },
    // (0, 0, −1)을 x축 둘레로 tilt만큼 회전 → (0, sin, −cos)
    upper: { px: pose.offset, py: 0, pz: d, nx: 0, ny: s, nz: -c },
  };
}

function allocSet(n: number): SourceSet {
  return {
    n,
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    cRe: new Float64Array(n),
    cIm: new Float64Array(n),
    side: new Int8Array(n),
    nx: new Float64Array(n),
    ny: new Float64Array(n),
    nz: new Float64Array(n),
  };
}

/**
 * 아래 발생기(z = 0, 위상 0)와 위 발생기(z = d, 위상 φ, 진폭 배율 ampUpper).
 * 위 발생기는 pose만큼 기울이고(x축 둘레) x로 옮긴다. 원판 샘플(disc)은 재사용할 수 있게 인자로 받는다.
 */
export function makeSourceSet(disc: DiscSample, d: number, phi: number, ampUpper = 1, pose: UpperPose = NO_POSE): SourceSet {
  const m = disc.x.length;
  const set = allocSet(2 * m);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const ct = Math.cos(pose.tilt);
  const st = Math.sin(pose.tilt);
  const up = transducerPlanes(d, pose).upper;
  for (let j = 0; j < m; j++) {
    set.x[j] = disc.x[j];
    set.y[j] = disc.y[j];
    set.z[j] = 0;
    set.cRe[j] = disc.area[j];
    set.cIm[j] = 0;
    set.side[j] = 1;
    set.nz[j] = 1;

    // 위 원판: 원판 좌표 (x, y, 0)을 x축 둘레로 회전한 뒤 (offset, 0, d)로 옮김
    const t = m + j;
    set.x[t] = disc.x[j] + pose.offset;
    set.y[t] = disc.y[j] * ct;
    set.z[t] = d + disc.y[j] * st;
    set.cRe[t] = ampUpper * disc.area[j] * cp;
    set.cIm[t] = ampUpper * disc.area[j] * sp;
    set.side[t] = -1;
    set.nx[t] = up.nx;
    set.ny[t] = up.ny;
    set.nz[t] = up.nz;
  }
  return set;
}

/** 반사 차수: R^N ≤ 0.05가 되는 N (최대 6). R = 0이면 0 */
export function reflectionOrders(R: number): number {
  if (!(R > 0)) return 0;
  return Math.min(6, Math.ceil(Math.log(0.05) / Math.log(R)));
}

/** 점과 방향을 평면에 대해 뒤집는다: x' = x − 2((x − p0)·n)n, n' = n − 2(n·N)N */
export function reflectAcross(
  pl: Plane,
  p: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
): void {
  const dp = (p.x - pl.px) * pl.nx + (p.y - pl.py) * pl.ny + (p.z - pl.pz) * pl.nz;
  p.x -= 2 * dp * pl.nx;
  p.y -= 2 * dp * pl.ny;
  p.z -= 2 * dp * pl.nz;
  const dd = dir.x * pl.nx + dir.y * pl.ny + dir.z * pl.nz;
  dir.x -= 2 * dd * pl.nx;
  dir.y -= 2 * dd * pl.ny;
  dir.z -= 2 * dd * pl.nz;
}

/**
 * 상대 발생기 면에서의 반사를 거울상 점음원으로 더한다 (반사계수 R, 강체 면이라 위상 변화 없음).
 * 각 점음원이 내는 파는 먼저 마주 보는 면에서 반사되고, 이후 두 면을 번갈아 오간다.
 * 면은 transducerPlanes(d, pose) — 위 면이 기울어 있으면 기울어진 평면에 대해 뒤집는다.
 * 반사될 때마다 진폭 × R, 방사 방향도 같이 뒤집힌다.
 *
 * near: 1차 거울상에 쓸 원본(세밀한 샘플), far: 2차 이상 거울상에 쓸 원본(거칠게 샘플 — 계산 영역에서 2d 이상 떨어져 있음).
 * 근사: 면을 무한 평면으로 본다 (실제 발생기는 반지름 a_t 원판).
 */
export function withReflections(
  near: SourceSet,
  far: SourceSet,
  d: number,
  R: number,
  orders: number,
  pose: UpperPose = NO_POSE,
): SourceSet {
  if (orders <= 0 || !(R > 0)) return near;
  const planes = transducerPlanes(d, pose);
  const out = allocSet(near.n + near.n + (orders - 1) * far.n);
  let k = 0;
  const put = (src: SourceSet, j: number, p: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, amp: number, side: number) => {
    out.x[k] = p.x;
    out.y[k] = p.y;
    out.z[k] = p.z;
    out.cRe[k] = amp * src.cRe[j];
    out.cIm[k] = amp * src.cIm[j];
    out.side[k] = side;
    out.nx[k] = dir.x;
    out.ny[k] = dir.y;
    out.nz[k] = dir.z;
    k++;
  };
  const p = { x: 0, y: 0, z: 0 };
  const dir = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < near.n; j++) {
    p.x = near.x[j];
    p.y = near.y[j];
    p.z = near.z[j];
    dir.x = near.nx[j];
    dir.y = near.ny[j];
    dir.z = near.nz[j];
    put(near, j, p, dir, 1, near.side[j]);
  }
  const emit = (src: SourceSet, fromOrder: number, toOrder: number) => {
    for (let j = 0; j < src.n; j++) {
      p.x = src.x[j];
      p.y = src.y[j];
      p.z = src.z[j];
      dir.x = src.nx[j];
      dir.y = src.ny[j];
      dir.z = src.nz[j];
      let side = src.side[j];
      let amp = 1;
      for (let m = 1; m <= toOrder; m++) {
        reflectAcross(side > 0 ? planes.upper : planes.lower, p, dir);
        side = -side;
        amp *= R;
        if (m >= fromOrder) put(src, j, p, dir, amp, side);
      }
    }
  };
  emit(near, 1, 1);
  if (orders >= 2) emit(far, 2, orders);
  return out;
}
