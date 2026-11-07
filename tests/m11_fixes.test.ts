/**
 * 문제점 수정 검증
 *  6. 부양 한계를 2D 장 기준으로 (무게를 아주 천천히 늘리면 이 한계에서 떨어짐)
 *  7. 옆 방향 감쇠: 유효 감쇠비 ζ가 위아래와 옆에서 같음
 *  9. 공이 축 밖 고리에 있을 때 그 자리의 옆 방향 강성
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { findLocalMinima } from '../src/physics/field2d';
import { lateralStability, localRadialStiffness } from '../src/physics/lateral';
import { BallSim, createBallSim, sceneDynamics } from '../src/sim/ballSim';
import { fieldLimitDensity, fieldMargin, trapNear } from '../src/sim/limits';
import { buildScene, type Scene } from '../src/sim/scene';
import { base, med } from './helpers';

const cal = calibrate(false);

/** x(t)의 양의 극대값으로 로그 감소율 → 감쇠비 */
function dampingRatioX(sc: Scene, x0: number, zStart: number): { zeta: number; periodMs: number } {
  const sim = new BallSim(sceneDynamics(sc, 0), sc.dt, sc.Tosc, sc.particle.a, x0, zStart);
  const peaks: { t: number; x: number }[] = [];
  let p2 = sim.state.x;
  let p1 = sim.state.x;
  for (let i = 0; i < 200000 && peaks.length < 6; i++) {
    sim.advanceSim(sc.dt);
    const x = sim.state.x;
    if (p1 > p2 && p1 >= x && p1 > 0) peaks.push({ t: sim.state.t, x: p1 });
    p2 = p1;
    p1 = x;
  }
  const deltas: number[] = [];
  for (let i = 1; i < peaks.length; i++) deltas.push(Math.log(peaks[i - 1].x / peaks[i].x));
  const d = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const period = (peaks[peaks.length - 1].t - peaks[0].t) / (peaks.length - 1);
  return { zeta: d / Math.sqrt(4 * Math.PI * Math.PI + d * d), periodMs: period * 1e3 };
}

describe('6. 부양 한계 (2D 장 기준)', () => {
  const sc = buildScene(base, cal);
  const zt = trapNear(sc, base.d / 2 - 1e-3)!;

  it('2D 장 한계는 1차원 해석식보다 작고, 그 밀도에서 힘 여유 = 1', () => {
    const rho = fieldLimitDensity(sc, zt);
    console.log(`[수정6] 2D 장 한계 ${rho.toFixed(1)} kg/m³, 해석식 한계의 ${((rho * sc.particle.V * 9.81) / sc.Fmax * 100).toFixed(1)}% 수준`);
    expect(fieldMargin(sc, zt, rho)).toBeCloseTo(1, 6);
    expect(fieldMargin(sc, zt, rho * 1.05)).toBeLessThan(1);
    expect(fieldMargin(sc, zt, sc.particle.rhoP)).toBeGreaterThan(10);
  });

  it('무게를 아주 천천히 늘리면 2D 장 한계의 ±2%에서 떨어짐 (준정적 확인)', () => {
    const sim = createBallSim(sc);
    for (let i = 0; i < 60; i++) sim.advanceFrame(1 / 60, base.timeScale, sc);
    const limit = fieldLimitDensity(sc, trapNear(sc, sim.state.z)!);
    sim.startWeightTest(sc);
    sim.test!.rate /= 8; // 화면 기본보다 8배 느리게
    let f = 0;
    while (sim.test!.active && f < 60 * 400) {
      sim.advanceFrame(1 / 60, base.timeScale, sc);
      f++;
    }
    const r = sim.test!.rhoFall! / limit;
    console.log(`[수정6] 8배 느리게: 한계의 ${(r * 100).toFixed(2)}%에서 낙하`);
    expect(Math.abs(r - 1)).toBeLessThan(0.02);
  });
});

describe('7. 옆 방향 감쇠', () => {
  it('공을 옆으로 밀었을 때 옆 진동의 감쇠비 ≈ ζ (±30%), 이전 등방 감쇠였다면 약 4배', () => {
    for (const zeta of [0.05, 0.1]) {
      const sc = buildScene({ ...base, zeta }, cal);
      const zt = findLocalMinima(sc.axis.z, sc.axisU).map((m) => m.z).sort((a, b) => Math.abs(a - base.d / 2) - Math.abs(b - base.d / 2))[0];
      const { zeta: zx, periodMs } = dampingRatioX(sc, 0.1e-3, zt);
      const isotropic = zeta * Math.sqrt(1 / sc.lateralRatio);
      console.log(`[수정7] ζ=${zeta}: 옆 진동 감쇠비 ${zx.toFixed(3)} (주기 ${periodMs.toFixed(1)} ms), 등방 감쇠였다면 ${isotropic.toFixed(2)}`);
      expect(zx / zeta).toBeGreaterThan(0.7);
      expect(zx / zeta).toBeLessThan(1.3);
    }
  });
});

describe('9. 공이 있는 자리의 옆 방향 강성', () => {
  it('지향성 off 바깥 덫: 축 위는 불안정, 고리 위치는 안정', () => {
    const sc = buildScene(base, cal);
    const zt = findLocalMinima(sc.axis.z, sc.axisU).at(-1)!.z;
    const lat = lateralStability(sc.sources, med, sc.particle, sc.s * sc.s, zt, sc.axis.z, sc.axisFz, false);
    expect(lat.stable).toBe(false);
    const kRing = localRadialStiffness(lat.profile, lat.ringRadius!);
    console.log(`[수정9] 고리 반지름 ${(lat.ringRadius! * 1e3).toFixed(2)} mm, 그 자리 강성 ${(kRing * 1e3).toFixed(3)} mN/m (축 위 ${(lat.kappaRho * 1e3).toFixed(3)})`);
    expect(kRing).toBeGreaterThan(0);
    // 축 근처에서는 국소 강성 ≈ κ_ρ
    expect(localRadialStiffness(lat.profile, 0.1e-3) / lat.kappaRho).toBeCloseTo(1, 0);
  });
});
