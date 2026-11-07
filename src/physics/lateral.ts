/**
 * 횡방향(축에서 벗어나는 방향) 안정성.
 *
 * 장은 축대칭이므로 덫 높이 z에서 반지름 방향 1D 프로파일만 보면 된다.
 *   U(ρ)   : Gor'kov 퍼텐셜 (evalField로 직접 계산, 간격 ≤ λ/200 — 축 프로파일과 같은 방식)
 *   F_ρ(ρ) : −dU/dρ (+ 진행파 복사압의 ρ 성분, pushCoeff > 0일 때)
 *   κ_ρ    : ρ = 0 근처에서 F_ρ ≈ −κ_ρ·ρ 최소제곱 (양수 = 축으로 복원)
 *   κ_z    : 축 위 덫에서 F_z ≈ −κ_z·(z − z_trap) 최소제곱
 */
import type { Medium } from './acoustics';
import { AXIS_SPACING_FRACTION } from './constants';
import { absGrad2, absP2, evalField, findLocalMinima, intensityOf, newPointField } from './field2d';
import { gorkovPotential, type Particle } from './gorkov';
import type { SourceSet } from './sourceSampling';

export interface RadialProfile {
  /** 덫 높이 [m] */
  z: number;
  rho: Float64Array;
  /** Gor'kov 퍼텐셜 [J] */
  U: Float64Array;
  /** 반지름 방향 힘 합계 [N] (+ = 바깥쪽) */
  Frho: Float64Array;
  /** 그중 진행파 복사압 성분 [N] */
  FrhoPush: Float64Array;
}

/** 강성 맞춤 구간: λ/40 (마디 폭 λ/2보다 충분히 작음) */
export const STIFFNESS_FIT_FRACTION = 1 / 40;

/**
 * @param s2       실제 세기의 제곱 (s²)
 * @param pushCoeff 진행파 복사압 계수 Y_p·π a²/c [m²·s/m]. 0이면 Gor'kov만
 */
export function radialProfile(
  src: SourceSet,
  med: Medium,
  p: Particle,
  s2: number,
  z: number,
  rhoMax: number,
  directivity: boolean,
  pushCoeff = 0,
  spacingFraction = AXIS_SPACING_FRACTION,
): RadialProfile {
  const n = Math.max(3, Math.ceil(rhoMax / (med.lambda * spacingFraction)) + 1);
  const h = rhoMax / (n - 1);
  const prof: RadialProfile = {
    z,
    rho: new Float64Array(n),
    U: new Float64Array(n),
    Frho: new Float64Array(n),
    FrhoPush: new Float64Array(n),
  };
  const f = newPointField();
  const I = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    const rho = i * h;
    evalField(src, med.k, rho, 0, z, directivity, f);
    prof.rho[i] = rho;
    prof.U[i] = s2 * gorkovPotential(absP2(f), absGrad2(f), med, p);
    if (pushCoeff > 0) {
      intensityOf(f, med, I);
      prof.FrhoPush[i] = i === 0 ? 0 : pushCoeff * s2 * I.x; // 축 위에서는 대칭으로 0
    }
  }
  for (let i = 0; i < n; i++) {
    let dU: number;
    if (i === 0) dU = 0; // 대칭
    else if (i === n - 1) dU = (prof.U[i] - prof.U[i - 1]) / h;
    else dU = (prof.U[i + 1] - prof.U[i - 1]) / (2 * h);
    prof.Frho[i] = -dU + prof.FrhoPush[i];
  }
  return prof;
}

/** x0 근처 [x0 − r, x0 + r]에서 F ≈ −κ·(x − x0) 최소제곱 (원점 고정 기울기) */
export function stiffnessFit(x: ArrayLike<number>, F: ArrayLike<number>, x0: number, r: number): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - x0;
    if (Math.abs(dx) > r || dx === 0) continue;
    num += F[i] * dx;
    den += dx * dx;
  }
  return den > 0 ? -num / den : NaN;
}

/** 축 위 U 최소점 중 z에 가장 가까운 것 (없으면 null) */
export function nearestTrap(axisZ: Float64Array, axisU: ArrayLike<number>, z: number): number | null {
  const mins = findLocalMinima(axisZ, axisU);
  if (mins.length === 0) return null;
  let best = mins[0].z;
  for (const m of mins) if (Math.abs(m.z - z) < Math.abs(best - z)) best = m.z;
  return best;
}

export interface LateralResult {
  zTrap: number;
  profile: RadialProfile;
  /** 횡방향 강성 [N/m] (양수 = 복원) */
  kappaRho: number;
  /** 축 방향 강성 [N/m] */
  kappaZ: number;
  /** κ_ρ / κ_z */
  ratio: number;
  /** κ_ρ > 0 */
  stable: boolean;
  /** 축 밖에서 F_ρ가 다시 복원으로 바뀌는 반지름 (불안정할 때 공이 머무는 곳 근사, 없으면 null) */
  ringRadius: number | null;
}

/**
 * @param axisZ, axisFz 축 위 z 샘플과 F_z 합계 (Gor'kov + 밀림) [N]
 */
export function lateralStability(
  src: SourceSet,
  med: Medium,
  p: Particle,
  s2: number,
  zTrap: number,
  axisZ: Float64Array,
  axisFz: ArrayLike<number>,
  directivity: boolean,
  pushCoeff = 0,
  rhoMax = 10e-3,
): LateralResult {
  const profile = radialProfile(src, med, p, s2, zTrap, rhoMax, directivity, pushCoeff);
  const r = med.lambda * STIFFNESS_FIT_FRACTION;
  const kappaRho = stiffnessFit(profile.rho, profile.Frho, 0, r);
  const kappaZ = stiffnessFit(axisZ, axisFz, zTrap, r);
  let ringRadius: number | null = null;
  if (!(kappaRho > 0)) {
    for (let i = 1; i < profile.rho.length; i++) {
      if (profile.Frho[i - 1] > 0 && profile.Frho[i] <= 0) {
        const t = profile.Frho[i - 1] / (profile.Frho[i - 1] - profile.Frho[i]);
        ringRadius = profile.rho[i - 1] + t * (profile.rho[i] - profile.rho[i - 1]);
        break;
      }
    }
  }
  return { zTrap, profile, kappaRho, kappaZ, ratio: kappaRho / kappaZ, stable: kappaRho > 0, ringRadius };
}
