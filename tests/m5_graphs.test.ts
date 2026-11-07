/**
 * M5: 사이드 그래프용 축 위 U/F, 공진 맞춤, 거리·위상에 대한 공의 반응
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { findLocalMinima } from '../src/physics/field2d';
import { force1D } from '../src/physics/gorkov';
import { nearestResonanceGapIn, resonanceGain } from '../src/physics/resonance';
import { createBallSim } from '../src/sim/ballSim';
import { buildScene } from '../src/sim/scene';
import { base, med, mm } from './helpers';

const cal = calibrate(false);
const lambda = med.lambda;

function settle(sc: ReturnType<typeof buildScene>, seconds = 3) {
  const sim = createBallSim(sc);
  sim.advanceSim(seconds);
  return sim;
}

describe('축 위 U(z), F(z)', () => {
  const sc = buildScene(base, cal);

  it('F_z = −dU/dz: U 최소점에서 F_z 부호가 + → − 로 바뀜', () => {
    const { z } = sc.axis;
    const minima = findLocalMinima(z, sc.axisU).map((m) => m.z);
    expect(minima.length).toBe(sc.nodesB.length);
    for (const zn of minima) {
      let i = 0;
      while (z[i] < zn) i++;
      expect(sc.axisF[i - 3]).toBeGreaterThan(0); // 마디 아래: 위로 밂
      expect(sc.axisF[i + 3]).toBeLessThan(0); // 마디 위: 아래로 밂
    }
  });

  it('중앙 마디 근처 최대 |F_z|가 A층 F_max와 같은 크기 (근접장 때문에 ±30%)', () => {
    const { z } = sc.axis;
    let best = 0;
    for (let i = 0; i < z.length; i++) {
      if (Math.abs(z[i] - base.d / 2) < lambda / 2) best = Math.max(best, Math.abs(sc.axisF[i]));
    }
    const ratio = best / sc.Fmax;
    console.log(`[M5] 중앙 구간 max|F_z| = ${(best * 1e6).toFixed(2)} µN, A층 F_max = ${(sc.Fmax * 1e6).toFixed(2)} µN (비 ${ratio.toFixed(3)})`);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.3);
    // 참고: A층 곡선과 같은 모양
    expect(Math.sign(force1D(sc.nodesA[1] - lambda / 16, sc.P0, base.d, 0, med, sc.particle))).toBe(1);
  });
});

describe('공진 맞춤', () => {
  it('λ/2 정수배로 맞추고 G가 최대가 됨', () => {
    for (const d of [12.3e-3, 19e-3, 23.9e-3, 47e-3]) {
      const dr = nearestResonanceGapIn(d, lambda, 10e-3, 50e-3);
      const n = dr / (lambda / 2);
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
      expect(Math.abs(dr - d)).toBeLessThanOrEqual(lambda / 4 + 1e-12);
      expect(resonanceGain(dr, med.k, 0.5)).toBeCloseTo(1 / (1 - 0.5), 9);
    }
  });

  it('범위 밖 배수는 고르지 않음', () => {
    const dr = nearestResonanceGapIn(49.9e-3, lambda, 10e-3, 50e-3);
    expect(dr).toBeLessThanOrEqual(50e-3);
    expect(dr).toBeGreaterThanOrEqual(10e-3);
  });
});

describe('거리·위상에 대한 공의 반응', () => {
  it('공진에서 벗어나면 P0와 F_max/mg가 줄어듦', () => {
    const on = buildScene(base, cal);
    const off = buildScene({ ...base, d: base.d + lambda / 4 }, cal);
    console.log(`[M5] 공진 P0 = ${on.P0.toFixed(0)} Pa, λ/4 벗어남 P0 = ${off.P0.toFixed(0)} Pa`);
    expect(off.P0).toBeLessThan(on.P0 * 0.8);
    expect(off.Fmax / off.weight).toBeLessThan(on.Fmax / on.weight);
  });

  it('위상차 90°면 안착 위치가 약 λ/8 이동', () => {
    const sc0 = buildScene(base, cal);
    const sc1 = buildScene({ ...base, phi: Math.PI / 2 }, cal);
    const z0 = settle(sc0).state.z;
    const s1 = settle(sc1);
    // 같은 출발 마디를 찾기 어렵기 때문에 가장 가까운 마디와의 차이로 비교
    const shift = sc1.nodesB.map((n) => n - sc0.nodesB.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a)));
    console.log(`[M5] φ=0 안착 z = ${mm(z0)}, φ=90° 안착 z = ${mm(s1.state.z)}, 마디 이동 ${shift.map(mm).join(', ')} (λ/8 = ${mm(lambda / 8)})`);
    expect(s1.status).toBe('levitating');
    for (const s of shift) expect(Math.abs(Math.abs(s) - lambda / 8)).toBeLessThan(lambda / 20);
  });
});
