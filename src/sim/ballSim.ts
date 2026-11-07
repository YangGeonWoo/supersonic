/**
 * 공 상태와 시간 진행, 상태 판정 (SPEC 2.6), 무게 늘리기 테스트. React 의존 없음.
 * 매 프레임 advanceFrame(realDt, timeScale)을 호출한다.
 */
import {
  DOMAIN_HALF_WIDTH,
  GRAVITY,
  LEVITATION_POSITION_TOL,
  LEVITATION_SPEED_TOL,
  LEVITATION_WINDOW_PERIODS,
  MAX_STEPS_PER_FRAME,
  RELEASE_OFFSET_X,
  RELEASE_OFFSET_Z,
} from '../physics/constants';
import { sampleForceFor, samplePush } from '../physics/field2d';
import { makeParticle, maxForce, maxLevitationDensity, stiffness } from '../physics/gorkov';
import { dampingCoeff, initState, verletStep, type BallState, type Dynamics } from '../physics/integrator';
import type { Scene } from './scene';

export type BallStatus = 'levitating' | 'falling' | 'escaped' | 'moving';

export const STATUS_LABEL: Record<BallStatus, string> = {
  levitating: '부양',
  falling: '낙하',
  escaped: '이탈',
  moving: '움직이는 중',
};

/** 상태 판정기: 최근 5·T_osc 동안 |v| < 1mm/s, 위치 변화 0.05mm 이내면 부양 */
export class StatusTracker {
  private anchorX = 0;
  private anchorZ = 0;
  private calmSince = 0;
  private started = false;

  constructor(
    private readonly radius: number,
    public window: number,
  ) {}

  update(s: BallState): BallStatus {
    if (!this.started) {
      this.anchorX = s.x;
      this.anchorZ = s.z;
      this.calmSince = s.t;
      this.started = true;
    }
    if (s.z - this.radius <= 1e-12) return 'falling';
    if (Math.abs(s.x) > DOMAIN_HALF_WIDTH) return 'escaped';
    const speed = Math.hypot(s.vx, s.vz);
    const moved = Math.hypot(s.x - this.anchorX, s.z - this.anchorZ);
    if (speed >= LEVITATION_SPEED_TOL || moved > LEVITATION_POSITION_TOL) {
      this.anchorX = s.x;
      this.anchorZ = s.z;
      this.calmSince = s.t;
    }
    return s.t - this.calmSince >= this.window ? 'levitating' : 'moving';
  }
}

/** z = d/2에 가장 가까운 마디(같으면 아래쪽)에서 (+0.5mm, +0.5mm) */
export function releasePosition(nodes: number[], d: number): { x: number; z: number } {
  let best = d / 2;
  let bestDist = Infinity;
  for (const zn of nodes) {
    const dist = Math.abs(zn - d / 2);
    if (dist < bestDist - 1e-12 || (Math.abs(dist - bestDist) <= 1e-12 && zn < best)) {
      best = zn;
      bestDist = dist;
    }
  }
  return { x: RELEASE_OFFSET_X, z: best + RELEASE_OFFSET_Z };
}

/** 공 물성 (무게 테스트 중 바뀐다) */
export interface Load {
  rhoP: number;
  V: number;
  f1: number;
  f2: number;
}

export interface SceneDynamics extends Dynamics {
  load: Load;
}

/** B층 힘 격자 기반 동역학. load를 바꾸면 힘·질량이 바로 바뀐다. */
export function sceneDynamics(scene: Scene, g = GRAVITY, rhoP = scene.particle.rhoP): SceneDynamics {
  const s2 = scene.s * scene.s;
  const pg = scene.potential;
  const p = scene.particle;
  const load: Load = { rhoP: p.rhoP, V: p.V, f1: p.f1, f2: p.f2 };
  const pushK = scene.pushCoeff * s2;
  const push = { fx: 0, fz: 0 };
  const dyn: SceneDynamics = {
    m: p.m,
    cd: scene.cd,
    g,
    zMin: p.a,
    zMax: scene.params.d - p.a,
    load,
    force: (x, z, out) => {
      sampleForceFor(pg, s2, load.V, load.f1, load.f2, x, z, out);
      if (pushK !== 0) {
        // 진행파 복사압 (밀림). Y_p는 지름에만 의존하므로 무게 늘리기 중에도 그대로
        samplePush(scene.field, pushK, x, z, push);
        out.fx += push.fx;
        out.fz += push.fz;
      }
    },
  };
  setDensity(dyn, scene, rhoP);
  return dyn;
}

