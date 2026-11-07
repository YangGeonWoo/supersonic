/**
 * G3: 3D 격자 장면(CPU 기준 계산)에서 힘·덫·강성·3D 공 운동.
 * 축대칭 조건에서는 기존 2D(축대칭) 결과와 같아야 하고, 기울기·어긋남을 주면 대칭이 깨져야 한다.
 */
import { describe, expect, it } from 'vitest';
import { makeMedium } from '../src/physics/acoustics';
import { calibrate } from '../src/physics/calibration';
import { computeGrid3Cpu, computeDomain3, fillMask, gridDims, type Grid3 } from '../src/physics/grid3';
import { initState3, verletStep3, type Dynamics3 } from '../src/physics/integrator';
import { createBallSim } from '../src/sim/ballSim';
import { createBallSim3, fieldLimitDensity3 } from '../src/sim/ballSim3';
import { lateralFor, trapsOf } from '../src/sim/lateralScene';
import { fieldLimitDensity, trapNear } from '../src/sim/limits';
import { buildScene, fieldParamsOf, makeSources } from '../src/sim/scene';
import { finishScene3, type Scene3 } from '../src/sim/scene3';
import { base } from './helpers';

const SPACING = 1 / 24;

function grid3For(p: typeof base): { grid: Grid3; ms: number } {
  const med = makeMedium(p.f, p.T);
  const pose = { tilt: p.tilt, offset: p.offset };
  const dom = computeDomain3(p.d, med.lambda, pose);
  const g = gridDims(dom, med.lambda, SPACING);
  const t0 = performance.now();
  const grid = computeGrid3Cpu(makeSources(fieldParamsOf(p), med.lambda), med, g, p.directivity);
  fillMask(grid, p.d, med.lambda, pose);
  return { grid, ms: performance.now() - t0 };
}

const cache = new Map<string, Scene3>();
function scene3(p: typeof base): Scene3 {
  const key = JSON.stringify(p);
  let sc = cache.get(key);
  if (!sc) {
    const { grid, ms } = grid3For(p);
    sc = finishScene3(grid, p, calibrate(p.directivity, p.reflections), ms, 'cpu');
    cache.set(key, sc);
  }
  return sc;
}

describe('3D 적분기', () => {
  it('감쇠·중력 없는 3D 조화 진동: 주기 2π√(m/k), 100주기 에너지 변화 < 1%', () => {
    const m = 1e-6;
    const k = [2, 3, 5];
    const dyn: Dynamics3 = {
      m,
      cdx: 0,
      cdy: 0,
      cdz: 0,
      g: 0,
      force: (x, y, z, out) => {
        out.fx = -k[0] * x;
        out.fy = -k[1] * y;
        out.fz = -k[2] * z;
      },
      walls: () => false,
    };
    const s = initState3(dyn, 1e-3, 1e-3, 1e-3);
    const E = () => 0.5 * m * (s.vx ** 2 + s.vy ** 2 + s.vz ** 2) + 0.5 * (k[0] * s.x ** 2 + k[1] * s.y ** 2 + k[2] * s.z ** 2);
    const E0 = E();
    const T = 2 * Math.PI * Math.sqrt(m / k[2]);
    const dt = T / 50;
    let crossings = 0;
    let prev = s.z;
    let tFirst = NaN;
    let tLast = NaN;
    for (let i = 0; i < 50 * 100; i++) {
      verletStep3(dyn, s, dt);
      if (prev < 0 && s.z >= 0) {
        crossings++;
        if (crossings === 1) tFirst = s.t;
        tLast = s.t;
      }
      prev = s.z;
    }
    expect(Math.abs(E() / E0 - 1)).toBeLessThan(0.01);
    expect(Math.abs((tLast - tFirst) / (crossings - 1) / T - 1)).toBeLessThan(0.02);
  });
});

