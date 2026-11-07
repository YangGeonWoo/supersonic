/**
 * M2: B층 음향장, 구동 세기 보정 — 검증 2, 3, 4, 5(B층), 6, 계산 시간
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { ASSUMED_P0_REF } from '../src/physics/constants';
import {
  absGrad2,
  absP2,
  axisPotential,
  axisPressureNodes,
  computeAxisProfile,
  computeDomain,
  evalField,
  findLocalMinima,
  newPointField,
} from '../src/physics/field2d';
import { nodes1D } from '../src/physics/gorkov';
import { makeSourceSet, sampleDisc } from '../src/physics/sourceSampling';
import { buildScene } from '../src/sim/scene';
import { base, med, mm, particle } from './helpers';

const cal = calibrate(false);
const lambda = med.lambda;

function axisFor(d: number, phi: number, at = base.at) {
  const disc = sampleDisc(at, lambda / 4);
  const src = makeSourceSet(disc, d, phi);
  const dom = computeDomain(d, lambda);
  return computeAxisProfile(src, med, dom.zMin, dom.zMax, false);
}

function nearest(list: number[], z: number): number {
  let best = list[0];
  for (const v of list) if (Math.abs(v - z) < Math.abs(best - z)) best = v;
  return best;
}

describe('점음원 샘플링', () => {
  it('면적 합 = π·a², 점 간격 ≤ λ/4 수준, y 대칭', () => {
    for (const at of [4e-3, 8e-3, 10e-3]) {
      const disc = sampleDisc(at, lambda / 4);
      const sum = disc.area.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum / (Math.PI * at * at) - 1)).toBeLessThan(1e-12);
      const sy = disc.y.reduce((a, b) => a + b, 0);
      expect(Math.abs(sy)).toBeLessThan(1e-15);
    }
    const disc = sampleDisc(8e-3, lambda / 4);
    console.log(`[샘플링] a_t = 8mm, λ/4 = ${mm(lambda / 4)} → 발생기 1개당 점 ${disc.x.length}개`);
  });

  it('해석적 기울기 = 수치 미분 (지향성 on/off)', () => {
    const src = makeSourceSet(sampleDisc(8e-3, lambda / 4), base.d, 0.9);
    const h = 1e-7;
    for (const dir of [false, true]) {
      const f0 = evalField(src, med.k, 1.3e-3, 0.4e-3, 7.7e-3, dir);
      const px = evalField(src, med.k, 1.3e-3 + h, 0.4e-3, 7.7e-3, dir, newPointField());
      const mx = evalField(src, med.k, 1.3e-3 - h, 0.4e-3, 7.7e-3, dir, newPointField());
      const pz = evalField(src, med.k, 1.3e-3, 0.4e-3, 7.7e-3 + h, dir, newPointField());
      const mz = evalField(src, med.k, 1.3e-3, 0.4e-3, 7.7e-3 - h, dir, newPointField());
      const scale = Math.sqrt(absGrad2(f0));
      expect(Math.abs((px.pr - mx.pr) / (2 * h) - f0.gxr) / scale).toBeLessThan(1e-5);
      expect(Math.abs((px.pi - mx.pi) / (2 * h) - f0.gxi) / scale).toBeLessThan(1e-5);
      expect(Math.abs((pz.pr - mz.pr) / (2 * h) - f0.gzr) / scale).toBeLessThan(1e-5);
      expect(Math.abs((pz.pi - mz.pi) / (2 * h) - f0.gzi) / scale).toBeLessThan(1e-5);
    }
  });
});

/**
 * 원판 피스톤 축 위 해석해. 원판 위 단극 분포의 축 위 적분:
 *   ∫ e^{ikR}/R dA = (2π/ik)·(e^{ik√(z²+a²)} − e^{ikz})
 * 두 발생기(아래 위상 0, 위 위상 φ)의 합의 |P|².
 */
function pistonAxisP2(z: number, d: number, a: number, phi: number): number {
  const k = med.k;
  const one = (zz: number): [number, number] => {
    const R = Math.sqrt(zz * zz + a * a);
    const re = Math.cos(k * R) - Math.cos(k * zz);
    const im = Math.sin(k * R) - Math.sin(k * zz);
    return [(2 * Math.PI * im) / k, (-2 * Math.PI * re) / k]; // ÷ ik
  };
  const [r1, i1] = one(z);
  const [r2, i2] = one(d - z);
  const re = r1 + r2 * Math.cos(phi) - i2 * Math.sin(phi);
  const im = i1 + r2 * Math.sin(phi) + i2 * Math.cos(phi);
  return re * re + im * im;
}

function pistonNodes(d: number, a: number, phi: number): number[] {
  const dom = computeDomain(d, lambda);
  const n = 20001;
  const z = new Float64Array(n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    z[i] = dom.zMin + ((dom.zMax - dom.zMin) * i) / (n - 1);
    v[i] = pistonAxisP2(z[i], d, a, phi);
  }
  return findLocalMinima(z, v).map((m) => m.z);
}

