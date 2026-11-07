/**
 * 3D 5단계: 횡방향 안정성 (U(ρ), F_ρ(ρ), κ_ρ/κ_z) 과 음향 세기 벡터
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { evalField, findLocalMinima, intensityOf, newPointField } from '../src/physics/field2d';
import { lateralStability, nearestTrap, stiffnessFit } from '../src/physics/lateral';
import { stiffness } from '../src/physics/gorkov';
import type { SourceSet } from '../src/physics/sourceSampling';
import { buildScene, type Scene } from '../src/sim/scene';
import { base, med } from './helpers';

function lat(sc: Scene, zTrap: number) {
  return lateralStability(sc.sources, med, sc.particle, sc.s * sc.s, zTrap, sc.axis.z, sc.axisF, sc.params.directivity);
}

function traps(sc: Scene): number[] {
  return findLocalMinima(sc.axis.z, sc.axisU).map((m) => m.z);
}

describe('음향 세기 벡터', () => {
  it('점음원 하나: I는 바깥쪽, 크기 = |P|²·k/(2ωρ0)', () => {
    const src: SourceSet = {
      n: 1,
      x: Float64Array.of(0),
      y: Float64Array.of(0),
      z: Float64Array.of(0),
      cRe: Float64Array.of(1),
      cIm: Float64Array.of(0),
      side: Float64Array.of(1),
    } as unknown as SourceSet;
    const f = newPointField();
    const I = { x: 0, y: 0, z: 0 };
    const R = 5e-3;
    evalField(src, med.k, R, 0, 0, false, f);
    intensityOf(f, med, I);
    const expected = (1 / (R * R)) * med.k / (2 * med.omega * med.rho0);
    expect(I.x / expected).toBeCloseTo(1, 9);
    expect(Math.abs(I.z)).toBeLessThan(expected * 1e-12);
  });

  it('출력이 같아도 구면파 감쇠 때문에 진행파 성분이 있음: 가운데에서 0, 그 밖에서는 가운데를 향함', () => {
    const sc = buildScene(base, calibrate(false));
    const f = newPointField();
    const I = { x: 0, y: 0, z: 0 };
    // 기준: 축 위 최대 |P|의 평면 진행파 세기
    const Pmax2 = Math.max(...sc.axis.p2);
    const Iref = (Pmax2 * med.k) / (2 * med.omega * med.rho0);
    evalField(sc.sources, med.k, 0, 0, base.d / 2, false, f);
    intensityOf(f, med, I);
    expect(Math.abs(I.z) / Iref).toBeLessThan(1e-9);
    const rows: string[] = [];
    for (const z of traps(sc)) {
      evalField(sc.sources, med.k, 0, 0, z, false, f);
      intensityOf(f, med, I);
      expect(Math.abs(I.x) / Iref).toBeLessThan(1e-9); // 축 위 반지름 성분 0
      expect(Math.sign(I.z)).toBe(Math.sign(base.d / 2 - z)); // 가운데를 향함
      rows.push(`z=${(z * 1e3).toFixed(2)}mm I_z/I_ref=${(I.z / Iref).toFixed(4)}`);
    }
    console.log('[세기] 대칭 구동, 덫 위치: ' + rows.join(', '));
  });
});

describe('횡방향 안정성', () => {
  for (const directivity of [false, true]) {
    const sc = buildScene({ ...base, directivity }, calibrate(directivity));
    const ts = traps(sc);

    it(`지향성 ${directivity ? 'on' : 'off'}: U(ρ=0) = 축 위 U, 가운데 덫은 κ_ρ > 0`, () => {
      const rows: string[] = [];
      for (const zt of ts) {
        const r = lat(sc, zt);
        // U(ρ = 0)이 축 프로파일 U와 일치 (같은 evalField)
        let i = 0;
        while (sc.axis.z[i] < zt) i++;
        const zi = sc.axis.z[i];
        const r0 = lateralStability(sc.sources, med, sc.particle, sc.s * sc.s, zi, sc.axis.z, sc.axisF, directivity);
        expect(r0.profile.U[0]).toBeCloseTo(sc.axisU[i], 18);
        rows.push(
          `z=${(zt * 1e3).toFixed(2)}mm κ_ρ=${r.kappaRho.toExponential(3)} κ_z=${r.kappaZ.toExponential(3)} κ_ρ/κ_z=${r.ratio.toFixed(4)}${r.ringRadius !== null ? ` 고리 반지름 ${(r.ringRadius * 1e3).toFixed(2)}mm` : ''}`,
        );
      }
      console.log(`[횡방향] 지향성 ${directivity ? 'on' : 'off'}\n  ` + rows.join('\n  '));
      const central = [...ts].sort((a, b) => Math.abs(a - base.d / 2) - Math.abs(b - base.d / 2)).slice(0, 2);
      for (const zt of central) {
        const r = lat(sc, zt);
        expect(r.stable).toBe(true);
        expect(r.ratio).toBeGreaterThan(0);
        expect(r.ratio).toBeLessThan(1); // 횡방향은 축 방향보다 약함
      }
    });

    it(`지향성 ${directivity ? 'on' : 'off'}: 바깥 덫 판정이 m6 조사 결과와 일치`, () => {
      const outer = lat(sc, ts.at(-1)!);
      if (directivity) {
        expect(outer.stable).toBe(true);
      } else {
        expect(outer.stable).toBe(false);
        // 고리 반지름(덫 높이 기준) ≈ m6 시뮬레이션의 1.54 mm (공은 중력으로 처진 높이에 있어 약간 다름)
        expect(outer.ringRadius).not.toBeNull();
        expect(Math.abs(outer.ringRadius! - 1.54e-3)).toBeLessThan(0.3e-3);
      }
    });
  }

  it('κ_z는 A층 해석식 κ = 2kF_max와 같은 크기 (근접장 때문에 ±40%)', () => {
    const sc = buildScene(base, calibrate(false));
    const zt = nearestTrap(sc.axis.z, sc.axisU, base.d / 2 - 1e-4)!;
    const r = lat(sc, zt);
    const kA = stiffness(sc.P0, med, sc.particle);
    console.log(`[횡방향] κ_z(B층) = ${r.kappaZ.toExponential(3)}, κ(A층) = ${kA.toExponential(3)}, 비 ${(r.kappaZ / kA).toFixed(3)}`);
    expect(r.kappaZ / kA).toBeGreaterThan(0.6);
    expect(r.kappaZ / kA).toBeLessThan(1.4);
  });

  it('stiffnessFit: 직선 F = −κx를 정확히 복원', () => {
    const x = Float64Array.from({ length: 21 }, (_, i) => (i - 10) * 1e-5);
    const F = x.map((v) => -3.5 * v);
    expect(stiffnessFit(x, F, 0, 1e-4)).toBeCloseTo(3.5, 12);
  });
});