describe('축대칭 조건: 3D 격자 = 기존 2D', () => {
  const p = { ...base }; // 지향성 off, 반사 off, 기울기 0 — SPEC 검증 기준 모델
  const sc3 = scene3(p);
  const sc2 = buildScene(p, calibrate(false));

  it('덫 위치가 2D 축 위 덫과 λ/50 이내, 축 위 (x, y ≈ 0)', () => {
    const t2 = trapsOf(sc2);
    console.log(`[3D] CPU 3D 격자 ${sc3.grid.nx}×${sc3.grid.ny}×${sc3.grid.nz} = ${(sc3.grid.nx * sc3.grid.ny * sc3.grid.nz).toLocaleString()} 복셀, ${sc3.computeMs.toFixed(0)} ms (CPU)`);
    console.log(`[3D] 덫 z: 3D ${sc3.traps.map((t) => (t.z * 1e3).toFixed(3)).join(', ')} / 2D ${t2.map((z) => (z * 1e3).toFixed(3)).join(', ')}`);
    const inner = sc3.traps.filter((t) => t.z > p.d * 0.25 && t.z < p.d * 0.75);
    expect(inner.length).toBe(2);
    for (const t of inner) {
      const z2 = t2.reduce((a, b) => (Math.abs(b - t.z) < Math.abs(a - t.z) ? b : a));
      expect(Math.abs(t.z - z2)).toBeLessThan(sc3.med.lambda / 50);
      expect(Math.hypot(t.x, t.y)).toBeLessThan(sc3.med.lambda / 100);
    }
  });

  it('가운데 덫 옆 강성: x, y 같음(대칭), 2D κ_ρ와 10% 이내; 위아래 강성도 10% 이내', () => {
    const L = sc3.lateral!;
    const lat2 = lateralFor(sc2, sc3.centralTrap!.z);
    console.log(`[3D] 옆 강성 고유값 ${(L.kMin * 1e3).toFixed(3)}, ${(L.kMax * 1e3).toFixed(3)} mN/m (2D κ_ρ ${(lat2.kappaRho * 1e3).toFixed(3)}), κ_z 3D ${(L.kz * 1e3).toFixed(1)} / 2D ${(lat2.kappaZ * 1e3).toFixed(1)} mN/m`);
    expect(Math.abs(L.kMax - L.kMin) / L.kMax).toBeLessThan(0.02);
    expect(Math.abs(L.kMin / lat2.kappaRho - 1)).toBeLessThan(0.1);
    expect(Math.abs(L.kz / lat2.kappaZ - 1)).toBeLessThan(0.1);
  });

  it('3D 공: x로 놓든 y로 놓든 축으로 돌아와 2D와 같은 높이에 부양', () => {
    const s2 = createBallSim(sc2);
    s2.advanceSim(4);
    for (const az of [0, Math.PI / 2]) {
      const s3 = createBallSim3(sc3, az);
      s3.advanceSim(4);
      console.log(`[3D] 방위 ${((az * 180) / Math.PI).toFixed(0)}°: ${s3.status} x=${(s3.state.x * 1e3).toFixed(3)} y=${(s3.state.y * 1e3).toFixed(3)} z=${(s3.state.z * 1e3).toFixed(4)} mm (2D z=${(s2.state.z * 1e3).toFixed(4)})`);
      expect(s3.status).toBe('levitating');
      expect(Math.hypot(s3.state.x, s3.state.y)).toBeLessThan(0.05e-3);
      expect(Math.abs(s3.state.z - s2.state.z)).toBeLessThan(0.03e-3);
    }
  });

  // 보통 해상도(λ/24) 격자 미분은 힘의 최댓값을 약 5% 작게 잡는다 (2D 축 프로파일은 λ/200, SPEC 2.4: λ/40에서 약 2%)
  it('3D 부양 한계 ≈ 2D 장 한계 (λ/24 격자 오차 포함 8%)', () => {
    const l3 = fieldLimitDensity3(sc3, sc3.centralTrap!);
    const l2 = fieldLimitDensity(sc2, trapNear(sc2, sc3.centralTrap!.z)!);
    console.log(`[3D] 부양 한계 3D ${l3.toFixed(1)} / 2D ${l2.toFixed(1)} kg/m³`);
    expect(Math.abs(l3 / l2 - 1)).toBeLessThan(0.08);
  });
});

describe('비대칭 발생기 (3D 격자에서만 가능)', () => {
  const sym = scene3({ ...base, directivity: true, reflections: true });

  // 조사 결과: 5° 기울기는 덫을 y로 옮긴다. 면 가까운 바깥 덫일수록 크고 방향은 위아래가 반대
  // (아래 덫 +1.41 mm, 맨 위 덫 −0.85 mm, 가운데 덫 +0.24~0.35 mm — 마디 면 전체가 기울어짐).
  // 가운데 덫의 옆 강성은 방향에 따라 1% 미만으로만 달라진다.
  it('위 발생기 5° 기울기: 덫이 y로 옮겨가고(바깥 덫일수록 크게, 위아래 반대), 옆 강성은 약간만 갈라짐', () => {
    const sc = scene3({ ...base, directivity: true, reflections: true, tilt: (5 * Math.PI) / 180 });
    const up = sc.traps.at(-1)!;
    const L = sc.lateral!;
    const Ls = sym.lateral!;
    const split = (L.kMax - L.kMin) / L.kMax;
    console.log(`[3D] 기울기 5°: 덫 ${sc.traps.map((t) => `(${(t.x * 1e3).toFixed(2)}, ${(t.y * 1e3).toFixed(2)}, ${(t.z * 1e3).toFixed(2)})`).join(' ')} mm`);
    console.log(`[3D]   가운데 덫 옆 강성 ${(L.kMin * 1e3).toFixed(3)} / ${(L.kMax * 1e3).toFixed(3)} mN/m (차이 ${(split * 100).toFixed(1)}%, 주축 ${((L.angleMin * 180) / Math.PI).toFixed(0)}°), 대칭이면 ${(Ls.kMin * 1e3).toFixed(3)} / ${(Ls.kMax * 1e3).toFixed(3)}`);
    expect(Math.abs(up.y)).toBeGreaterThan(0.1e-3);
    expect(Math.abs(up.x)).toBeLessThan(0.05e-3);
    expect(split).toBeGreaterThan((Ls.kMax - Ls.kMin) / Ls.kMax + 0.002);
    expect(split).toBeLessThan(0.05);
    // 바깥 덫일수록 많이 옮겨가고, 맨 아래와 맨 위는 반대 방향 (마디 면이 기울어짐)
    expect(Math.abs(sc.traps[0].y)).toBeGreaterThan(Math.abs(sc.traps[1].y));
    expect(Math.sign(sc.traps[0].y)).toBe(-Math.sign(sc.traps.at(-1)!.y));
    const b = createBallSim3(sc);
    b.advanceSim(4);
    expect(b.status).toBe('levitating');
  });

  it('위 발생기 +x 2 mm 어긋남: 가운데 덫이 +x로', () => {
    const sc = scene3({ ...base, directivity: true, reflections: true, offset: 2e-3 });
    console.log(`[3D] 어긋남 2 mm: 덫 x = ${sc.traps.map((t) => (t.x * 1e3).toFixed(2)).join(', ')} mm`);
    expect(sc.centralTrap!.x).toBeGreaterThan(0.1e-3);
    expect(sc.centralTrap!.x).toBeLessThan(2e-3);
    const b = createBallSim3(sc);
    b.advanceSim(4);
    expect(b.status).toBe('levitating');
    expect(Math.abs(b.state.x - sc.centralTrap!.x)).toBeLessThan(0.3e-3);
  });
});
