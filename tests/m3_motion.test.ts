/**
 * M3: 공 운동 적분기와 C층 — 검증 9, 10, 11
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { DT_MAX, GRAVITY } from '../src/physics/constants';
import {
  absGrad2,
  absP2,
  axisPotential,
  evalField,
  findLocalMinima,
  newPointField,
  sampleForce,
} from '../src/physics/field2d';
import { gorkovPotential, maxForce, nodes1D, stiffness } from '../src/physics/gorkov';
import {
  dampingCoeff,
  initState,
  mechanicalEnergy,
  oscillationPeriod,
  stepsForFrame,
  timeStep,
  verletStep,
} from '../src/physics/integrator';
import { BallSim, createBallSim, releasePosition, STATUS_LABEL } from '../src/sim/ballSim';
import { buildScene } from '../src/sim/scene';
import { base, dynamicsA, med, mm, particle, potentialA, weight } from './helpers';

const cal = calibrate(false);

describe('시간 간격과 감쇠', () => {
  it('dt = T_osc/50, 상한 2e-4 s; 구동 0이어도 유한', () => {
    const k = stiffness(1500, med, particle);
    expect(timeStep(particle.m, k)).toBeCloseTo(oscillationPeriod(particle.m, k) / 50, 15);
    expect(timeStep(particle.m, 0)).toBe(DT_MAX);
    expect(Number.isFinite(dampingCoeff(0.1, particle.m, 0))).toBe(true);
    expect(dampingCoeff(0.1, particle.m, 0)).toBeGreaterThan(0);
    expect(stepsForFrame(1 / 60, 1, 1e-6)).toBe(200);
  });
});

describe('검증 9: 감쇠·중력 없을 때 100주기 후 에너지 변화', () => {
  it('1% 이내 (진동 에너지 기준)', () => {
    const P0 = 1500;
    const kappa = stiffness(P0, med, particle);
    const T = oscillationPeriod(particle.m, kappa);
    const dt = T / 50;
    const dyn = dynamicsA({ P0 });
    const U = potentialA(P0);
    const zn = nodes1D(base.d, 0, med.lambda, 0, base.d)[2];
    const s = initState(dyn, 0, zn + 0.05 * med.lambda); // 큰 진폭(비선형 영역)
    const E0 = mechanicalEnergy(s, particle.m, 0, U);
    const Emin = U(0, zn); // 마디에서 퍼텐셜 최소
    const osc = E0 - Emin;
    let maxDev = 0;
    for (let i = 0; i < 50 * 100; i++) {
      verletStep(dyn, s, dt);
      const E = mechanicalEnergy(s, particle.m, 0, U);
      maxDev = Math.max(maxDev, Math.abs(E - E0) / osc);
    }
    const final = Math.abs(mechanicalEnergy(s, particle.m, 0, U) - E0) / osc;
    console.log(`[검증 9] 100주기 후 에너지 변화 ${(final * 100).toFixed(4)}%, 최대 ${(maxDev * 100).toFixed(4)}%`);
    expect(final).toBeLessThan(0.01);
    expect(maxDev).toBeLessThan(0.01);
  });
});

/**
 * A층 힘 함수로 공을 놓고 상태 판정.
 * start = 'release': SPEC 2.6의 공 놓기 위치 (마디 + 0.5mm)
 * start = 'equilibrium': 중력 하 정적 평형 위치 (마디 − asin(mg/F_max)/(2k)), F_max < mg면 마디
 */
function runA(P0: number, simTime: number, start: 'release' | 'equilibrium', zeta = base.zeta) {
  const kappa = stiffness(P0, med, particle);
  const dyn = dynamicsA({
    P0,
    g: GRAVITY,
    walls: true,
    cd: dampingCoeff(zeta, particle.m, kappa),
  });
  const dom = { zMin: med.lambda / 8, zMax: base.d - med.lambda / 8 };
  const nodes = nodes1D(base.d, 0, med.lambda, dom.zMin, dom.zMax);
  const p = releasePosition(nodes, base.d);
  let z = p.z;
  if (start === 'equilibrium') {
    const zn = p.z - 0.5e-3;
    const w = weight / maxForce(P0, med, particle); // mg/F_max
    z = w >= 1 ? zn : zn - Math.asin(w) / (2 * med.k);
  }
  const sim = new BallSim(dyn, timeStep(particle.m, kappa), oscillationPeriod(particle.m, kappa), particle.a, 0, z);
  sim.advanceSim(simTime);
  return sim;
}

// F_max ∝ P0² 이므로 원하는 비율 r = F_max/mg 에 맞는 P0
const P0For = (r: number) => 1500 * Math.sqrt((r * weight) / maxForce(1500, med, particle));

