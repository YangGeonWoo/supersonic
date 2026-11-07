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
  /** 감쇠 계수 [kg/s] (z 방향, cdx가 없으면 x 방향에도 사용) */
  cd: number;
  /**
   * x(옆) 방향 감쇠 계수 [kg/s] (가정값). 유효 감쇠비 ζ를 방향마다 같게 주려고 옆 방향 강성으로 따로 정한다.
   * 없으면 cd와 같음 (등방 감쇠).
   */
  cdx?: number;
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
  s.ax = (tmp.fx - (dyn.cdx ?? dyn.cd) * s.vx) / dyn.m;
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
  const cdx = dyn.cdx ?? dyn.cd;
  s.vx = (vhx + (h * tmp.fx) / dyn.m) / (1 + (h * cdx) / dyn.m);
  s.vz = (vhz + h * (tmp.fz / dyn.m - dyn.g)) / (1 + (h * dyn.cd) / dyn.m);
  if (applyWalls(dyn, s)) {
    accel(dyn, s);
  } else {
    s.ax = (tmp.fx - cdx * s.vx) / dyn.m;
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

// ───────────── 3차원 (GPU 3D 격자 모드) ─────────────

/** 3D 음향 방사력 (중력 제외) [N]. 계산 영역 밖이면 0 */
export type ForceFn3 = (x: number, y: number, z: number, out: { fx: number; fy: number; fz: number }) => void;

export interface Dynamics3 {
  m: number;
  /** 방향별 감쇠 계수 [kg/s] (유효 감쇠비 ζ를 방향마다 같게 — 가정값) */
  cdx: number;
  cdy: number;
  cdz: number;
  g: number;
  force: ForceFn3;
  /** 벽(발생기 면) 처리: 공 중심이 면에서 반지름보다 가까우면 위치를 되돌리고 속도 0, 닿았으면 true */
  walls: (s: BallState3) => boolean;
}

export interface BallState3 {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ax: number;
  ay: number;
  az: number;
  t: number;
}

const tmp3 = { fx: 0, fy: 0, fz: 0 };

function accel3(dyn: Dynamics3, s: BallState3): void {
  dyn.force(s.x, s.y, s.z, tmp3);
  s.ax = (tmp3.fx - dyn.cdx * s.vx) / dyn.m;
  s.ay = (tmp3.fy - dyn.cdy * s.vy) / dyn.m;
  s.az = (tmp3.fz - dyn.cdz * s.vz) / dyn.m - dyn.g;
}

export function initState3(dyn: Dynamics3, x: number, y: number, z: number): BallState3 {
  const s: BallState3 = { x, y, z, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0, t: 0 };
  dyn.walls(s);
  accel3(dyn, s);
  return s;
}

/** 속도 Verlet (감쇠 반암시적) — 2D verletStep과 같은 방식을 3축으로 */
export function verletStep3(dyn: Dynamics3, s: BallState3, dt: number): void {
  const h = 0.5 * dt;
  const vhx = s.vx + h * s.ax;
  const vhy = s.vy + h * s.ay;
  const vhz = s.vz + h * s.az;
  s.x += dt * vhx;
  s.y += dt * vhy;
  s.z += dt * vhz;
  s.t += dt;
  dyn.force(s.x, s.y, s.z, tmp3);
  s.vx = (vhx + (h * tmp3.fx) / dyn.m) / (1 + (h * dyn.cdx) / dyn.m);
  s.vy = (vhy + (h * tmp3.fy) / dyn.m) / (1 + (h * dyn.cdy) / dyn.m);
  s.vz = (vhz + h * (tmp3.fz / dyn.m - dyn.g)) / (1 + (h * dyn.cdz) / dyn.m);
  if (dyn.walls(s)) {
    accel3(dyn, s);
  } else {
    s.ax = (tmp3.fx - dyn.cdx * s.vx) / dyn.m;
    s.ay = (tmp3.fy - dyn.cdy * s.vy) / dyn.m;
    s.az = (tmp3.fz - dyn.cdz * s.vz) / dyn.m - dyn.g;
  }
}