function centralGaps(nodes: number[], d: number): number[] {
  const central = nodes.filter((z) => z > 0.75 * lambda && z < d - 0.75 * lambda);
  const gaps: number[] = [];
  for (let i = 1; i < central.length; i++) gaps.push((central[i] - central[i - 1]) / (lambda / 2));
  return gaps;
}

describe('검증 2: B층 축 위 |P| 최소점 간격 (면에서 먼 중앙 구간)', () => {
  /*
   * 조사 결과: a_t = 8mm(ka ≈ 5.9)인 유한 원판에서는 축 위 장이 평면파가 아니라
   * 직접파 e^{ikz}와 가장자리파 e^{ik√(z²+a²)}의 합이라 마디 간격이 λ/2보다 4~11% 넓다.
   * 이는 원판 피스톤 해석해에서도 똑같이 나오는 물리적 결과이므로, 구현 검증은
   * "B층 = 피스톤 해석해"로 하고, SPEC의 1% 기준은 알려진 불일치로 남겨 둔다.
   */
  for (const halfWaves of [5, 9]) {
    // 허용 오차 λ/100: 점음원 46개 이산화 오차(측정 최대 ≈ λ/140) 수준
    it(`d = ${halfWaves}·λ/2: B층 마디 = 원판 피스톤 해석해 (λ/100 이내)`, () => {
      const d = (halfWaves * lambda) / 2;
      const nodesB = axisPressureNodes(axisFor(d, 0));
      const nodesExact = pistonNodes(d, base.at, 0);
      const gB = centralGaps(nodesB, d);
      const gE = centralGaps(nodesExact, d);
      console.log(
        `[검증 2] d = ${halfWaves}λ/2: B층 마디 ${nodesB.map(mm).join(', ')}\n` +
          `          중앙 간격/(λ/2): B층 ${gB.map((g) => g.toFixed(4)).join(', ')} | 해석해 ${gE.map((g) => g.toFixed(4)).join(', ')}`,
      );
      expect(nodesB.length).toBe(nodesExact.length);
      for (let i = 0; i < nodesB.length; i++) {
        expect(Math.abs(nodesB[i] - nodesExact[i])).toBeLessThan(lambda / 100);
      }
    });
  }

  it('발생기가 작을수록(ka ↓) 간격이 λ/2에 가까워짐: a_t = 4mm, d = 9λ/2에서 1% 이내', () => {
    const d = (9 * lambda) / 2;
    const gaps = centralGaps(axisPressureNodes(axisFor(d, 0, 4e-3)), d);
    console.log(`[검증 2] a_t = 4mm, d = 9λ/2: 중앙 간격/(λ/2) = ${gaps.map((g) => g.toFixed(4)).join(', ')}`);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    for (const g of gaps) expect(Math.abs(g - 1)).toBeLessThan(0.01);
  });

  // SPEC 원래 기준(기본 a_t = 8mm에서 1%)은 물리적으로 충족되지 않는다 → 알려진 불일치로 표시
  it.fails('[알려진 불일치] SPEC 기준: 기본 조건 d = 5λ/2에서 간격 = λ/2 ±1%', () => {
    const gaps = centralGaps(axisPressureNodes(axisFor(base.d, 0)), base.d);
    for (const g of gaps) expect(Math.abs(g - 1)).toBeLessThan(0.01);
  });
});

describe('검증 3: B층 축 위 U 최소 위치 ≈ A층 마디', () => {
  it('λ/10 이내', () => {
    const prof = axisFor(base.d, 0);
    const U = axisPotential(prof, med, particle, 1);
    const minsB = findLocalMinima(prof.z, U).map((m) => m.z);
    const dom = computeDomain(base.d, lambda);
    const nodesA = nodes1D(base.d, 0, lambda, dom.zMin, dom.zMax);
    const errs = nodesA.map((za) => nearest(minsB, za) - za);
    console.log(
      `[검증 3] A층 마디 ${nodesA.map(mm).join(', ')}\n          B층 U 최소 ${minsB.map(mm).join(', ')}\n          차이/λ = ${errs.map((e) => (e / lambda).toFixed(4)).join(', ')}`,
    );
    expect(nodesA.length).toBe(4);
    for (const e of errs) expect(Math.abs(e)).toBeLessThan(lambda / 10);
  });
});