/** 공 밀도를 바꾼다 (지름 고정). 질량, f2, 감쇠 계수를 함께 갱신. */
export function setDensity(dyn: SceneDynamics, scene: Scene, rhoP: number): void {
  const p = makeParticle(scene.params.ballDiameter, rhoP, scene.params.Kp, scene.med);
  dyn.load.rhoP = rhoP;
  dyn.load.f1 = p.f1;
  dyn.load.f2 = p.f2;
  dyn.m = p.m;
  dyn.cd = dampingCoeff(scene.params.zeta, p.m, stiffness(scene.P0, scene.med, p));
}

/** 무게 늘리기 테스트 상태 */
export interface WeightTest {
  active: boolean;
  /** 시작 밀도 */
  rhoStart: number;
  /** 이론 한계 밀도 (A층식, F_max = mg) */
  rhoLimit: number;
  /** 밀도 증가율 [1/s, 실제 시간] (지수 증가) */
  rate: number;
  /** 경과 실제 시간 [s] */
  elapsed: number;
  /**
   * 배속: 테스트 동안 밀도 증가와 공의 운동 시간을 같은 배율로 빨리 돌린다.
   * (밀도만 빨리 늘리면 공이 따라가지 못해 한계를 넘어서야 떨어진다. 같이 돌리면 물리는 1×와 같다)
   */
  speed: number;
  /** 덫을 벗어난 순간의 밀도 (아직이면 null). 이후 무게는 고정하고 바닥에 닿으면 끝 */
  rhoFall: number | null;
  /** 덫을 벗어날 때까지 걸린 실제 시간 [s] */
  elapsedFall: number | null;
  /** 벗어남 판정 높이: 시작 위치 − λ/4 (아래쪽 퍼텐셜 장벽 근처) */
  zEscape: number;
}

/** 이론 한계까지 걸리는 실제 시간 [s] */
export const WEIGHT_TEST_SECONDS = 20;

/** 무게 늘리기 배속 선택지 */
export const WEIGHT_SPEEDS = [1, 2, 5, 10] as const;

export function theoreticalLimitDensity(scene: Scene): number {
  return maxLevitationDensity(scene.P0, scene.med, scene.params.Kp, GRAVITY);
}

export class BallSim {
  state: BallState;
  status: BallStatus = 'moving';
  test: WeightTest | null = null;
  private acc = 0;
  private tracker: StatusTracker;

  constructor(
    public readonly dyn: Dynamics,
    public readonly dt: number,
    Tosc: number,
    radius: number,
    x: number,
    z: number,
    vx = 0,
    vz = 0,
  ) {
    const window = LEVITATION_WINDOW_PERIODS * (Number.isFinite(Tosc) ? Tosc : dt * 50);
    this.tracker = new StatusTracker(radius, window);
    this.state = initState(dyn, x, z, vx, vz);
    this.status = this.tracker.update(this.state);
  }

  /** 시뮬레이션 시간 simDt만큼 진행 (단계 상한 maxSteps) */
  advanceSim(simDt: number, maxSteps = Number.POSITIVE_INFINITY): number {
    this.acc += simDt;
    let n = 0;
    while (this.acc >= this.dt && n < maxSteps) {
      if (this.status === 'escaped') {
        this.acc = 0;
        break;
      }
      verletStep(this.dyn, this.state, this.dt);
      this.status = this.tracker.update(this.state);
      this.acc -= this.dt;
      n++;
    }
    if (n >= maxSteps) this.acc = 0; // 따라잡지 못한 시간은 버린다
    return n;
  }

