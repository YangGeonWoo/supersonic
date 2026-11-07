/**
 * B층: 유한 크기 원판 발생기(점음원 합)의 음향장을 x-z 단면(y = 0)에서 계산한다.
 * 시간 규약 p(t) = Re[P·exp(−iωt)], 점음원 P_j = c_j·exp(ikR)/R.
 * 모든 결과는 세기 s = 1 기준이며, 실제 값은 P·s, U·s² 로 배율한다.
 */
import type { Medium } from './acoustics';
import { gorkovPotential, type Particle } from './gorkov';
import type { SourceSet } from './sourceSampling';
import { AXIS_SPACING_FRACTION, DOMAIN_HALF_WIDTH, FACE_MARGIN_FRACTION, GRID_SPACING_FRACTION } from './constants';

/** 한 점의 복소 압력과 복소 기울기 */
export interface PointField {
  pr: number;
  pi: number;
  gxr: number;
  gxi: number;
  gyr: number;
  gyi: number;
  gzr: number;
  gzi: number;
}

export function newPointField(): PointField {
  return { pr: 0, pi: 0, gxr: 0, gxi: 0, gyr: 0, gyi: 0, gzr: 0, gzi: 0 };
}

/**
 * 점 (x, y, z)에서 모든 점음원의 합 P와 ∇P (해석적).
 * ∇P_j = P_j·(ik − 1/R)·(r − r_j)/R. 지향성 D = (1 + n_j·Δ/R)/2를 쓰면 (n_j: 점음원 방사 방향)
 * ∇(D·P_j) = D·∇P_j + P_j·∇D, ∇D = (n_j/R − (n_j·Δ)·Δ/R³)/2.
 */
export function evalField(
  src: SourceSet,
  k: number,
  x: number,
  y: number,
  z: number,
  directivity: boolean,
  out: PointField = newPointField(),
): PointField {
  let pr = 0, pi = 0, gxr = 0, gxi = 0, gyr = 0, gyi = 0, gzr = 0, gzi = 0;
  const n = src.n;
  for (let j = 0; j < n; j++) {
    const dx = x - src.x[j];
    const dy = y - src.y[j];
    const dz = z - src.z[j];
    const R2 = dx * dx + dy * dy + dz * dz;
    const R = Math.sqrt(R2);
    const invR = 1 / R;
    const kR = k * R;
    const er = Math.cos(kR) * invR;
    const ei = Math.sin(kR) * invR;
    // P_j = c_j · e
    const cr = src.cRe[j];
    const ci = src.cIm[j];
    let Pr = cr * er - ci * ei;
    let Pi = cr * ei + ci * er;
    // g = (ik − 1/R)/R  → 실수부 −1/R², 허수부 k/R
    const gr = -invR * invR;
    const gi = k * invR;
    // P_j·g
    const qr = Pr * gr - Pi * gi;
    const qi = Pr * gi + Pi * gr;
    let ax = qr * dx, axi = qi * dx;
    let ay = qr * dy, ayi = qi * dy;
    let az = qr * dz, azi = qi * dz;
    if (directivity) {
      // D = (1 + n·Δ/R)/2,  ∇D = (n/R − (n·Δ)Δ/R³)/2   (n: 점음원 방사 방향 단위 법선)
      const nx = src.nx[j];
      const ny = src.ny[j];
      const nz = src.nz[j];
      const nd = nx * dx + ny * dy + nz * dz;
      const D = 0.5 * (1 + nd * invR);
      const invR3 = invR * invR * invR;
      const hx = 0.5 * (nx * invR - nd * dx * invR3);
      const hy = 0.5 * (ny * invR - nd * dy * invR3);
      const hz = 0.5 * (nz * invR - nd * dz * invR3);
      ax = D * ax + Pr * hx;
      axi = D * axi + Pi * hx;
      ay = D * ay + Pr * hy;
      ayi = D * ayi + Pi * hy;
      az = D * az + Pr * hz;
      azi = D * azi + Pi * hz;
      Pr *= D;
      Pi *= D;
    }
    pr += Pr;
    pi += Pi;
    gxr += ax;
    gxi += axi;
    gyr += ay;
    gyi += ayi;
    gzr += az;
    gzi += azi;
  }
  out.pr = pr;
  out.pi = pi;
  out.gxr = gxr;
  out.gxi = gxi;
  out.gyr = gyr;
  out.gyi = gyi;
  out.gzr = gzr;
  out.gzi = gzi;
  return out;
}