describe('검증 4: 위상차 φ에 따른 마디 이동 = φ·λ/(4π)', () => {
  const phis = [Math.PI / 4, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

  it('A층 1e-9', () => {
    const n0 = nodes1D(base.d, 0, lambda, -1, 1);
    for (const phi of phis) {
      const n1 = nodes1D(base.d, phi, lambda, -1, 1);
      const expected = (phi * lambda) / (4 * Math.PI);
      // 같은 n끼리 비교 (범위를 넓게 잡아 n 인덱스가 맞음)
      const shift = nearest(n1, n0[Math.floor(n0.length / 2)] + expected) - n0[Math.floor(n0.length / 2)];
      expect(Math.abs(shift / expected - 1)).toBeLessThan(1e-9);
    }
  });

  it('B층 λ/20 (축 위 1D 샘플)', () => {
    const n0 = axisPressureNodes(axisFor(base.d, 0));
    // 중앙에 가까운 두 마디를 기준으로
    const refs = n0.filter((z) => Math.abs(z - base.d / 2) < 0.6 * lambda);
    const lines: string[] = [];
    for (const phi of phis) {
      const n1 = axisPressureNodes(axisFor(base.d, phi));
      const expected = (phi * lambda) / (4 * Math.PI);
      for (const z0 of refs) {
        const target = z0 + expected;
        if (target > base.d - 0.75 * lambda) continue;
        const shift = nearest(n1, target) - z0;
        lines.push(`φ=${((phi * 180) / Math.PI).toFixed(0)}° z0=${mm(z0)}: 이동 ${mm(shift)} (예상 ${mm(expected)}, 차이 ${((shift - expected) / lambda).toFixed(4)}λ)`);
        expect(Math.abs(shift - expected)).toBeLessThan(lambda / 20);
      }
    }
    console.log('[검증 4]\n  ' + lines.join('\n  '));
  });
});

describe('검증 5 (B층): 구동 세기 2배 → U 4배', () => {
  it('상대오차 1e-9', () => {
    const p1 = { ...base, drive: 1 };
    const p2 = { ...base, drive: 2 };
    const s1 = buildScene(p1, cal);
    const s2 = buildScene(p2, cal);
    const f = newPointField();
    for (const [x, z] of [
      [0, 6e-3],
      [2e-3, 9e-3],
      [-3e-3, 13e-3],
    ]) {
      evalField(s1.sources, med.k, x, 0, z, false, f);
      const p2v = absP2(f);
      const g2v = absGrad2(f);
      const U1 = axisPotentialAt(p2v, g2v, s1.s);
      const U2 = axisPotentialAt(p2v, g2v, s2.s);
      expect(Math.abs(U2 / U1 - 4)).toBeLessThan(1e-9);
    }
    expect(Math.abs(s2.P0 / s1.P0 - 2)).toBeLessThan(1e-9);
  });
});

function axisPotentialAt(p2: number, g2: number, s: number): number {
  const prof = { z: Float64Array.of(0), p2: Float64Array.of(p2), g2: Float64Array.of(g2), Iz: Float64Array.of(0) };
  return axisPotential(prof, med, particle, s * s)[0];
}

describe('검증 6: 구동 세기 1.0, 기본 조건에서 축 위 최대 |P| = 1500 Pa', () => {
  it('±1 Pa (보정과 독립적인 더 촘촘한 샘플로 확인)', () => {
    const scene = buildScene(base, cal);
    // 독립 확인: λ/2000 간격 직접 샘플
    const dom = computeDomain(base.d, lambda);
    const fine = computeAxisProfile(scene.sources, med, dom.zMin, dom.zMax, false, 1 / 2000);
    let mx = 0;
    for (let i = 0; i < fine.p2.length; i++) mx = Math.max(mx, fine.p2[i]);
    const P0fine = scene.s * Math.sqrt(mx);
    console.log(`[검증 6] P0 = ${scene.P0.toFixed(4)} Pa (SPL ${scene.spl.toFixed(2)} dB), 촘촘한 샘플 ${P0fine.toFixed(4)} Pa, s_ref = ${cal.sRef.toExponential(4)}`);
    expect(Math.abs(scene.P0 - ASSUMED_P0_REF)).toBeLessThan(1);
    expect(Math.abs(P0fine - ASSUMED_P0_REF)).toBeLessThan(1);
  });
});

describe('계산 시간', () => {
  it('buildScene 시간 측정 (기본 조건, d = 50mm)', () => {
    const t1 = buildScene(base, cal);
    const t2 = buildScene({ ...base, d: 50e-3 }, cal);
    const t3 = buildScene({ ...base, d: 50e-3, at: 10e-3, directivity: true }, cal);
    const fmt = (s: typeof t1) =>
      `${s.field.nx}×${s.field.nz} 격자, 점음원 ${s.sources.n}개: ${s.computeMs.toFixed(1)} ms`;
    console.log(`[계산 시간]\n  기본: ${fmt(t1)}\n  d=50mm: ${fmt(t2)}\n  d=50mm, a_t=10mm, 지향성: ${fmt(t3)}`);
    expect(t1.computeMs).toBeGreaterThan(0);
  });
});
