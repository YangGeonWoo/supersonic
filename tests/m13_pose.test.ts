/**
 * G1: 비대칭 발생기 (위 발생기 기울기·어긋남), 일반 지향성, 일반 평면 거울상
 */
import { describe, expect, it } from 'vitest';
import { absGrad2, absP2, evalField, newPointField } from '../src/physics/field2d';
import { gorkovPotential } from '../src/physics/gorkov';
import {
  makeSourceSet,
  reflectAcross,
  reflectionOrders,
  sampleDisc,
  transducerPlanes,
  withReflections,
  type SourceSet,
} from '../src/physics/sourceSampling';
import { makeSources, fieldParamsOf } from '../src/sim/scene';
import { base, med, particle } from './helpers';

const lam = med.lambda;
const disc = sampleDisc(base.at, lam / 4);
const deg = (v: number) => (v * Math.PI) / 180;

describe('일반 지향성 (점음원 법선)', () => {
  it('기울어진 발생기에서도 해석적 ∇P = 수치 미분 (지향성 on)', () => {
    const src = makeSourceSet(disc, base.d, 0.3, 0.8, { tilt: deg(7), offset: 1.5e-3 });
    const f = newPointField();
    const g = newPointField();
    const h = 1e-7;
    for (const [x, y, z] of [
      [0.3e-3, -0.4e-3, 6e-3],
      [-2e-3, 1.1e-3, 11e-3],
      [4e-3, 3e-3, 15e-3],
    ]) {
      evalField(src, med.k, x, y, z, true, f);
      const num = (dx: number, dy: number, dz: number) => {
        evalField(src, med.k, x + dx, y + dy, z + dz, true, g);
        const pr = g.pr;
        const pi = g.pi;
        evalField(src, med.k, x - dx, y - dy, z - dz, true, g);
        return [(pr - g.pr) / (2 * h), (pi - g.pi) / (2 * h)];
      };
      const [gxr, gxi] = num(h, 0, 0);
      const [gyr, gyi] = num(0, h, 0);
      const [gzr, gzi] = num(0, 0, h);
      const scale = Math.sqrt(absGrad2(f));
      for (const [a, b] of [
        [f.gxr, gxr],
        [f.gxi, gxi],
        [f.gyr, gyr],
        [f.gyi, gyi],
        [f.gzr, gzr],
        [f.gzi, gzi],
      ]) {
        expect(Math.abs(a - b) / scale).toBeLessThan(1e-5);
      }
    }
  });

  it('기울기 0이면 위 발생기 법선 = (0, 0, −1)', () => {
    const src = makeSourceSet(disc, base.d, 0);
    const m = disc.x.length;
    expect([src.nx[m], src.ny[m], src.nz[m]]).toEqual([0, 0, -1]);
    expect([src.nx[0], src.ny[0], src.nz[0]]).toEqual([0, 0, 1]);
  });

  it('기울인 위 원판 점들은 모두 기울어진 면 위에 있음', () => {
    const pose = { tilt: deg(8), offset: 2e-3 };
    const src = makeSourceSet(disc, base.d, 0, 1, pose);
    const up = transducerPlanes(base.d, pose).upper;
    const m = disc.x.length;
    for (let j = m; j < src.n; j++) {
      const dp = (src.x[j] - up.px) * up.nx + (src.y[j] - up.py) * up.ny + (src.z[j] - up.pz) * up.nz;
      expect(Math.abs(dp)).toBeLessThan(1e-15);
    }
  });
});