describe('검증 10: F_max < mg → 낙하, F_max > mg → 안착 (A층 힘)', () => {
  for (const r of [0.3, 0.9, 0.99]) {
    for (const start of ['release', 'equilibrium'] as const) {
      it(`F_max/mg = ${r}, 시작 ${start} → 낙하`, () => {
        const sim = runA(P0For(r), 3, start);
        expect(sim.status).toBe('falling');
      });
    }
  }
  // 정적 부양 조건: 평형 위치에 두면 F_max > mg인 한 안착
  for (const r of [1.02, 1.5, 5, 28]) {
    it(`F_max/mg = ${r}, 평형 위치에서 시작 → 부양`, () => {
      const sim = runA(P0For(r), 3, 'equilibrium');
      console.log(`[검증 10] A층 F_max/mg=${r} (평형 시작): ${STATUS_LABEL[sim.status]} (z = ${mm(sim.state.z)})`);
      expect(sim.status).toBe('levitating');
    });
  }
  // 공 놓기 위치(마디 + 0.5mm)에서는 포획되려면 F_max/mg에 여유가 필요하다
  for (const r of [5, 28]) {
    it(`F_max/mg = ${r}, 공 놓기 위치에서 시작 → 부양`, () => {
      const sim = runA(P0For(r), 3, 'release');
      expect(sim.status).toBe('levitating');
    });
  }

  it('[조사] 공 놓기 위치에서 포획되는 최소 F_max/mg (ζ별)', () => {
    const lines: string[] = [];
    for (const zeta of [0.05, 0.1, 0.3, 1]) {
      let lo = 1;
      let hi = 10;
      for (let it = 0; it < 30; it++) {
        const mid = 0.5 * (lo + hi);
        if (runA(P0For(mid), 3, 'release', zeta).status === 'levitating') hi = mid;
        else lo = mid;
      }
      lines.push(`ζ = ${zeta}: F_max/mg ≥ ${hi.toFixed(3)}`);
    }
    console.log('[검증 10 조사] 마디 + 0.5mm에서 놓았을 때 포획 임계\n  ' + lines.join('\n  '));
  });
});

describe('검증 10 (B층 장): 같은 판정이 2차원 음향장에서도 성립', () => {
  for (const drive of [0.1, 0.15, 0.3, 1, 2]) {
    it(`구동 세기 ${drive}`, () => {
      const scene = buildScene({ ...base, drive }, cal);
      const ratio = scene.Fmax / scene.weight;
      const sim = createBallSim(scene);
      sim.advanceSim(3);
      console.log(
        `[검증 10] B층 drive=${drive}: F_max/mg(A층식) = ${ratio.toFixed(2)} → ${STATUS_LABEL[sim.status]} (x = ${mm(sim.state.x)}, z = ${mm(sim.state.z)})`,
      );
      expect(sim.status).toBe(ratio < 1 ? 'falling' : 'levitating');
    });
  }
});

describe('검증 11: 마디에 둔 공을 x로 ±0.3mm 밀면 F_x가 복원 방향', () => {
  for (const directivity of [false, true]) {
    it(`지향성 ${directivity ? 'on' : 'off'}`, () => {
      const c = calibrate(directivity);
      const scene = buildScene({ ...base, directivity }, c);
      const s2 = scene.s * scene.s;
      const Uax = axisPotential(scene.axis, med, particle, s2);
      const mins = findLocalMinima(scene.axis.z, Uax).map((m) => m.z);
      const f = newPointField();
      // 격자와 독립인 직접 계산: U(x,z)를 촘촘한 중앙 차분
      const Udirect = (x: number, z: number) => {
        evalField(scene.sources, med.k, x, 0, z, directivity, f);
        return s2 * gorkovPotential(absP2(f), absGrad2(f), med, particle);
      };
      const h = 1e-6;
      const lines: string[] = [];
      const results: { zn: number; restoring: boolean }[] = [];
      for (const zn of mins) {
        let restoring = true;
        for (const dx of [0.3e-3, -0.3e-3]) {
          const out = { fx: 0, fz: 0 };
          sampleForce(scene.potential, s2, dx, zn, out);
          const fxDirect = -(Udirect(dx + h, zn) - Udirect(dx - h, zn)) / (2 * h);
          lines.push(
            `z=${mm(zn)} (면에서 ${(Math.min(zn, base.d - zn) / med.lambda).toFixed(3)}λ) x=${(dx * 1e3).toFixed(1)}mm: F_x(격자) = ${out.fx.toExponential(3)} N, F_x(직접) = ${fxDirect.toExponential(3)} N, F_x/mg = ${(fxDirect / weight).toFixed(4)}`,
          );
          // 격자 힘과 직접 계산은 부호가 같아야 함 (격자 구현 확인)
          expect(Math.sign(out.fx)).toBe(Math.sign(fxDirect));
          // 복원 방향: x > 0이면 F_x < 0
          if (Math.sign(fxDirect) !== -Math.sign(dx)) restoring = false;
        }
        results.push({ zn, restoring });
      }
      console.log(`[검증 11] 지향성 ${directivity ? 'on' : 'off'}\n  ` + lines.join('\n  '));
      // 공을 놓는 중앙 마디(d/2에 가장 가까운 두 마디)는 반드시 복원
      const central = [...results].sort((a, b) => Math.abs(a.zn - base.d / 2) - Math.abs(b.zn - base.d / 2)).slice(0, 2);
      for (const r of central) expect(r.restoring).toBe(true);
      // 면 가까운 마디는 tests/m6_lateral.test.ts에서 조사
    });
  }

  it('B층 장에서 공을 놓으면 x도 0으로 수렴 (측면 안정)', () => {
    const scene = buildScene(base, cal);
    const sim = createBallSim(scene);
    const x0 = sim.state.x;
    sim.advanceSim(3);
    console.log(`[검증 11] 공 놓기 x0 = ${mm(x0)} → 3 s 후 x = ${mm(sim.state.x)}, z = ${mm(sim.state.z)} (${STATUS_LABEL[sim.status]})`);
    expect(Math.abs(sim.state.x)).toBeLessThan(0.05e-3);
  });
});

describe('프레임 진행', () => {
  it('advanceFrame: 단계 상한 200, 남은 시간은 버림', () => {
    const scene = buildScene(base, cal);
    const sim = createBallSim(scene);
    expect(sim.advanceFrame(1 / 60, 0.05)).toBeLessThanOrEqual(5);
    expect(sim.advanceFrame(10, 1)).toBe(200);
  });
});