export function absP2(f: PointField): number {
  return f.pr * f.pr + f.pi * f.pi;
}

export function absGrad2(f: PointField): number {
  return (
    f.gxr * f.gxr + f.gxi * f.gxi + f.gyr * f.gyr + f.gyi * f.gyi + f.gzr * f.gzr + f.gzi * f.gzi
  );
}

/**
 * 시간 평균 음향 세기 벡터 I = ½·Re(p·v*) [W/m²] (s = 1 기준이면 s²를 곱해 쓴다).
 * v = ∇P/(iωρ0), p(t) = Re[P·e^(−iωt)] 규약에서 I = Im(P*·∇P) / (2ωρ0).
 * 순수 정상파에서는 0이고, 진행파 성분이 있으면 에너지가 흐르는 방향을 가리킨다.
 */
export function intensityOf(f: PointField, med: Medium, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const c = 1 / (2 * med.omega * med.rho0);
  out.x = (f.pr * f.gxi - f.pi * f.gxr) * c;
  out.y = (f.pr * f.gyi - f.pi * f.gyr) * c;
  out.z = (f.pr * f.gzi - f.pi * f.gzr) * c;
  return out;
}

// ───────────── 계산 영역 ─────────────

export interface Domain {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

/** x ∈ [−12mm, 12mm], z ∈ [λ/8, d − λ/8] */
export function computeDomain(d: number, lambda: number): Domain {
  const m = lambda * FACE_MARGIN_FRACTION;
  return { xMin: -DOMAIN_HALF_WIDTH, xMax: DOMAIN_HALF_WIDTH, zMin: m, zMax: d - m };
}

// ───────────── 2D 격자 ─────────────

/** s = 1 기준 2D 음향장. 인덱스 = iz·nx + ix */
export interface FieldGrid {
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  hx: number;
  hz: number;
  pRe: Float32Array;
  pIm: Float32Array;
  /** |P|² */
  p2: Float32Array;
  /** |∇P|² */
  g2: Float32Array;
  /** 음향 세기 I_x, I_z [W/m²] (s = 1 기준, 진행파 복사압용) */
  Ix: Float32Array;
  Iz: Float32Array;
}

export function computeFieldGrid(
  src: SourceSet,
  med: Medium,
  domain: Domain,
  directivity: boolean,
  spacingFraction = GRID_SPACING_FRACTION,
): FieldGrid {
  const hMax = med.lambda * spacingFraction;
  const nx = Math.max(2, Math.ceil((domain.xMax - domain.xMin) / hMax) + 1);
  const nz = Math.max(2, Math.ceil((domain.zMax - domain.zMin) / hMax) + 1);
  const hx = (domain.xMax - domain.xMin) / (nx - 1);
  const hz = (domain.zMax - domain.zMin) / (nz - 1);
  const N = nx * nz;
  const grid: FieldGrid = {
    nx,
    nz,
    x0: domain.xMin,
    z0: domain.zMin,
    hx,
    hz,
    pRe: new Float32Array(N),
    pIm: new Float32Array(N),
    p2: new Float32Array(N),
    g2: new Float32Array(N),
    Ix: new Float32Array(N),
    Iz: new Float32Array(N),
  };
  const f = newPointField();
  const I = { x: 0, y: 0, z: 0 };
  for (let iz = 0; iz < nz; iz++) {
    const z = domain.zMin + iz * hz;
    for (let ix = 0; ix < nx; ix++) {
      const x = domain.xMin + ix * hx;
      evalField(src, med.k, x, 0, z, directivity, f);
      const i = iz * nx + ix;
      grid.pRe[i] = f.pr;
      grid.pIm[i] = f.pi;
      grid.p2[i] = absP2(f);
      grid.g2[i] = absGrad2(f);
      intensityOf(f, med, I);
      grid.Ix[i] = I.x;
      grid.Iz[i] = I.z;
    }
  }
  return grid;
}

/**
 * s = 1 기준 Gor'kov 퍼텐셜 격자와 힘 격자 F = −∇U (중앙 차분, 가장자리는 한쪽 차분).
 * U = V·(f1·α − f2·β), α = |P|²/(4ρ0c²), β = (3/8)|∇P|²/(ω²ρ0) 로 나눠
 * 공 물성과 무관한 −∇α(Fa), −∇β(Fb)도 저장한다 → F = V·(f1·Fa − f2·Fb).
 * (공의 밀도·지름을 바꿔도 격자를 다시 만들 필요 없음)
 */
export interface PotentialGrid {
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  hx: number;
  hz: number;
  U: Float32Array;
  Fx: Float32Array;
  Fz: Float32Array;
  Fax: Float32Array;
  Faz: Float32Array;
  Fbx: Float32Array;
  Fbz: Float32Array;
}

/** −∇v (중앙 차분, 가장자리는 한쪽 차분) */
function negGradient(v: Float64Array, nx: number, nz: number, hx: number, hz: number, gx: Float32Array, gz: Float32Array): void {
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      let dx: number;
      if (ix === 0) dx = (v[i + 1] - v[i]) / hx;
      else if (ix === nx - 1) dx = (v[i] - v[i - 1]) / hx;
      else dx = (v[i + 1] - v[i - 1]) / (2 * hx);
      let dz: number;
      if (iz === 0) dz = (v[i + nx] - v[i]) / hz;
      else if (iz === nz - 1) dz = (v[i] - v[i - nx]) / hz;
      else dz = (v[i + nx] - v[i - nx]) / (2 * hz);
      gx[i] = -dx;
      gz[i] = -dz;
    }
  }
}

