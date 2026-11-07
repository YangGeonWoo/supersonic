import type { Medium } from './acoustics';

/** 공(작은 구) 물성 */
export interface Particle {
  /** 반지름 [m] */
  a: number;
  /** 부피 [m³] */
  V: number;
  /** 밀도 [kg/m³] */
  rhoP: number;
  /** 질량 [kg] */
  m: number;
  /** 체적탄성률 [Pa] */
  Kp: number;
  /** 단극 계수 f1 = 1 − K0/Kp */
  f1: number;
  /** 쌍극 계수 f2 = 2(ρp − ρ0)/(2ρp + ρ0) */
  f2: number;
}

export function makeParticle(diameter: number, rhoP: number, Kp: number, med: Medium): Particle {
  const a = diameter / 2;
  const V = (4 / 3) * Math.PI * a * a * a;
  return {
    a,
    V,
    rhoP,
    m: rhoP * V,
    Kp,
    f1: 1 - med.K0 / Kp,
    f2: (2 * (rhoP - med.rho0)) / (2 * rhoP + med.rho0),
  };
}

// ───────────── A층: 해석적 1차원 ─────────────

/** q = k(z − d/2) − φ/2 */
export function axialPhase(z: number, d: number, phi: number, k: number): number {
  return k * (z - d / 2) - phi / 2;
}

/** 압력 진폭 포락선 P(z) = P0·cos(q) (부호 포함) */
export function pressure1D(z: number, P0: number, d: number, phi: number, med: Medium): number {
  return P0 * Math.cos(axialPhase(z, d, phi, med.k));
}

/** 에너지 밀도 계수 A = P0²/(4·ρ0·c²) */
export function energyCoeff(P0: number, med: Medium): number {
  return (P0 * P0) / (4 * med.rho0 * med.c * med.c);
}

/** U(z) = V·A·[f1·cos²q − 1.5·f2·sin²q] */
export function potential1D(
  z: number,
  P0: number,
  d: number,
  phi: number,
  med: Medium,
  p: Particle,
): number {
  const q = axialPhase(z, d, phi, med.k);
  const c = Math.cos(q);
  const s = Math.sin(q);
  return p.V * energyCoeff(P0, med) * (p.f1 * c * c - 1.5 * p.f2 * s * s);
}

/** F_max = A·V·k·(f1 + 1.5·f2) */
export function maxForce(P0: number, med: Medium, p: Particle): number {
  return energyCoeff(P0, med) * p.V * med.k * (p.f1 + 1.5 * p.f2);
}

/** 축 방향 힘 F = −dU/dz = F_max·sin(2q) */
export function force1D(
  z: number,
  P0: number,
  d: number,
  phi: number,
  med: Medium,
  p: Particle,
): number {
  return maxForce(P0, med, p) * Math.sin(2 * axialPhase(z, d, phi, med.k));
}

/** 마디 근처 강성 κ = 2·k·F_max */
export function stiffness(P0: number, med: Medium, p: Particle): number {
  return 2 * med.k * maxForce(P0, med, p);
}

/** 압력 마디 z_n = d/2 + φλ/(4π) + λ/4 + n·λ/2 중 [zLo, zHi] 안의 것 */
export function nodes1D(d: number, phi: number, lambda: number, zLo: number, zHi: number): number[] {
  const base = d / 2 + (phi * lambda) / (4 * Math.PI) + lambda / 4;
  const half = lambda / 2;
  const nMin = Math.ceil((zLo - base) / half - 1e-12);
  const nMax = Math.floor((zHi - base) / half + 1e-12);
  const out: number[] = [];
  for (let n = nMin; n <= nMax; n++) out.push(base + n * half);
  return out;
}

/**
 * 부양 가능한 최대 공 밀도 [kg/m³]: F_max(ρp) = ρp·V·g 를 푸는 값.
 * F_max = V·A·k·(f1 + 1.5·f2(ρp)) 이고 mg = ρp·V·g 라서 V가 약분된다 → 공 지름과 무관.
 * (f2가 ρp에 따라 조금 변하므로 이분법으로 푼다.)
 */
export function maxLevitationDensity(P0: number, med: Medium, Kp: number, g: number): number {
  const Ak = energyCoeff(P0, med) * med.k;
  const f1 = 1 - med.K0 / Kp;
  const excess = (rho: number) => Ak * (f1 + (3 * (rho - med.rho0)) / (2 * rho + med.rho0)) - rho * g;
  let lo = med.rho0 * 1.0001;
  let hi = 1e7;
  if (excess(lo) <= 0) return lo;
  for (let i = 0; i < 200 && hi - lo > 1e-9 * hi; i++) {
    const mid = 0.5 * (lo + hi);
    if (excess(mid) > 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** 중력 하 평형 위치의 마디 아래 처짐 (선형 근사 mg/κ) [m] */
export function equilibriumSagLinear(P0: number, med: Medium, p: Particle, g: number): number {
  return (p.m * g) / stiffness(P0, med, p);
}

// ───────────── B층: 일반 장에서의 Gor'kov ─────────────

/**
 * U = V·[ f1·|P|²/(4ρ0c²) − (3/8)·f2·|∇P|²/(ω²ρ0) ]
 * @param p2 |P|² [Pa²]
 * @param g2 |∇P|² [Pa²/m²]
 */
export function gorkovPotential(p2: number, g2: number, med: Medium, p: Particle): number {
  return (
    p.V *
    ((p.f1 * p2) / (4 * med.rho0 * med.c * med.c) -
      (0.375 * p.f2 * g2) / (med.omega * med.omega * med.rho0))
  );
}