describe('일반 평면 반사', () => {
  const pl = transducerPlanes(base.d, { tilt: deg(10), offset: 1e-3 }).upper;

  it('두 번 뒤집으면 제자리, 평면 위의 점은 그대로', () => {
    const p = { x: 1e-3, y: -2e-3, z: 5e-3 };
    const dir = { x: 0.1, y: 0.2, z: 0.97 };
    reflectAcross(pl, p, dir);
    reflectAcross(pl, p, dir);
    expect(p.x).toBeCloseTo(1e-3, 15);
    expect(p.y).toBeCloseTo(-2e-3, 15);
    expect(p.z).toBeCloseTo(5e-3, 15);
    expect(dir.z).toBeCloseTo(0.97, 12);
    const q = { x: pl.px, y: pl.py, z: pl.pz };
    reflectAcross(pl, q, { x: 0, y: 0, z: 1 });
    expect(q.z).toBeCloseTo(pl.pz, 15);
  });

  it('기울어진 면의 거울상: 면까지 거리 같고 반대쪽, 진폭 R', () => {
    const pose = { tilt: deg(6), offset: 0 };
    const one = { x: Float64Array.of(0), y: Float64Array.of(0), area: Float64Array.of(1) };
    const src: SourceSet = makeSourceSet(one, base.d, 0, 1, pose);
    const img = withReflections(src, src, base.d, 0.5, 1, pose);
    const up = transducerPlanes(base.d, pose).upper;
    const dist = (x: number, y: number, z: number) => (x - up.px) * up.nx + (y - up.py) * up.ny + (z - up.pz) * up.nz;
    // 아래 점(원점)의 1차 거울상 = 위 면에 대해 뒤집은 점
    const k = 2; // [아래, 위, 아래의 거울상, 위의 거울상]
    expect(dist(img.x[k], img.y[k], img.z[k])).toBeCloseTo(-dist(0, 0, 0), 15);
    expect(Math.hypot(img.cRe[k], img.cIm[k])).toBeCloseTo(0.5, 15);
    expect(reflectionOrders(0.5)).toBe(5);
  });
});

describe('비대칭 발생기가 덫을 옮김', () => {
  /** (x, y) 평면에서 U가 가장 낮은 곳 (z 고정, 간격 0.05 mm 격자 탐색) */
  function trapXY(src: SourceSet, z: number): { x: number; y: number } {
    const f = newPointField();
    let best = { x: 0, y: 0, U: Infinity };
    for (let i = -60; i <= 60; i++) {
      for (let j = -60; j <= 60; j++) {
        const x = i * 0.05e-3;
        const y = j * 0.05e-3;
        evalField(src, med.k, x, y, z, true, f);
        const U = gorkovPotential(absP2(f), absGrad2(f), med, particle);
        if (U < best.U) best = { x, y, U };
      }
    }
    return best;
  }

  const zMid = 13.1e-3; // 위쪽 가운데 덫 높이 근처

  it('기울기·어긋남 0: 덫은 축 위', () => {
    const src = makeSources(fieldParamsOf({ ...base, directivity: true, reflections: true }), lam);
    const t = trapXY(src, zMid);
    expect(Math.abs(t.x)).toBeLessThan(0.06e-3);
    expect(Math.abs(t.y)).toBeLessThan(0.06e-3);
  });

  it('위 발생기를 +x로 2 mm 옮기면 덫이 +x 쪽으로 (0~2 mm 사이)', () => {
    const src = makeSources(fieldParamsOf({ ...base, directivity: true, reflections: true, offset: 2e-3 }), lam);
    const t = trapXY(src, zMid);
    console.log(`[자세] 어긋남 2 mm: z=${zMid * 1e3} mm 덫 x = ${(t.x * 1e3).toFixed(2)} mm, y = ${(t.y * 1e3).toFixed(2)} mm`);
    expect(t.x).toBeGreaterThan(0.1e-3);
    expect(t.x).toBeLessThan(2e-3);
    expect(Math.abs(t.y)).toBeLessThan(0.06e-3);
  });

  it('위 발생기를 x축 둘레로 5° 기울이면 덫이 y 방향으로 옮겨감 (x는 대칭이라 0)', () => {
    const src = makeSources(fieldParamsOf({ ...base, directivity: true, reflections: true, tilt: deg(5) }), lam);
    const t = trapXY(src, zMid);
    console.log(`[자세] 기울기 5°: 덫 x = ${(t.x * 1e3).toFixed(2)} mm, y = ${(t.y * 1e3).toFixed(2)} mm`);
    expect(Math.abs(t.x)).toBeLessThan(0.06e-3);
    expect(Math.abs(t.y)).toBeGreaterThan(0.1e-3);
  });
});