export function computePotentialGrid(grid: FieldGrid, med: Medium, p: Particle): PotentialGrid {
  const { nx, nz, hx, hz } = grid;
  const N = nx * nz;
  // 값이 작으므로(~1e-7 J) 계산은 double로 하고 저장만 Float32
  const Ud = new Float64Array(N);
  const alpha = new Float64Array(N);
  const beta = new Float64Array(N);
  const ca = 1 / (4 * med.rho0 * med.c * med.c);
  const cb = 0.375 / (med.omega * med.omega * med.rho0);
  for (let i = 0; i < N; i++) {
    Ud[i] = gorkovPotential(grid.p2[i], grid.g2[i], med, p);
    alpha[i] = ca * grid.p2[i];
    beta[i] = cb * grid.g2[i];
  }
  const pg: PotentialGrid = {
    nx,
    nz,
    x0: grid.x0,
    z0: grid.z0,
    hx,
    hz,
    U: Float32Array.from(Ud),
    Fx: new Float32Array(N),
    Fz: new Float32Array(N),
    Fax: new Float32Array(N),
    Faz: new Float32Array(N),
    Fbx: new Float32Array(N),
    Fbz: new Float32Array(N),
  };
  negGradient(Ud, nx, nz, hx, hz, pg.Fx, pg.Fz);
  negGradient(alpha, nx, nz, hx, hz, pg.Fax, pg.Faz);
  negGradient(beta, nx, nz, hx, hz, pg.Fbx, pg.Fbz);
  return pg;
}

/**
 * 임의 물성(V, f1, f2)의 공에 대한 힘: F = s²·V·(f1·Fa − f2·Fb) (쌍선형 보간, 격자 밖 0)
 */
