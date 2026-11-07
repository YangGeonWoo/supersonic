/**
 * 2D 장(B층) 기준 부양 한계.
 *
 * 1차원 해석식(A층) F_max = mg는 공이 실제로 떨어지는 무게를 약 10% 크게 잡는다
 * (유한 발생기의 근접장 때문에 B층 축 방향 최대 힘이 해석식보다 작음).
 * 여기서는 공이 있는 덫에서 축 위 실제 힘(Gor'kov + 밀림)의 위쪽 최대값으로 한계를 구한다.
 *
 * 축 위 힘을 공 물성과 무관한 두 부분으로 나눈다:
 *   F_z(ρp) = s²·V·(f1·Fa − f2(ρp)·Fb) + F_push,   Fa = −dα/dz, Fb = −dβ/dz
 *   α = |P|²/(4ρ0c²), β = (3/8)|∇P|²/(ω²ρ0)
 * 한계 밀도는 max_z F_z(ρ) = ρ·V·g 의 해 (f2가 ρ에 약하게 의존하므로 고정점 반복).
 */
import { GRAVITY } from '../physics/constants';
import { findLocalMinima } from '../physics/field2d';
import { makeParticle } from '../physics/gorkov';
import type { Scene } from './scene';

interface AxisParts {
  z: Float64Array;
  Fa: Float64Array;
  Fb: Float64Array;
}

const partsCache = new WeakMap<Scene, AxisParts>();

function axisParts(sc: Scene): AxisParts {
  const hit = partsCache.get(sc);
  if (hit) return hit;
  const { z, p2, g2 } = sc.axis;
  const med = sc.med;
  const ca = 1 / (4 * med.rho0 * med.c * med.c);
  const cb = 0.375 / (med.omega * med.omega * med.rho0);
  const n = z.length;
  const Fa = new Float64Array(n);
  const Fb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = i === 0 ? 0 : i - 1;
    const b = i === n - 1 ? n - 1 : i + 1;
    const dz = z[b] - z[a];
    Fa[i] = (-ca * (p2[b] - p2[a])) / dz;
    Fb[i] = (-cb * (g2[b] - g2[a])) / dz;
  }
  const parts = { z, Fa, Fb };
  partsCache.set(sc, parts);
  return parts;
}

/** zNear에 가장 가까운 덫(축 위 U 최소) */
export function trapNear(sc: Scene, zNear: number): number | null {
  const mins = findLocalMinima(sc.axis.z, sc.axisU);
  if (mins.length === 0) return null;
  return mins.reduce((a, b) => (Math.abs(b.z - zNear) < Math.abs(a.z - zNear) ? b : a)).z;
}

/** 덫 아래 λ/4 구간에서 축 방향 위쪽 최대 힘 [N] (밀도 rhoP의 공) */
export function maxUpwardForce(sc: Scene, zTrap: number, rhoP: number): number {
  const { z, Fa, Fb } = axisParts(sc);
  const p = makeParticle(sc.params.ballDiameter, rhoP, sc.params.Kp, sc.med);
  const s2 = sc.s * sc.s;
  const lo = zTrap - sc.med.lambda / 4;
  let best = 0;
  for (let i = 0; i < z.length; i++) {
    if (z[i] < lo || z[i] > zTrap) continue;
    const F = s2 * p.V * (p.f1 * Fa[i] - p.f2 * Fb[i]) + sc.axisFpush[i];
    if (F > best) best = F;
  }
  return best;
}

/** 힘 여유 max F_z / mg (2D 장 기준) */
export function fieldMargin(sc: Scene, zTrap: number, rhoP: number): number {
  const p = makeParticle(sc.params.ballDiameter, rhoP, sc.params.Kp, sc.med);
  return maxUpwardForce(sc, zTrap, rhoP) / (p.m * GRAVITY);
}

/** 2D 장 기준 부양 한계 밀도 [kg/m³]: max F_z(ρ) = ρ·V·g */
export function fieldLimitDensity(sc: Scene, zTrap: number): number {
  const V = sc.particle.V;
  let rho = sc.particle.rhoP;
  for (let k = 0; k < 30; k++) {
    const next = maxUpwardForce(sc, zTrap, rho) / (V * GRAVITY);
    if (!(next > 0)) return 0;
    if (Math.abs(next - rho) < 1e-9 * next) return next;
    rho = next;
  }
  return rho;
}
