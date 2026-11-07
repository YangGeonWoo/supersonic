/**
 * 3D 공 (GPU 3D 격자 모드): 상태 판정, 무게 늘리기, 3D 부양 한계. 2D BallSim과 같은 규칙을 3축으로 확장.
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
import { forceAt, makeForceModel, type ForceModel3, type Vec3 } from '../physics/force3';
import { makeParticle, stiffness } from '../physics/gorkov';
import { dampingCoeff, initState3, verletStep3, type BallState3, type Dynamics3 } from '../physics/integrator';
import { transducerPlanes } from '../physics/sourceSampling';
import { WEIGHT_TEST_BOOST, WEIGHT_TEST_SECONDS, type BallStatus, type WeightTest } from './ballSim';
import type { Point3, Scene3 } from './scene3';

/** 밀도 rhoP 공의 힘 모델 (같은 격자) */
export function modelFor(sc: Scene3, rhoP: number): ForceModel3 {
  const p = makeParticle(sc.params.ballDiameter, rhoP, sc.params.Kp, sc.med);
  return makeForceModel(sc.grid, sc.med, sc.s * sc.s, p.V, p.f1, p.f2, sc.pushCoeff);
}

/** 덫 아래 λ/4 구간, 덫을 지나는 수직선에서 위쪽 최대 힘 [N] */
export function maxUpwardForce3(sc: Scene3, trap: Point3, rhoP: number): number {
  const m = modelFor(sc, rhoP);
  const F: Vec3 = { fx: 0, fy: 0, fz: 0 };
  const h = sc.grid.hz / 4;
  let best = 0;
  for (let z = trap.z - sc.med.lambda / 4; z <= trap.z; z += h) {
    if (forceAt(m, trap.x, trap.y, z, F) && F.fz > best) best = F.fz;
  }
  return best;
}

/** 3D 격자 기준 부양 한계 밀도: max F_z(ρ) = ρ·V·g (고정점 반복) */
export function fieldLimitDensity3(sc: Scene3, trap: Point3): number {
  const V = sc.particle.V;
  let rho = sc.particle.rhoP;
  for (let k = 0; k < 30; k++) {
    const next = maxUpwardForce3(sc, trap, rho) / (V * GRAVITY);
    if (!(next > 0)) return 0;
    if (Math.abs(next - rho) < 1e-9 * next) return next;
    rho = next;
  }
  return rho;
}

export function nearestTrap3(sc: Scene3, p: { x: number; y: number; z: number }): Point3 | null {
  if (sc.traps.length === 0) return null;
  return sc.traps.reduce((a, b) => (Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z) < Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z) ? b : a));
}

interface Dyn3 extends Dynamics3 {
  rhoP: number;
  model: ForceModel3;
}

function makeDynamics3(sc: Scene3, rhoP: number, g = GRAVITY): Dyn3 {
  const a = sc.particle.a;
  const { lower, upper } = transducerPlanes(sc.params.d, { tilt: sc.params.tilt, offset: sc.params.offset });
  const dyn: Dyn3 = {
    m: sc.particle.m,
    cdx: sc.cdx,
    cdy: sc.cdy,
    cdz: sc.cdz,
    g,
    rhoP,
    model: sc.model,
    force: (x, y, z, out) => {
      forceAt(dyn.model, x, y, z, out);
    },
    walls: (s) => {
      // 공 중심이 면에서 반지름보다 가까우면 면까지 되돌리고 멈춤 (2D와 같은 규칙)
      let hit = false;
      for (const pl of [lower, upper]) {
        const dist = (s.x - pl.px) * pl.nx + (s.y - pl.py) * pl.ny + (s.z - pl.pz) * pl.nz;
        if (dist < a) {
          s.x += (a - dist) * pl.nx;
          s.y += (a - dist) * pl.ny;
          s.z += (a - dist) * pl.nz;
          s.vx = 0;
          s.vy = 0;
          s.vz = 0;
          hit = true;
        }
      }
      return hit;
    },
  };
  setDensity3(dyn, sc, rhoP);
  return dyn;
}

function setDensity3(dyn: Dyn3, sc: Scene3, rhoP: number): void {
  const p = makeParticle(sc.params.ballDiameter, rhoP, sc.params.Kp, sc.med);
  dyn.rhoP = rhoP;
  dyn.m = p.m;
  dyn.model = modelFor(sc, rhoP);
  // 감쇠: 기본 무게일 때의 비율을 유지하며 질량에 맞춤 (2D와 같은 방식)
  const kA = stiffness(sc.P0, sc.med, p);
  const r = kA / sc.kappa;
  const K = sc.lateral?.K;
  dyn.cdz = dampingCoeff(sc.params.zeta, p.m, kA);
  dyn.cdx = dampingCoeff(sc.params.zeta, p.m, (K ? Math.abs(K[0][0]) : 0.05 * sc.kappa) * r);
  dyn.cdy = dampingCoeff(sc.params.zeta, p.m, (K ? Math.abs(K[1][1]) : 0.05 * sc.kappa) * r);
}

