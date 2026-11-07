/**
 * 거울상 반사 모델 (3D 페이지): 상대 발생기 면의 반사를 점음원으로 직접 더한다.
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { findLocalMinima } from '../src/physics/field2d';
import { drivenPairGain, nearestPairResonance } from '../src/physics/resonance';
import { makeSourceSet, reflectionOrders, sampleDisc, withReflections } from '../src/physics/sourceSampling';
import { createBallSim } from '../src/sim/ballSim';
import { lateralFor, trapsOf } from '../src/sim/lateralScene';
import { buildField, buildScene, fieldParamsOf } from '../src/sim/scene';
import { base, med } from './helpers';

const lam = med.lambda;
const refl = { ...base, reflections: true };
const calImg = calibrate(false, true);

describe('거울상 점음원 배치', () => {
  const one = { x: [0], y: [0], area: [1] };
  const disc = { x: Float64Array.from(one.x), y: Float64Array.from(one.y), area: Float64Array.from(one.area) };
  const d = 20e-3;
  const src = makeSourceSet(disc, d, 0);

  it('R = 0이면 원본 그대로', () => {
    expect(withReflections(src, src, d, 0, 3)).toBe(src);
    expect(reflectionOrders(0)).toBe(0);
  });

  it('아래 점(z=0, 위로) → 2d, −2d, 4d …; 위 점(z=d, 아래로) → −d, 3d, −3d …; 진폭 R^m, 방향 반전', () => {
    const R = 0.5;
    const s = withReflections(src, src, d, R, 3);
    expect(s.n).toBe(2 + 2 + 2 * 2);
    const rows = Array.from({ length: s.n }, (_, i) => ({ z: s.z[i] / d, a: Math.hypot(s.cRe[i], s.cIm[i]), side: s.side[i] }));
    const find = (z: number) => rows.find((r) => Math.abs(r.z - z) < 1e-12)!;
    expect(find(2)).toMatchObject({ a: R, side: -1 });
    expect(find(-2)).toMatchObject({ a: R * R, side: 1 });
    expect(find(4)).toMatchObject({ a: R ** 3, side: -1 });
    expect(find(-1)).toMatchObject({ a: R, side: 1 });
    expect(find(3)).toMatchObject({ a: R * R, side: -1 });
    expect(find(-3)).toMatchObject({ a: R ** 3, side: 1 });
  });

  it('R = 0.5이면 5차까지 (R⁵ ≈ 0.03)', () => {
    expect(reflectionOrders(0.5)).toBe(5);
    expect(0.5 ** reflectionOrders(0.5)).toBeLessThanOrEqual(0.05);
  });
});

describe('거울상 반사 모델의 음향장', () => {
  it('보정: 기본 조건에서 P0 = 1500 Pa', () => {
    const sc = buildScene(refl, calImg);
    expect(Math.abs(sc.P0 - 1500)).toBeLessThan(1);
  });

  /** [lo, hi]λ 구간에서 P0가 최대인 d */
  function peak(phi: number, lo: number, hi: number) {
    let best = { d: 0, P0: 0 };
    for (let k = 0; k <= 16; k++) {
      const d = (lo + ((hi - lo) * k) / 16) * lam;
      const P0 = buildScene({ ...refl, d, phi }, calImg).P0;
      if (P0 > best.P0) best = { d, P0 };
    }
    return best;
  }

  it('공진이 장 계산에서 저절로 나옴: 같은 위상이면 d = nλ (λ/2의 짝수배)에서 최대', () => {
    const p = peak(0, 2.75, 3.25);
    const half = buildScene({ ...refl, d: 2.5 * lam }, calImg).P0;
    console.log(`[반사] φ=0: 2.75~3.25λ 최대 d = ${(p.d / lam).toFixed(3)}λ (P0 ${p.P0.toFixed(0)}), d = 2.5λ에서 P0 ${half.toFixed(0)}`);
    expect(Math.abs(p.d / lam - 3)).toBeLessThan(1 / 16 + 1e-9);
    expect(half).toBeLessThan(p.P0);
  });

  it('위상차 180°면 공진이 d = (n+½)λ로 이동', () => {
    const p = peak(Math.PI, 2.25, 2.75);
    console.log(`[반사] φ=180°: 2.25~2.75λ 최대 d = ${(p.d / lam).toFixed(3)}λ`);
    expect(Math.abs(p.d / lam - 2.5)).toBeLessThan(1 / 16 + 1e-9);
  });

  it('R = 0이면 G(d) 배율 없이 직접파만 (반사 없음)', () => {
    const a = buildScene({ ...refl, R: 0 }, calImg);
    const b = buildScene({ ...base, R: 0 }, calibrate(false));
    // 같은 점음원, 세기만 보정 상수 차이
    expect(a.sources.n).toBe(b.sources.n);
  });

  it('아래 발생기만 구동해도 위 발생기 면의 반사로 정상파 덫이 남고, 공이 축 위에 뜸', () => {
    for (const travelingForce of [false, true]) {
      const sc = buildScene({ ...refl, ampRatio: 0, travelingForce }, calImg);
      const mins = findLocalMinima(sc.axis.z, sc.axisU);
      const sim = createBallSim(sc);
      sim.advanceSim(3);
      console.log(`[반사] 아래만 구동, 밀림 ${travelingForce ? 'on' : 'off'}: P0=${sc.P0.toFixed(0)}Pa 덫 ${mins.length}개, 공 ${sim.status} x=${(sim.state.x * 1e3).toFixed(3)}mm z=${(sim.state.z * 1e3).toFixed(2)}mm`);
      expect(mins.length).toBeGreaterThanOrEqual(3);
      expect(sim.status).toBe('levitating');
      expect(Math.abs(sim.state.x)).toBeLessThan(0.1e-3);
    }
  });

  it('3D 기본(반사 on, 밀림 on, 지향성 on): 부양, 가운데 덫 횡방향 안정', () => {
    const p = { ...base, directivity: true, reflections: true, travelingForce: true };
    const sc = buildScene(p, calibrate(true, true));
    const sim = createBallSim(sc);
    sim.advanceSim(3);
    const zt = trapsOf(sc).sort((a, b) => Math.abs(a - p.d / 2) - Math.abs(b - p.d / 2))[0];
    const lat = lateralFor(sc, zt);
    console.log(`[반사] 3D 기본: ${sim.status} z=${(sim.state.z * 1e3).toFixed(3)}mm, κ_ρ/κ_z=${(lat.ratio * 100).toFixed(2)}%, 점음원 ${sc.sources.n}개`);
    expect(sim.status).toBe('levitating');
    expect(lat.stable).toBe(true);
  });

  it('계산 시간 (참고)', () => {
    const t = (p: typeof base) => {
      const fp = fieldParamsOf(p);
      buildField(fp);
      const t0 = performance.now();
      const fd = buildField(fp);
      return { ms: performance.now() - t0, n: fd.sources.n };
    };
    const a = t(base);
    const b = t(refl);
    const c = t({ ...refl, d: 50e-3, at: 10e-3, directivity: true });
    console.log(`[반사] buildField: 반사 off ${a.ms.toFixed(0)}ms (${a.n}개), on ${b.ms.toFixed(0)}ms (${b.n}개), 최악 조건 on ${c.ms.toFixed(0)}ms (${c.n}개)`);
    expect(b.n).toBeLessThan(a.n * 4);
  });
});