  /** 화면 한 프레임: 실제 경과 시간 × 시간 배율 (단계 상한 200). 무게 테스트 중에는 × 배속. */
  advanceFrame(realDt: number, timeScale: number, scene?: Scene): number {
    const t = this.test;
    if (t && t.active && scene && 'load' in this.dyn) {
      t.elapsed += realDt;
      const dyn = this.dyn as SceneDynamics;
      if (t.rhoFall === null) setDensity(dyn, scene, dyn.load.rhoP * Math.exp(t.rate * t.speed * realDt));
    }
    const playback = t && t.active ? t.speed : 1;
    const n = this.advanceSim(realDt * timeScale * playback, MAX_STEPS_PER_FRAME);
    if (t && t.active) {
      const rho = (this.dyn as SceneDynamics).load.rhoP;
      // 덫을 벗어난 순간의 무게를 기록 (바닥까지 떨어지는 동안 무게가 더 늘지 않도록)
      if (t.rhoFall === null && this.state.z < t.zEscape) {
        t.rhoFall = rho;
        t.elapsedFall = t.elapsed;
      }
      if (this.status === 'falling' || this.status === 'escaped') {
        t.active = false;
        if (t.rhoFall === null) {
          t.rhoFall = rho;
          t.elapsedFall = t.elapsed;
        }
      }
    }
    return n;
  }

  /** 현재 밀도 (무게 테스트 중이면 바뀐 값) */
  get density(): number {
    return 'load' in this.dyn ? (this.dyn as SceneDynamics).load.rhoP : NaN;
  }

  get mass(): number {
    return this.dyn.m;
  }

  /** 무게 늘리기 시작: 이론 한계까지 약 20초 / speed 걸리는 속도로 밀도를 지수적으로 늘린다 */
  startWeightTest(scene: Scene, speed = 1): void {
    const rho = this.density;
    const rhoLimit = theoreticalLimitDensity(scene);
    const rate = Math.max(0.02, Math.log(Math.max(rhoLimit / rho, 1.05)) / WEIGHT_TEST_SECONDS);
    this.test = { active: true, rhoStart: rho, rhoLimit, rate, elapsed: 0, speed, rhoFall: null, elapsedFall: null, zEscape: this.state.z - scene.med.lambda / 4 };
  }

  /** 진행 중에도 배속을 바꿀 수 있다 */
  setWeightSpeed(speed: number): void {
    if (this.test) this.test.speed = speed;
  }

  stopWeightTest(): void {
    if (this.test) this.test.active = false;
  }
}

export function createBallSim(scene: Scene, g = GRAVITY): BallSim {
  const nodes = scene.nodesB.length > 0 ? scene.nodesB : scene.nodesA;
  const p = releasePosition(nodes, scene.params.d);
  return new BallSim(sceneDynamics(scene, g), scene.dt, scene.Tosc, scene.particle.a, p.x, p.z);
}

/**
 * 장이 바뀌었을 때 공의 위치·속도·밀도·무게 테스트를 유지한 채 새 장으로 옮긴다.
 * 시간은 0부터 다시 센다 (상태 판정 창도 새로 시작). 이탈 상태는 유지.
 */
export function rebaseBallSim(prev: BallSim, scene: Scene, g = GRAVITY): BallSim {
  const s = prev.state;
  const testing = prev.test?.active === true;
  const rho = testing ? prev.density : scene.particle.rhoP;
  const next = new BallSim(sceneDynamics(scene, g, rho), scene.dt, scene.Tosc, scene.particle.a, s.x, s.z, s.vx, s.vz);
  next.test = prev.test;
  if (prev.status === 'escaped') next.status = 'escaped';
  return next;
}

/** 표시용: 현재 밀도에서의 F_max/mg (A층식, 실제 P0) */
export function marginAt(scene: Scene, rhoP: number): number {
  const p = makeParticle(scene.params.ballDiameter, rhoP, scene.params.Kp, scene.med);
  return maxForce(scene.P0, scene.med, p) / (p.m * GRAVITY);
}
