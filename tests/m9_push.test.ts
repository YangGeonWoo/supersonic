/**
 * 3D 6단계: 비대칭 출력과 진행파 복사압(밀림)
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { evalField, intensityOf, newPointField } from '../src/physics/field2d';
import { radiationForceFunction, rigidCoefficients } from '../src/physics/scattering';
import { createBallSim } from '../src/sim/ballSim';
import { lateralFor, pushEffect, trapsOf } from '../src/sim/lateralScene';
import { buildScene, type Scene } from '../src/sim/scene';
import { base, med } from './helpers';

const cal = calibrate(false);
const um = (v: number | null) => (v === null ? '—' : `${(v * 1e6).toFixed(1)} µm`);

function settle(sc: Scene, seconds = 3) {
  const sim = createBallSim(sc);
  sim.advanceSim(seconds);
  return sim;
}

describe('복사력 함수 Y_p (강체 구, 부분파 급수)', () => {
  it('작은 ka: Y_p → (11/9)(ka)⁴ = (4/9)(ka)⁴(f1² + f1f2 + ¾f2²), f1 = f2 = 1', () => {
    for (const x of [0.005, 0.01, 0.02]) expect(radiationForceFunction(x) / x ** 4 / (11 / 9)).toBeCloseTo(1, 3);
  });
  it('큰 ka: Y_p → 1 (기하 광학), 모든 ka에서 0 < Y_p < 1.3', () => {
    expect(radiationForceFunction(50)).toBeGreaterThan(0.99);
    for (let x = 0.05; x < 30; x *= 1.3) {
      const y = radiationForceFunction(x);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1.3);
    }
  });
  it('산란 계수가 에너지 보존 α_n + α_n² + β_n² = 0을 만족', () => {
    for (const x of [0.1, 1.1, 7]) {
      const { alpha, beta } = rigidCoefficients(12, x);
      for (let n = 0; n <= 12; n++) expect(Math.abs(alpha[n] + alpha[n] ** 2 + beta[n] ** 2)).toBeLessThan(1e-12);
    }
  });
  it('기본 공(지름 3 mm): ka ≈ 1.1에서 Y_p ≈ 0.56', () => {
    const y = radiationForceFunction(med.k * 1.5e-3);
    console.log(`[밀림] ka = ${(med.k * 1.5e-3).toFixed(3)}, Y_p = ${y.toFixed(4)}`);
    expect(y).toBeGreaterThan(0.5);
    expect(y).toBeLessThan(0.62);
  });
});

describe('밀림 항 on/off', () => {
  it('off이면 기존과 완전히 같음 (2D 페이지 기본값)', () => {
    const off = buildScene(base, cal);
    expect(off.pushCoeff).toBe(0);
    for (let i = 0; i < off.axisF.length; i++) expect(off.axisFz[i]).toBe(off.axisF[i]);
    expect(settle(off).state.z).toBe(settle(buildScene({ ...base, ampRatio: 1 }, cal)).state.z);
  });

  it('ampRatio = 1이면 음향장은 기존과 같음', () => {
    const a = buildScene(base, cal);
    const b = buildScene({ ...base, ampRatio: 1, travelingForce: true }, cal);
    expect(b.P0).toBe(a.P0);
    expect(Array.from(b.axisU)).toEqual(Array.from(a.axisU));
  });
});

describe('출력이 같을 때 (ampRatio = 1)', () => {
  it('구면파 감쇠로 생기는 진행파가 공을 가운데 쪽으로 조금 밀고, 부양은 유지', () => {
    const sc = buildScene({ ...base, travelingForce: true }, cal);
    const rows: string[] = [];
    for (const zt of trapsOf(sc)) {
      const e = pushEffect(sc, zt)!;
      rows.push(`덫 ${(e.zNode * 1e3).toFixed(2)}mm: 이동 ${um(e.shift)}, F_push/mg = ${(e.push / sc.weight).toFixed(3)}`);
      if (e.shift !== null) expect(Math.sign(e.shift)).toBe(Math.sign(base.d / 2 - e.zNode)); // 가운데 쪽
    }
    console.log('[밀림] 대칭 구동\n  ' + rows.join('\n  '));
    expect(settle(sc).status).toBe('levitating');
  });

  it('횡방향 강성: 밀림 on/off 비교 (가운데 덫)', () => {
    const off = buildScene(base, cal);
    const on = buildScene({ ...base, travelingForce: true }, cal);
    const zOff = trapsOf(off).sort((a, b) => Math.abs(a - base.d / 2) - Math.abs(b - base.d / 2))[0];
    const zOn = trapsOf(on).sort((a, b) => Math.abs(a - base.d / 2) - Math.abs(b - base.d / 2))[0];
    const a = lateralFor(off, zOff);
    const b = lateralFor(on, zOn);
    console.log(`[밀림] 가운데 덫 κ_ρ/κ_z: 밀림 off ${(a.ratio * 100).toFixed(2)}%, on ${(b.ratio * 100).toFixed(2)}% (κ_ρ ${a.kappaRho.toExponential(3)} → ${b.kappaRho.toExponential(3)} N/m)`);
    expect(Number.isFinite(b.ratio)).toBe(true);
  });
});

describe('출력이 비대칭일 때 공이 약한 쪽으로 밀림 (PLAN_3D 체크리스트)', () => {
  it('위 발생기 0.5배: 덫에서 I_z > 0 (센 아래 → 약한 위), 평형이 위로 이동', () => {
    const sc = buildScene({ ...base, ampRatio: 0.5, travelingForce: true }, cal);
    const f = newPointField();
    const I = { x: 0, y: 0, z: 0 };
    const rows: string[] = [];
    for (const zt of trapsOf(sc)) {
      evalField(sc.sources, med.k, 0, 0, zt, false, f);
      expect(intensityOf(f, med, I).z).toBeGreaterThan(0);
      const e = pushEffect(sc, zt)!;
      rows.push(`덫 ${(e.zNode * 1e3).toFixed(2)}mm: 이동 ${um(e.shift)}, F_push/mg = ${(e.push / sc.weight).toFixed(3)}`);
      if (e.shift !== null) expect(e.shift).toBeGreaterThan(0);
    }
    console.log(`[밀림] 위 발생기 0.5배 (P0 = ${sc.P0.toFixed(0)} Pa)\n  ` + rows.join('\n  '));
  });

  it('시뮬레이션: 밀림 on이면 off보다 위(약한 쪽)에 안착', () => {
    for (const r of [0.8, 0.5, 0.3]) {
      const off = settle(buildScene({ ...base, ampRatio: r }, cal));
      const on = settle(buildScene({ ...base, ampRatio: r, travelingForce: true }, cal));
      console.log(`[밀림] ampRatio ${r}: 안착 z off ${(off.state.z * 1e3).toFixed(4)} mm (${off.status}), on ${(on.state.z * 1e3).toFixed(4)} mm (${on.status}) → ${um(on.state.z - off.state.z)}`);
      expect(on.status).toBe('levitating');
      expect(on.state.z).toBeGreaterThan(off.state.z);
    }
  });

  it('아래 발생기만 구동 (ampRatio = 0): 정상파 덫이 사라짐', () => {
    // 밀림 off: 붙잡을 덫이 없어 떨어짐
    const off = settle(buildScene({ ...base, ampRatio: 0 }, cal));
    expect(off.status).not.toBe('levitating');
    // 밀림 on: 마디가 아니라 진행파가 위로 미는 힘으로 축 밖(근접장)에 걸림 — 근사가 가장 약한 영역
    const on = settle(buildScene({ ...base, ampRatio: 0, travelingForce: true }, cal));
    console.log(`[밀림] ampRatio 0: 밀림 off ${off.status}, on ${on.status} (x = ${(on.state.x * 1e3).toFixed(2)} mm, z = ${(on.state.z * 1e3).toFixed(2)} mm)`);
    if (on.status === 'levitating') expect(Math.abs(on.state.x)).toBeGreaterThan(1e-3);
  });

  it('비대칭이 커지면 바깥으로 흐르는 에너지 때문에 횡방향이 불안정해짐', () => {
    const rows: string[] = [];
    let prev = Infinity;
    for (const r of [1, 0.8, 0.5, 0.3, 0.1]) {
      const sc = buildScene({ ...base, ampRatio: r, travelingForce: true }, cal);
      const zt = trapsOf(sc).sort((a, b) => Math.abs(a - base.d / 2 + 2e-3) - Math.abs(b - base.d / 2 + 2e-3))[0];
      const lat = lateralFor(sc, zt);
      rows.push(`ampRatio ${r}: κ_ρ/κ_z = ${(lat.ratio * 100).toFixed(2)}% ${lat.stable ? '안정' : '불안정'}`);
      expect(lat.ratio).toBeLessThan(prev + 1e-3); // 비대칭이 클수록 약해짐
      prev = lat.ratio;
    }
    console.log(`[밀림] 아래쪽 가운데 덫: ${rows.join(' | ')}`);
    expect(prev).toBeLessThan(0); // 0.1배에서는 불안정
  });
});
