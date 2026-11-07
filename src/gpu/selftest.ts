/**
 * GPU 격자 검증: 격자의 임의 점에서 GPU 값과 CPU evalField(기준값)를 비교한다.
 * 상대오차는 비교한 점들의 최댓값 기준 (마디 근처처럼 값이 0에 가까운 곳에서 나눗셈이 커지지 않게).
 */
import type { Medium } from '../physics/acoustics';
import { absGrad2, evalField, intensityOf, newPointField } from '../physics/field2d';
import type { Grid3 } from '../physics/grid3';
import type { SourceSet } from '../physics/sourceSampling';

export interface SelfTestResult {
  points: number;
  /** max |P_gpu − P_cpu| / max |P_cpu| */
  relP: number;
  /** max ||∇P|²_gpu − |∇P|²_cpu| / max |∇P|²_cpu */
  relG2: number;
  /** max |I_gpu − I_cpu| / max |I_cpu| */
  relI: number;
}

export function compareWithCpu(grid: Grid3, src: SourceSet, med: Medium, directivity: boolean, count = 300, seed = 12345): SelfTestResult {
  let st = seed >>> 0;
  const rand = () => {
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    return st / 4294967296;
  };
  const f = newPointField();
  const I = { x: 0, y: 0, z: 0 };
  let dP = 0;
  let mP = 0;
  let dG = 0;
  let mG = 0;
  let dI = 0;
  let mI = 0;
  for (let n = 0; n < count; n++) {
    const ix = Math.floor(rand() * grid.nx);
    const iy = Math.floor(rand() * grid.ny);
    const iz = Math.floor(rand() * grid.nz);
    const i = (iz * grid.ny + iy) * grid.nx + ix;
    evalField(src, med.k, grid.x0 + ix * grid.hx, grid.y0 + iy * grid.hy, grid.z0 + iz * grid.hz, directivity, f);
    intensityOf(f, med, I);
    dP = Math.max(dP, Math.hypot(grid.pRe[i] - f.pr, grid.pIm[i] - f.pi));
    mP = Math.max(mP, Math.hypot(f.pr, f.pi));
    const g2 = absGrad2(f);
    dG = Math.max(dG, Math.abs(grid.g2[i] - g2));
    mG = Math.max(mG, g2);
    dI = Math.max(dI, Math.hypot(grid.Ix[i] - I.x, grid.Iy[i] - I.y, grid.Iz[i] - I.z));
    mI = Math.max(mI, Math.hypot(I.x, I.y, I.z));
  }
  return { points: count, relP: dP / mP, relG2: dG / mG, relI: dI / mI };
}