export function sampleForceFor(
  pg: PotentialGrid,
  s2: number,
  V: number,
  f1: number,
  f2: number,
  x: number,
  z: number,
  out: { fx: number; fz: number },
): boolean {
  const u = (x - pg.x0) / pg.hx;
  const v = (z - pg.z0) / pg.hz;
  if (!(u >= 0 && v >= 0 && u <= pg.nx - 1 && v <= pg.nz - 1)) {
    out.fx = 0;
    out.fz = 0;
    return false;
  }
  let i0 = Math.floor(u);
  let j0 = Math.floor(v);
  if (i0 >= pg.nx - 1) i0 = pg.nx - 2;
  if (j0 >= pg.nz - 1) j0 = pg.nz - 2;
  const tu = u - i0;
  const tv = v - j0;
  const a = j0 * pg.nx + i0;
  const b = a + 1;
  const c = a + pg.nx;
  const e = c + 1;
  const w00 = (1 - tu) * (1 - tv);
  const w10 = tu * (1 - tv);
  const w01 = (1 - tu) * tv;
  const w11 = tu * tv;
  const ax = w00 * pg.Fax[a] + w10 * pg.Fax[b] + w01 * pg.Fax[c] + w11 * pg.Fax[e];
  const az = w00 * pg.Faz[a] + w10 * pg.Faz[b] + w01 * pg.Faz[c] + w11 * pg.Faz[e];
  const bx = w00 * pg.Fbx[a] + w10 * pg.Fbx[b] + w01 * pg.Fbx[c] + w11 * pg.Fbx[e];
  const bz = w00 * pg.Fbz[a] + w10 * pg.Fbz[b] + w01 * pg.Fbz[c] + w11 * pg.Fbz[e];
  const k = s2 * V;
  out.fx = k * (f1 * ax - f2 * bx);
  out.fz = k * (f1 * az - f2 * bz);
  return true;
}

/**
 * 공 위치의 힘 (쌍선형 보간). s2 = s² 배율.
 * 격자 밖이면 음향 방사력 0 (SPEC 2.4). 반환값: 격자 안이면 true.
 */
export function sampleForce(
  pg: PotentialGrid,
  s2: number,
  x: number,
  z: number,
  out: { fx: number; fz: number },
): boolean {
  const u = (x - pg.x0) / pg.hx;
  const v = (z - pg.z0) / pg.hz;
  if (!(u >= 0 && v >= 0 && u <= pg.nx - 1 && v <= pg.nz - 1)) {
    out.fx = 0;
    out.fz = 0;
    return false;
  }
  let i0 = Math.floor(u);
  let j0 = Math.floor(v);
  if (i0 >= pg.nx - 1) i0 = pg.nx - 2;
  if (j0 >= pg.nz - 1) j0 = pg.nz - 2;
  const tu = u - i0;
  const tv = v - j0;
  const a = j0 * pg.nx + i0;
  const b = a + 1;
  const c = a + pg.nx;
  const e = c + 1;
  const w00 = (1 - tu) * (1 - tv);
  const w10 = tu * (1 - tv);
  const w01 = (1 - tu) * tv;
  const w11 = tu * tv;
  out.fx = s2 * (w00 * pg.Fx[a] + w10 * pg.Fx[b] + w01 * pg.Fx[c] + w11 * pg.Fx[e]);
  out.fz = s2 * (w00 * pg.Fz[a] + w10 * pg.Fz[b] + w01 * pg.Fz[c] + w11 * pg.Fz[e]);
  return true;
}

// ───────────── 축 위 1D 샘플 ─────────────

/** s = 1 기준 축(x = 0) 위 |P|², |∇P|² (double) */
export interface AxisProfile {
  z: Float64Array;
  p2: Float64Array;
  g2: Float64Array;
  /** 축 방향 음향 세기 [W/m²] (s = 1 기준) */
  Iz: Float64Array;
}

export function computeAxisProfile(
  src: SourceSet,
  med: Medium,
  zMin: number,
  zMax: number,
  directivity: boolean,
  spacingFraction = AXIS_SPACING_FRACTION,
): AxisProfile {
  const hMax = med.lambda * spacingFraction;
  const n = Math.max(3, Math.ceil((zMax - zMin) / hMax) + 1);
  const h = (zMax - zMin) / (n - 1);
  const prof: AxisProfile = {
    z: new Float64Array(n),
    p2: new Float64Array(n),
    g2: new Float64Array(n),
    Iz: new Float64Array(n),
  };
  const I = { x: 0, y: 0, z: 0 };
  const f = newPointField();
  for (let i = 0; i < n; i++) {
    const z = zMin + i * h;
    evalField(src, med.k, 0, 0, z, directivity, f);
    prof.z[i] = z;
    prof.p2[i] = absP2(f);
    prof.g2[i] = absGrad2(f);
    prof.Iz[i] = intensityOf(f, med, I).z;
  }
  return prof;
}

