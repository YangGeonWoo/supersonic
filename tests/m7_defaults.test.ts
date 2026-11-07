/**
 * 앱 기본값(지향성 on)과 무게 늘리기 배속
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { defaultParams } from '../src/physics/params';
import { createBallSim, WEIGHT_SPEEDS, WEIGHT_TEST_SECONDS } from '../src/sim/ballSim';
import { fieldLimitDensity, trapNear } from '../src/sim/limits';
import { buildScene } from '../src/sim/scene';

const app = defaultParams();
const cal = calibrate(app.directivity);

describe('앱 기본값', () => {
  it('지향성 on이 기본이고, 그 상태로 보정해 P0 = 1500 Pa', () => {
    expect(app.directivity).toBe(true);
    const sc = buildScene(app, cal);
    expect(Math.abs(sc.P0 - 1500)).toBeLessThan(1);
  });

  it('공 놓기: 축으로 돌아와 부양', () => {
    const sc = buildScene(app, cal);
    const sim = createBallSim(sc);
    sim.advanceSim(3);
    expect(sim.status).toBe('levitating');
    expect(Math.abs(sim.state.x)).toBeLessThan(0.05e-3);
  });
});

describe('무게 늘리기 배속', () => {
  const sc = buildScene(app, cal);
  // 2D 장 기준 한계 (공을 놓는 가운데 덫)
  const limit = fieldLimitDensity(sc, trapNear(sc, createBallSim(sc).state.z)!);

  function run(speed: number) {
    const sim = createBallSim(sc);
    for (let i = 0; i < 60; i++) sim.advanceFrame(1 / 60, app.timeScale, sc);
    sim.startWeightTest(sc, speed);
    let frames = 0;
    while (sim.test!.active && frames < 60 * 3 * WEIGHT_TEST_SECONDS) {
      sim.advanceFrame(1 / 60, app.timeScale, sc);
      frames++;
    }
    return sim;
  }

  for (const speed of WEIGHT_SPEEDS) {
    it(`${speed}×: 2D 장 한계에서 떨어지고, 걸린 시간은 약 1/${speed}`, () => {
      const sim = run(speed);
      const t = sim.test!;
      const ratio = t.rhoFall! / limit;
      console.log(`[배속] ${speed}×: 2D 장 한계의 ${(ratio * 100).toFixed(1)}%에서 낙하, ${t.elapsedFall!.toFixed(2)} s (바닥 도달 ${t.elapsed.toFixed(2)} s)`);
      expect(t.rhoFall).not.toBeNull();
      expect(ratio).toBeGreaterThan(0.97);
      expect(ratio).toBeLessThan(1.02);
      expect(t.elapsedFall!).toBeLessThan((WEIGHT_TEST_SECONDS / speed) * 1.1);
      expect(t.elapsedFall!).toBeGreaterThan((WEIGHT_TEST_SECONDS / speed) * 0.8);
    });
  }

  it('진행 중 배속 변경이 반영됨', () => {
    const sim = createBallSim(sc);
    sim.startWeightTest(sc, 1);
    for (let i = 0; i < 60; i++) sim.advanceFrame(1 / 60, app.timeScale, sc);
    const r1 = sim.density;
    sim.setWeightSpeed(10);
    for (let i = 0; i < 60; i++) sim.advanceFrame(1 / 60, app.timeScale, sc);
    const r2 = sim.density;
    // 1초 동안 1× 증가율의 10배 (로그 기준)
    expect(Math.log(r2 / r1) / Math.log(r1 / sim.test!.rhoStart)).toBeCloseTo(10, 1);
  });
});
