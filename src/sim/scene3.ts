/**
 * GPU 3D 격자 모드의 장면: Grid3(GPU 또는 CPU로 계산한 P, ∇P, I) + 실제 세기 + 공 물성 → 힘 모델, 덫, 강성.
 * 축대칭을 가정하지 않으므로 위 발생기 기울기·어긋남이 있어도 된다. React 의존 없음.
 */
import { makeMedium, type Medium } from '../physics/acoustics';
import { sourceStrength, splFromAmplitude, type Calibration } from '../physics/calibration';
import { GRAVITY } from '../physics/constants';
import { findTrap3, lateralStiffness3, makeForceModel, potentialAt, type ForceModel3, type LateralStiffness } from '../physics/force3';
import { makeParticle, maxForce, stiffness, type Particle } from '../physics/gorkov';
import { interp, newTrilinear, trilinearAt, type Grid3 } from '../physics/grid3';
import { dampingCoeff, oscillationPeriod, timeStep } from '../physics/integrator';
import type { SimParams } from '../physics/params';
import { pushCoefficient, radiationForceFunction } from '../physics/scattering';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface Scene3 {
  grid: Grid3;
  params: SimParams;
  med: Medium;
  particle: Particle;
  /** 실제 세기 s */
  s: number;
  /** 가운데 수직선 위 최대 |P| [Pa] */
  P0: number;
  spl: number;
  /** A층 해석식 (실제 P0) */
  Fmax: number;
  kappa: number;
  weight: number;
  Tosc: number;
  dt: number;
  /** 감쇠 계수: 위아래(A층 κ), 옆(가운데 덫의 옆 강성) */
  cdz: number;
  cdx: number;
  cdy: number;
  Yp: number;
  pushCoeff: number;
  model: ForceModel3;
  /** 덫 (중력 없는 힘 평형점), 아래부터 */
  traps: Point3[];
  /** 가운데 덫과 그 옆 방향 강성 */
  centralTrap: Point3 | null;
  lateral: LateralStiffness | null;
  /** 장 계산 시간 [ms]과 방식 */
  computeMs: number;
  backend: 'gpu' | 'cpu';
}

/** 가운데 수직선의 x (위 발생기가 어긋나 있으면 두 원판 중심의 가운데) */
export function centerLineX(p: SimParams): number {
  return p.offset / 2;
}

/** 수직선 (x, y) 위에서 U의 국소 최소들 (z 간격 hz/4) */
function lineMinima(model: ForceModel3, x: number, y: number): number[] {
  const g = model.grid;
  const h = g.hz / 4;
  const zs: number[] = [];
  const Us: number[] = [];
  for (let z = g.z0; z <= g.z0 + (g.nz - 1) * g.hz; z += h) {
    const U = potentialAt(model, x, y, z);
    if (U === U) {
      zs.push(z);
      Us.push(U);
    } else {
      zs.push(z);
      Us.push(Infinity);
    }
  }
  const out: number[] = [];
  for (let i = 1; i < zs.length - 1; i++) {
    if (Us[i] < Us[i - 1] && Us[i] <= Us[i + 1] && Number.isFinite(Us[i - 1]) && Number.isFinite(Us[i + 1])) out.push(zs[i]);
  }
  return out;
}

export function finishScene3(grid: Grid3, params: SimParams, cal: Calibration, computeMs: number, backend: 'gpu' | 'cpu'): Scene3 {
  const med = makeMedium(params.f, params.T);
  const particle = makeParticle(params.ballDiameter, params.rhoP, params.Kp, med);
  const s = sourceStrength(cal, params.drive, params.d, params.R, med);
  const s2 = s * s;
  const xc = centerLineX(params);

  // 가운데 수직선 위 최대 |P|
  const tl = newTrilinear();
  let pmax2 = 0;
  for (let z = grid.z0; z <= grid.z0 + (grid.nz - 1) * grid.hz; z += grid.hz / 4) {
    if (trilinearAt(grid, xc, 0, z, tl)) pmax2 = Math.max(pmax2, interp(grid.p2, tl));
  }
  const P0 = s * Math.sqrt(pmax2);
  const Fmax = maxForce(P0, med, particle);
  const kappa = stiffness(P0, med, particle);
  const Yp = radiationForceFunction(med.k * particle.a);
  const pushCoeff = params.travelingForce ? pushCoefficient(particle.a, med.k, med.c) : 0;
  const model = makeForceModel(grid, med, s2, particle.V, particle.f1, particle.f2, pushCoeff);

  // 덫: 가운데 수직선의 U 최소에서 출발해 3D 뉴턴으로 다듬음
  const traps: Point3[] = [];
  for (const z of lineMinima(model, xc, 0)) {
    const t = findTrap3(model, { x: xc, y: 0, z });
    if (t && !traps.some((q) => Math.hypot(q.x - t.x, q.y - t.y, q.z - t.z) < med.lambda / 8)) traps.push(t);
  }
  traps.sort((a, b) => a.z - b.z);
  const centralTrap = traps.length
    ? traps.reduce((a, b) => (Math.abs(b.z - params.d / 2) < Math.abs(a.z - params.d / 2) - 1e-9 ? b : a))
    : null;
  const lateral = centralTrap ? lateralStiffness3(model, centralTrap) : null;

  const K = lateral?.K;
  const kx = K ? Math.abs(K[0][0]) : 0.05 * kappa;
  const ky = K ? Math.abs(K[1][1]) : 0.05 * kappa;
  return {
    grid,
    params,
    med,
    particle,
    s,
    P0,
    spl: splFromAmplitude(P0),
    Fmax,
    kappa,
    weight: particle.m * GRAVITY,
    Tosc: oscillationPeriod(particle.m, kappa),
    dt: timeStep(particle.m, kappa),
    cdz: dampingCoeff(params.zeta, particle.m, kappa),
    cdx: dampingCoeff(params.zeta, particle.m, kx),
    cdy: dampingCoeff(params.zeta, particle.m, ky),
    Yp,
    pushCoeff,
    model,
    traps,
    centralTrap,
    lateral,
    computeMs,
    backend,
  };
}