/** 축 위 U (s2 = s² 배율) */
export function axisPotential(prof: AxisProfile, med: Medium, p: Particle, s2: number): Float64Array {
  const n = prof.z.length;
  const U = new Float64Array(n);
  for (let i = 0; i < n; i++) U[i] = s2 * gorkovPotential(prof.p2[i], prof.g2[i], med, p);
  return U;
}

/** 이웃 3점 포물선 보간으로 극점 위치와 값을 다듬는다 */
function parabolicRefine(z: Float64Array, v: ArrayLike<number>, i: number): { z: number; v: number } {
  const ym = v[i - 1];
  const y0 = v[i];
  const yp = v[i + 1];
  const den = ym - 2 * y0 + yp;
  if (den === 0) return { z: z[i], v: y0 };
  const off = (0.5 * (ym - yp)) / den;
  const h = z[i + 1] - z[i];
  return { z: z[i] + off * h, v: y0 - 0.25 * (ym - yp) * off };
}

/** 내부 국소 최소점 (양 끝 제외) */
export function findLocalMinima(z: Float64Array, v: ArrayLike<number>): { z: number; v: number }[] {
  const out: { z: number; v: number }[] = [];
  for (let i = 1; i < z.length - 1; i++) {
    if (v[i] < v[i - 1] && v[i] <= v[i + 1]) out.push(parabolicRefine(z, v, i));
  }
  return out;
}

/** 전체 최댓값 (내부면 포물선 보간) */
export function findMaximum(z: Float64Array, v: ArrayLike<number>): { z: number; v: number } {
  let im = 0;
  for (let i = 1; i < z.length; i++) if (v[i] > v[im]) im = i;
  if (im === 0 || im === z.length - 1) return { z: z[im], v: v[im] };
  return parabolicRefine(z, v, im);
}

/** 축 위 최대 |P| (s = 1 기준) */
export function axisMaxPressure(prof: AxisProfile): number {
  return Math.sqrt(findMaximum(prof.z, prof.p2).v);
}

/** 축 위 압력 마디 (|P|² 국소 최소) */
export function axisPressureNodes(prof: AxisProfile): number[] {
  return findLocalMinima(prof.z, prof.p2).map((m) => m.z);
}

/** 축 위 F_z = −dU/dz (1D 샘플에서 중앙 차분, 양 끝은 한쪽 차분) */
export function axisForce(z: Float64Array, U: ArrayLike<number>): Float64Array {
  const n = z.length;
  const F = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = i === 0 ? 0 : i - 1;
    const b = i === n - 1 ? n - 1 : i + 1;
    F[i] = -(U[b] - U[a]) / (z[b] - z[a]);
  }
  return F;
}

/**
 * 진행파 복사압 F = coeff·I (쌍선형 보간, 격자 밖 0). coeff = pushCoeff·s² (세기는 s = 1 기준이므로)
 */
export function samplePush(grid: FieldGrid, coeff: number, x: number, z: number, out: { fx: number; fz: number }): void {
  const u = (x - grid.x0) / grid.hx;
  const v = (z - grid.z0) / grid.hz;
  if (coeff === 0 || !(u >= 0 && v >= 0 && u <= grid.nx - 1 && v <= grid.nz - 1)) {
    out.fx = 0;
    out.fz = 0;
    return;
  }
  let i0 = Math.floor(u);
  let j0 = Math.floor(v);
  if (i0 >= grid.nx - 1) i0 = grid.nx - 2;
  if (j0 >= grid.nz - 1) j0 = grid.nz - 2;
  const tu = u - i0;
  const tv = v - j0;
  const a = j0 * grid.nx + i0;
  const b = a + 1;
  const c = a + grid.nx;
  const e = c + 1;
  const w00 = (1 - tu) * (1 - tv);
  const w10 = tu * (1 - tv);
  const w01 = (1 - tu) * tv;
  const w11 = tu * tv;
  out.fx = coeff * (w00 * grid.Ix[a] + w10 * grid.Ix[b] + w01 * grid.Ix[c] + w11 * grid.Ix[e]);
  out.fz = coeff * (w00 * grid.Iz[a] + w10 * grid.Iz[b] + w01 * grid.Iz[c] + w11 * grid.Iz[e]);
}
