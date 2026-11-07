/**
 * C층: 공의 운동 적분 (속도 Verlet, 감쇠는 반암시적 처리).
 *   m·x'' = F_x − c_d·x'
 *   m·z'' = F_z − m·g − c_d·z'
 */
import { DT_MAX, KAPPA_MIN, MAX_STEPS_PER_FRAME, STEPS_PER_PERIOD } from './constants';

/** 음향 방사력 함수 (중력 제외). out에 [N] 단위로 쓴다. */
export type ForceFn = (x: number, z: number, out: { fx: number; fz: number }) => void;

export interface Dynamics {
  /** 질량 [kg] */
  m: number;
  /** 감쇠 계수 [kg/s] */
  cd: number;
  /** 중력가속도 [m/s²] (0이면 중력 없음) */
  g: number;
  /** 공 중심이 움직일 수 있는 z 범위 (면과 만나면 속도 0) */
  zMin: number;
  zMax: number;
  force: ForceFn;
}

export interface BallState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** 현재 가속도 (Verlet용) */
  ax: number;
  az: number;
  /** 시뮬레이션 시간 [s] */
  t: number;
}

const tmp = { fx: 0, fz: 0 };

function accel(dyn: Dynamics, s: BallState): void {
  dyn.force(s.x, s.z, tmp);
  s.ax = (tmp.fx - dyn.cd * s.vx) / dyn.m;
  s.az = (tmp.fz - dyn.cd * s.vz) / dyn.m - dyn.g;
}

export function initState(dyn: Dynamics, x: number, z: number, vx = 0, vz = 0): BallState {
  const s: BallState = { x, z, vx, vz, ax: 0, az: 0, t: 0 };
  applyWalls(dyn, s);
  accel(dyn, s);
  return s;
}

/** 면과 만나면 위치를 면에 두고 속도 0 */
function applyWalls(dyn: Dynamics, s: BallState): boolean {
  if (s.z < dyn.zMin) {
    s.z = dyn.zMin;
    s.vx = 0;
    s.vz = 0;
    return true;
  }
  if (s.z > dyn.zMax) {
    s.z = dyn.zMax;
    s.vx = 0;
    s.vz = 0;
    return true;
  }
  return false;
}

/**
 * 속도 Verlet 한 단계. 감쇠항 −c_d·v는 새 속도에 대해 반암시적으로 푼다:
 *   v½ = v + ½dt·a,  x' = x + dt·v½,
 *   v' = (v½ + ½dt·F(x')/m) / (1 + ½dt·c_d/m)
 * c_d = 0이면 표준 속도 Verlet과 같다(심플렉틱).
 */
export function verletStep(dyn: Dynamics, s: BallState, dt: number): void {
  const h = 0.5 * dt;
  const vhx = s.vx + h * s.ax;
  const vhz = s.vz + h * s.az;
  s.x += dt * vhx;
  s.z += dt * vhz;
  s.t += dt;
  dyn.force(s.x, s.z, tmp);
  const den = 1 + (h * dyn.cd) / dyn.m;
  s.vx = (vhx + (h * tmp.fx) / dyn.m) / den;
  s.vz = (vhz + h * (tmp.fz / dyn.m - dyn.g)) / den;
  if (applyWalls(dyn, s)) {
    accel(dyn, s);
  } else {
    s.ax = (tmp.fx - dyn.cd * s.vx) / dyn.m;
    s.az = (tmp.fz - dyn.cd * s.vz) / dyn.m - dyn.g;
  }
}

/** 운동에너지 + 위치에너지(퍼텐셜 함수 제공) */
export function mechanicalEnergy(
  s: BallState,
  m: number,
  g: number,
  potential: (x: number, z: number) => number,
): number {
  return 0.5 * m * (s.vx * s.vx + s.vz * s.vz) + potential(s.x, s.z) + m * g * s.z;
}

/** T_osc = 2π·√(m/κ) */
export function oscillationPeriod(m: number, kappa: number): number {
  return kappa > 0 ? 2 * Math.PI * Math.sqrt(m / kappa) : Infinity;
}

/** dt = min(T_osc/50, dt_max) */
export function timeStep(m: number, kappa: number): number {
  return Math.min(oscillationPeriod(m, kappa) / STEPS_PER_PERIOD, DT_MAX);
}

/** c_d = 2·ζ·√(m·κ), κ < KAPPA_MIN이면 KAPPA_MIN 사용 */
export function dampingCoeff(zeta: number, m: number, kappa: number): number {
  return 2 * zeta * Math.sqrt(m * Math.max(kappa, KAPPA_MIN));
}

/** 한 프레임 단계 수 = 실제 경과 시간 × 시간 배율 / dt (상한 200) */
export function stepsForFrame(realDt: number, timeScale: number, dt: number): number {
  return Math.min(MAX_STEPS_PER_FRAME, Math.max(0, Math.round((realDt * timeScale) / dt)));
}