/** 3D 상태 판정: 아래 면에 닿으면 낙하, 영역 밖이면 이탈, 5·T_osc 동안 조용하면 부양 */
class StatusTracker3 {
  private ax = 0;
  private ay = 0;
  private az = 0;
  private calmSince = 0;
  private started = false;
  constructor(
    private readonly radius: number,
    private readonly window: number,
  ) {}
  update(s: BallState3): BallStatus {
    if (!this.started) {
      this.ax = s.x;
      this.ay = s.y;
      this.az = s.z;
      this.calmSince = s.t;
      this.started = true;
    }
    if (s.z - this.radius <= 1e-9) return 'falling';
    if (Math.abs(s.x) > DOMAIN_HALF_WIDTH || Math.abs(s.y) > DOMAIN_HALF_WIDTH) return 'escaped';
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    const moved = Math.hypot(s.x - this.ax, s.y - this.ay, s.z - this.az);
    if (speed >= LEVITATION_SPEED_TOL || moved > LEVITATION_POSITION_TOL) {
      this.ax = s.x;
      this.ay = s.y;
      this.az = s.z;
      this.calmSince = s.t;
    }
    return s.t - this.calmSince >= this.window ? 'levitating' : 'moving';
  }
}

export class BallSim3 {
  state: BallState3;
  status: BallStatus = 'moving';
  test: WeightTest | null = null;
  private acc = 0;
  private tracker: StatusTracker3;

  constructor(
    public readonly dyn: Dyn3,
    public readonly dt: number,
    Tosc: number,
    radius: number,
    x: number,
    y: number,
    z: number,
  ) {
    this.tracker = new StatusTracker3(radius, LEVITATION_WINDOW_PERIODS * (Number.isFinite(Tosc) ? Tosc : dt * 50));
    this.state = initState3(dyn, x, y, z);
    this.status = this.tracker.update(this.state);
  }

  advanceSim(simDt: number, maxSteps = Number.POSITIVE_INFINITY, stop?: () => boolean): number {
    this.acc += simDt;
    let n = 0;
    while (this.acc >= this.dt && n < maxSteps) {
      if (this.status === 'escaped') {
        this.acc = 0;
        break;
      }
      verletStep3(this.dyn, this.state, this.dt);
      this.status = this.tracker.update(this.state);
      this.acc -= this.dt;
      n++;
      if (stop && stop()) {
        this.acc = 0;
        break;
      }
    }
    if (n >= maxSteps) this.acc = 0;
    return n;
  }

  /** 화면 한 프레임 (2D BallSim.advanceFrame과 같은 규칙: 배속, 덫에 있는 동안 32배 가속) */
  advanceFrame(realDt: number, timeScale: number, scene?: Scene3): number {
    const t = this.test;
    if (t && t.active && scene) {
      t.elapsed += realDt;
      if (t.rhoFall === null) setDensity3(this.dyn, scene, this.dyn.rhoP * Math.exp(t.rate * t.speed * realDt));
    }
    const holding = !!t && t.active && t.rhoFall === null;
    const boost = holding ? WEIGHT_TEST_BOOST : 1;
    const playback = (t && t.active ? t.speed : 1) * boost;
    const stop = holding ? () => this.state.z < t!.zEscape || this.status === 'falling' || this.status === 'escaped' : undefined;
    const n = this.advanceSim(realDt * timeScale * playback, MAX_STEPS_PER_FRAME * boost, stop);
    if (t && t.active) {
      const rho = this.dyn.rhoP;
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

  get density(): number {
    return this.dyn.rhoP;
  }

  get mass(): number {
    return this.dyn.m;
  }

  startWeightTest(scene: Scene3, speed = 1): void {
    const rho = this.density;
    const trap = nearestTrap3(scene, this.state);
    const rhoLimit = trap ? fieldLimitDensity3(scene, trap) : rho * 30;
    const rate = Math.max(0.02, Math.log(Math.max(rhoLimit / rho, 1.05)) / WEIGHT_TEST_SECONDS);
    this.test = { active: true, rhoStart: rho, rhoLimit, rate, elapsed: 0, speed, rhoFall: null, elapsedFall: null, zEscape: this.state.z - scene.med.lambda / 4 };
  }

  setWeightSpeed(speed: number): void {
    if (this.test) this.test.speed = speed;
  }

  stopWeightTest(): void {
    if (this.test) this.test.active = false;
  }
}

/** 가운데 덫에서 놓는 방향(방위각 azimuth, x축 기준)으로 0.5 mm, 위로 0.5 mm 떨어진 곳에서 놓기 */
export function createBallSim3(sc: Scene3, azimuth = 0, g = GRAVITY): BallSim3 {
  const t = sc.centralTrap ?? { x: sc.params.offset / 2, y: 0, z: sc.params.d / 2 };
  const x = t.x + RELEASE_OFFSET_X * Math.cos(azimuth);
  const y = t.y + RELEASE_OFFSET_X * Math.sin(azimuth);
  return new BallSim3(makeDynamics3(sc, sc.particle.rhoP, g), sc.dt, sc.Tosc, sc.particle.a, x, y, t.z + RELEASE_OFFSET_Z);
}

/** 장이 바뀌면 위치·속도·밀도·무게 테스트를 유지한 채 새 장으로 */
export function rebaseBallSim3(prev: BallSim3, sc: Scene3, g = GRAVITY): BallSim3 {
  const s = prev.state;
  const testing = prev.test?.active === true;
  const rho = testing ? prev.density : sc.particle.rhoP;
  const next = new BallSim3(makeDynamics3(sc, rho, g), sc.dt, sc.Tosc, sc.particle.a, s.x, s.y, s.z);
  next.state.vx = s.vx;
  next.state.vy = s.vy;
  next.state.vz = s.vz;
  next.test = prev.test;
  if (prev.status === 'escaped') next.status = 'escaped';
  return next;
}