it('sampleDisc 거친 샘플은 점 수가 적음', () => {
  expect(sampleDisc(8e-3, lam / 2).x.length).toBeLessThan(sampleDisc(8e-3, lam / 4).x.length / 2);
});

describe('두 발생기 구동 공진 이득 (1차원)', () => {
  const R = 0.5;
  it('φ = 0: λ/2 짝수배에서 1/(1−R), 홀수배에서 1/(1+R)', () => {
    expect(drivenPairGain(3 * lam, med.k, R, 0)).toBeCloseTo(1 / (1 - R), 9);
    expect(drivenPairGain(2.5 * lam, med.k, R, 0)).toBeCloseTo(1 / (1 + R), 9);
  });
  it('φ = π: 반대로 홀수배에서 최대', () => {
    expect(drivenPairGain(2.5 * lam, med.k, R, Math.PI)).toBeCloseTo(1 / (1 - R), 9);
    expect(drivenPairGain(3 * lam, med.k, R, Math.PI)).toBeCloseTo(1 / (1 + R), 9);
  });
  it('R = 0이면 1', () => {
    expect(drivenPairGain(2.3 * lam, med.k, 0, 0.7)).toBeCloseTo(1, 12);
  });
  it('공진 맞춤: 같은 위상이면 5λ/2에서 λ의 정수배로, 180°면 그대로', () => {
    const d0 = nearestPairResonance(2.5 * lam, lam, R, 0, 10e-3, 50e-3);
    expect(Math.abs(d0 / lam - Math.round(d0 / lam))).toBeLessThan(0.01);
    const d1 = nearestPairResonance(2.5 * lam, lam, R, Math.PI, 10e-3, 50e-3);
    expect(Math.abs(d1 / lam - 2.5)).toBeLessThan(0.01);
  });
});
