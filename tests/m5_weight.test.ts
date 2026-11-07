/**
 * 무게 늘리기 테스트: 공 밀도를 서서히 늘리면 이론 한계(F_max = mg) 근처에서 떨어지는지.
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { GRAVITY } from '../src/physics/constants';
import { sampleForce, sampleForceFor } from '../src/physics/field2d';
import { makeParticle, maxForce, maxLevitationDensity } from '../src/physics/gorkov';
import { createBallSim, theoreticalLimitDensity, WEIGHT_TEST_SECONDS } from '../src/sim/ballSim';
import { buildScene } from '../src/sim/scene';
import { base, med } from './helpers';

const cal = calibrate(false);

describe('부양 가능한 최대 밀도', () => {
  it('한계 밀도에서 F_max = mg, 공 지름과 무관', () => {
    const rho = maxLevitationDensity(1500, med, base.Kp, GRAVITY);
    for (const dia of [1e-3, 3e-3, 6e-3]) {
      const p = makeParticle(dia, rho, base.Kp, med);
      expect(maxForce(1500, med, p) / (p.m * GRAVITY)).toBeCloseTo(1, 6);
    }
    console.log(`[무게] P0 = 1500 Pa에서 최대 밀도 ${rho.toFixed(1)} kg/m³ (기본 25 kg/m³의 ${(rho / 25).toFixed(1)}배)`);
  });

  it('sampleForceFor = sampleForce (같은 공)', () => {
    const sc = buildScene(base, cal);
    const p = sc.particle;
    const a = { fx: 0, fz: 0 };
    const b = { fx: 0, fz: 0 };
    for (const [x, z] of [
      [0.3e-3, 8e-3],
      [-2e-3, 12e-3],
      [5e-3, 4e-3],
    ]) {
      sampleForce(sc.potential, sc.s * sc.s, x, z, a);
      sampleForceFor(sc.potential, sc.s * sc.s, p.V, p.f1, p.f2, x, z, b);
      expect(b.fx).toBeCloseTo(a.fx, 12);
      expect(b.fz).toBeCloseTo(a.fz, 12);
    }
  });
});

describe('무게 늘리기', () => {
  for (const drive of [1, 0.5]) {
    it(`구동 세기 ${drive}: 이론 한계의 85~102%에서 떨어짐`, () => {
      const sc = buildScene({ ...base, drive }, cal);
      const sim = createBallSim(sc);
      // 먼저 1초(실제 시간) 안착
      for (let i = 0; i < 60; i++) sim.advanceFrame(1 / 60, base.timeScale, sc);
      sim.startWeightTest(sc);
      let frames = 0;
      while (sim.test!.active && frames < 60 * 3 * WEIGHT_TEST_SECONDS) {
        sim.advanceFrame(1 / 60, base.timeScale, sc);
        frames++;
      }
      const t = sim.test!;
      const limit = theoreticalLimitDensity(sc);
      console.log(
        `[무게] drive=${drive}: ${t.rhoStart.toFixed(0)} → ${t.rhoFall?.toFixed(0)} kg/m³에서 낙하 (${(t.rhoFall! / t.rhoStart).toFixed(1)}배, ${t.elapsed.toFixed(1)} s), 이론 한계 ${limit.toFixed(0)} kg/m³ → ${((t.rhoFall! / limit) * 100).toFixed(1)}%`,
      );
      expect(t.rhoFall).not.toBeNull();
      expect(t.rhoFall! / limit).toBeGreaterThan(0.85);
      expect(t.rhoFall! / limit).toBeLessThan(1.02);
      expect(sim.status).toBe('falling');
    });
  }
});
