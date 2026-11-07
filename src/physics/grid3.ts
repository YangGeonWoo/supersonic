/**
 * 3D 격자 음향장 (축대칭 가정 없음). GPU(src/gpu/fieldGpu.ts)와 CPU(computeGrid3Cpu)가 같은 형식을 만든다.
 *
 * 저장값 (s = 1 기준, Float32): P(복소), |∇P|², 음향 세기 I (x, y, z), 유효 표시(mask).
 * 인덱스 i = (iz·ny + iy)·nx + ix.
 * 힘·퍼텐셜은 공 물성에 따라 달라지므로 여기서 저장하지 않고 필요한 곳에서 계산한다 (force3.ts).
 */
import type { Medium } from './acoustics';
import { DOMAIN_HALF_WIDTH, FACE_MARGIN_FRACTION } from './constants';
import { absGrad2, absP2, evalField, intensityOf, newPointField } from './field2d';
import { transducerPlanes, type SourceSet, type UpperPose } from './sourceSampling';

export interface Domain3 {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

/** x, y ∈ ±12 mm, z ∈ [λ/8, d − λ/8 + 위 면 기울기로 올라간 만큼] (면 근처는 mask로 제외) */
export function computeDomain3(d: number, lambda: number, pose: UpperPose): Domain3 {
  const m = lambda * FACE_MARGIN_FRACTION;
  const lift = DOMAIN_HALF_WIDTH * Math.abs(Math.sin(pose.tilt));
  return {
    xMin: -DOMAIN_HALF_WIDTH,
    xMax: DOMAIN_HALF_WIDTH,
    yMin: -DOMAIN_HALF_WIDTH,
    yMax: DOMAIN_HALF_WIDTH,
    zMin: m,
    zMax: d - m + lift,
  };
}

export interface Grid3 {
  nx: number;
  ny: number;
  nz: number;
  x0: number;
  y0: number;
  z0: number;
  hx: number;
  hy: number;
  hz: number;
  pRe: Float32Array;
  pIm: Float32Array;
  /** |P|² */
  p2: Float32Array;
  /** |∇P|² */
  g2: Float32Array;
  Ix: Float32Array;
  Iy: Float32Array;
  Iz: Float32Array;
  /** 1 = 계산 영역 (두 발생기 면에서 λ/8 이상 떨어진 사이), 0 = 제외 */
  mask: Uint8Array;
}

/** 격자 크기: 간격 ≤ λ·spacing */
export function gridDims(dom: Domain3, lambda: number, spacingFraction: number) {
  const h = lambda * spacingFraction;
  const nx = Math.max(2, Math.ceil((dom.xMax - dom.xMin) / h) + 1);
  const ny = Math.max(2, Math.ceil((dom.yMax - dom.yMin) / h) + 1);
  const nz = Math.max(2, Math.ceil((dom.zMax - dom.zMin) / h) + 1);
  return {
    nx,
    ny,
    nz,
    x0: dom.xMin,
    y0: dom.yMin,
    z0: dom.zMin,
    hx: (dom.xMax - dom.xMin) / (nx - 1),
    hy: (dom.yMax - dom.yMin) / (ny - 1),
    hz: (dom.zMax - dom.zMin) / (nz - 1),
  };
}

export type GridDims = ReturnType<typeof gridDims>;

export function allocGrid3(g: GridDims): Grid3 {
  const N = g.nx * g.ny * g.nz;
  return {
    ...g,
    pRe: new Float32Array(N),
    pIm: new Float32Array(N),
    p2: new Float32Array(N),
    g2: new Float32Array(N),
    Ix: new Float32Array(N),
    Iy: new Float32Array(N),
    Iz: new Float32Array(N),
    mask: new Uint8Array(N),
  };
}

/** 두 발생기 면 사이이고 각 면에서 λ/8 이상 떨어진 점만 계산 영역 */
export function fillMask(grid: Grid3, d: number, lambda: number, pose: UpperPose): void {
  const m = lambda * FACE_MARGIN_FRACTION;
  const { lower, upper } = transducerPlanes(d, pose);
  for (let iz = 0; iz < grid.nz; iz++) {
    const z = grid.z0 + iz * grid.hz;
    for (let iy = 0; iy < grid.ny; iy++) {
      const y = grid.y0 + iy * grid.hy;
      for (let ix = 0; ix < grid.nx; ix++) {
        const x = grid.x0 + ix * grid.hx;
        const dl = (x - lower.px) * lower.nx + (y - lower.py) * lower.ny + (z - lower.pz) * lower.nz;
        const du = (x - upper.px) * upper.nx + (y - upper.py) * upper.ny + (z - upper.pz) * upper.nz;
        grid.mask[(iz * grid.ny + iy) * grid.nx + ix] = dl >= m && du >= m ? 1 : 0;
      }
    }
  }
}

/** CPU 기준 계산 (느림 — 테스트와 GPU 검증용). evalField를 격자 전체에 돌린다 */
export function computeGrid3Cpu(src: SourceSet, med: Medium, g: GridDims, directivity: boolean): Grid3 {
  const grid = allocGrid3(g);
  const f = newPointField();
  const I = { x: 0, y: 0, z: 0 };
  for (let iz = 0; iz < g.nz; iz++) {
    const z = g.z0 + iz * g.hz;
    for (let iy = 0; iy < g.ny; iy++) {
      const y = g.y0 + iy * g.hy;
      for (let ix = 0; ix < g.nx; ix++) {
        const i = (iz * g.ny + iy) * g.nx + ix;
        evalField(src, med.k, g.x0 + ix * g.hx, y, z, directivity, f);
        grid.pRe[i] = f.pr;
        grid.pIm[i] = f.pi;
        grid.p2[i] = absP2(f);
        grid.g2[i] = absGrad2(f);
        intensityOf(f, med, I);
        grid.Ix[i] = I.x;
        grid.Iy[i] = I.y;
        grid.Iz[i] = I.z;
      }
    }
  }
  return grid;
}

/** 삼선형 보간 가중치 (격자 밖이면 null). 8개 꼭짓점 인덱스와 가중치 */
export interface Trilinear {
  idx: Int32Array;
  w: Float64Array;
}

export function newTrilinear(): Trilinear {
  return { idx: new Int32Array(8), w: new Float64Array(8) };
}

/** (x, y, z)의 삼선형 보간 꼭짓점. 격자 밖이거나 제외 영역(mask 0)이 섞이면 false */
export function trilinearAt(g: Grid3, x: number, y: number, z: number, out: Trilinear): boolean {
  const u = (x - g.x0) / g.hx;
  const v = (y - g.y0) / g.hy;
  const t = (z - g.z0) / g.hz;
  if (!(u >= 0 && v >= 0 && t >= 0 && u <= g.nx - 1 && v <= g.ny - 1 && t <= g.nz - 1)) return false;
  let i0 = Math.floor(u);
  let j0 = Math.floor(v);
  let k0 = Math.floor(t);
  if (i0 >= g.nx - 1) i0 = g.nx - 2;
  if (j0 >= g.ny - 1) j0 = g.ny - 2;
  if (k0 >= g.nz - 1) k0 = g.nz - 2;
  const fu = u - i0;
  const fv = v - j0;
  const ft = t - k0;
  let n = 0;
  for (let dk = 0; dk < 2; dk++) {
    for (let dj = 0; dj < 2; dj++) {
      for (let di = 0; di < 2; di++) {
        const i = ((k0 + dk) * g.ny + (j0 + dj)) * g.nx + (i0 + di);
        if (!g.mask[i]) return false;
        out.idx[n] = i;
        out.w[n] = (di ? fu : 1 - fu) * (dj ? fv : 1 - fv) * (dk ? ft : 1 - ft);
        n++;
      }
    }
  }
  return true;
}

/** 보간 꼭짓점으로 배열 값 보간 */
export function interp(a: Float32Array, tl: Trilinear): number {
  let s = 0;
  for (let n = 0; n < 8; n++) s += a[tl.idx[n]] * tl.w[n];
  return s;
}
