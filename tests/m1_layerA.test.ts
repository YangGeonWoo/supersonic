/**
 * M1: A층 physics와 공진 이득 — 검증 1, 5, 7, 8
 */
import { describe, expect, it } from 'vitest';
import { soundSpeed, airDensity } from '../src/physics/acoustics';
import { GRAVITY } from '../src/physics/constants';
import {
  axialPhase,
  equilibriumSagLinear,
  force1D,
  maxForce,
  nodes1D,
  potential1D,
  pressure1D,
  stiffness,
} from '../src/physics/gorkov';
import { initState, oscillationPeriod, verletStep } from '../src/physics/integrator';
import { nearestResonanceGap, resonanceGain } from '../src/physics/resonance';
import { base, dynamicsA, med, particle, weight } from './helpers';

const P0 = 1500;

describe('기본 관계', () => {
  it('음속, 밀도, 파장', () => {
    expect(soundSpeed(20)).toBeCloseTo(343.42, 6);
    expect(airDensity(20)).toBeCloseTo(1.2041, 3);
    expect(med.lambda).toBeCloseTo(343.42 / 40e3, 12);
    expect(base.d).toBeCloseTo((5 * med.lambda) / 2, 15);
  });

  it('기본값에서 F_max/mg ≈ 28 (부양 가능)', () => {
    const ratio = maxForce(P0, med, particle) / weight;
    expect(ratio).toBeGreaterThan(20);
    expect(ratio).toBeLessThan(35);
  });

  it('F = −dU/dz (수치 미분과 일치)', () => {
    const h = med.lambda * 1e-6;
    for (const z of [3e-3, 7e-3, 11e-3, 15e-3]) {
      const num = -(potential1D(z + h, P0, base.d, 0.7, med, particle) - potential1D(z - h, P0, base.d, 0.7, med, particle)) / (2 * h);
      expect(force1D(z, P0, base.d, 0.7, med, particle)).toBeCloseTo(num, 12);
    }
  });
});

describe('검증 1: A층 마디 간격 = λ/2', () => {
  it('상대오차 1e-9', () => {
    const nodes = nodes1D(base.d, 0, med.lambda, 0, base.d);
    expect(nodes.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < nodes.length; i++) {
      const gap = nodes[i] - nodes[i - 1];
      expect(Math.abs(gap / (med.lambda / 2) - 1)).toBeLessThan(1e-9);
    }
    // 마디에서 실제로 P = 0이고 U가 국소 최소
    for (const zn of nodes) {
      expect(Math.abs(pressure1D(zn, P0, base.d, 0, med))).toBeLessThan(1e-9 * P0);
      const h = med.lambda * 1e-3;
      const U0 = potential1D(zn, P0, base.d, 0, med, particle);
      expect(potential1D(zn + h, P0, base.d, 0, med, particle)).toBeGreaterThan(U0);
      expect(potential1D(zn - h, P0, base.d, 0, med, particle)).toBeGreaterThan(U0);
    }
  });

  it('계산 영역 안의 마디 개수 = 4 (기본 조건, 면 제외)', () => {
    const m = med.lambda / 8;
    expect(nodes1D(base.d, 0, med.lambda, m, base.d - m).length).toBe(4);
  });
});

describe('검증 5: 구동 세기 2배 → U 4배 (A층)', () => {
  it('상대오차 1e-9', () => {
    for (const z of [2e-3, 5.5e-3, 9e-3, 13.7e-3]) {
      const U1 = potential1D(z, P0, base.d, 0.3, med, particle);
      const U2 = potential1D(z, 2 * P0, base.d, 0.3, med, particle);
      expect(Math.abs(U2 / U1 - 4)).toBeLessThan(1e-9);
    }
  });
});

/** 위로 지나가는 영점 교차 시각들 (선형 보간) */
function upCrossings(ts: number[], ys: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    if (ys[i - 1] < 0 && ys[i] >= 0) {
      const f = -ys[i - 1] / (ys[i] - ys[i - 1]);
      out.push(ts[i - 1] + f * (ts[i] - ts[i - 1]));
    }
  }
  return out;
}

describe('검증 7: 중력 없는 작은 진폭 진동 주기 = 2π√(m/κ)', () => {
  it('2% 이내', () => {
    const kappa = stiffness(P0, med, particle);
    const T = oscillationPeriod(particle.m, kappa);
    const dyn = dynamicsA({ P0 });
    const zn = nodes1D(base.d, 0, med.lambda, 0, base.d)[2];
    const s = initState(dyn, 0, zn + 0.01 * med.lambda);
    const dt = T / 50;
    const ts: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 50 * 30; i++) {
      verletStep(dyn, s, dt);
      ts.push(s.t);
      ys.push(s.z - zn);
    }
    const c = upCrossings(ts, ys);
    const measured = (c[c.length - 1] - c[0]) / (c.length - 1);
    console.log(`[검증 7] T_이론 = ${(T * 1e3).toFixed(4)} ms, T_측정 = ${(measured * 1e3).toFixed(4)} ms, 오차 ${((measured / T - 1) * 100).toFixed(3)}%`);
    expect(Math.abs(measured / T - 1)).toBeLessThan(0.02);
  });
});

describe('검증 8: 중력 있는 평형 처짐 ≈ mg/κ', () => {
  it('5% 이내', () => {
    const kappa = stiffness(P0, med, particle);
    const T = oscillationPeriod(particle.m, kappa);
    const cd = 2 * 0.5 * Math.sqrt(particle.m * kappa); // 빨리 안착하도록 ζ = 0.5
    const dyn = dynamicsA({ P0, cd, g: GRAVITY });
    const zn = nodes1D(base.d, 0, med.lambda, 0, base.d)[2];
    const s = initState(dyn, 0, zn);
    const dt = T / 50;
    for (let i = 0; i < 50 * 200; i++) verletStep(dyn, s, dt);
    const sag = zn - s.z;
    const lin = equilibriumSagLinear(P0, med, particle, GRAVITY);
    const exact = Math.asin(weight / maxForce(P0, med, particle)) / (2 * med.k);
    console.log(`[검증 8] 처짐 측정 = ${(sag * 1e6).toFixed(4)} µm, mg/κ = ${(lin * 1e6).toFixed(4)} µm, 정확해 = ${(exact * 1e6).toFixed(4)} µm`);
    expect(Math.abs(sag / lin - 1)).toBeLessThan(0.05);
    expect(Math.abs(s.vz)).toBeLessThan(1e-9);
  });
});

describe('공진 이득', () => {
  it('d = nλ/2에서 최대 1/(1−R), 사이에서 최소 1/(1+R), R = 0이면 1', () => {
    const half = med.lambda / 2;
    expect(resonanceGain(5 * half, med.k, 0.5)).toBeCloseTo(2, 12);
    expect(resonanceGain(5.5 * half, med.k, 0.5)).toBeCloseTo(2 / 3, 12);
    expect(resonanceGain(5.3 * half, med.k, 0)).toBe(1);
    expect(nearestResonanceGap(5.4 * half, med.lambda)).toBeCloseTo(5 * half, 15);
    expect(nearestResonanceGap(5.6 * half, med.lambda)).toBeCloseTo(6 * half, 15);
    expect(nearestResonanceGap(0.1 * half, med.lambda)).toBeCloseTo(half, 15);
  });

  it('axialPhase: φ = 0이면 d/2가 배', () => {
    expect(axialPhase(base.d / 2, base.d, 0, med.k)).toBe(0);
  });
});
