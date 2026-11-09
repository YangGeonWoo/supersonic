/**
 * 발표용 손질: 주소 시작값(?dia=&drive=&rho=), 2D 기본 공 지름, 확인한 비례 관계.
 */
import { describe, expect, it } from 'vitest';
import { default2DParams } from '../src/App';
import { calibrate } from '../src/physics/calibration';
import { defaultParams } from '../src/physics/params';
import { buildScene } from '../src/sim/scene';
import { fieldLimitDensity, trapNear } from '../src/sim/limits';
import { applyUrlParams } from '../src/state/urlParams';

describe('주소 시작값', () => {
  it('dia(mm)·drive·rho를 SI로 바꾸고 슬라이더 범위로 자른다', () => {
    const p = applyUrlParams(defaultParams(), '?dia=1.5&drive=1.5&rho=30');
    expect(p.ballDiameter).toBeCloseTo(1.5e-3, 12);
    expect(p.drive).toBe(1.5);
    expect(p.rhoP).toBe(30);
    const q = applyUrlParams(defaultParams(), '?dia=99&drive=-1&rho=abc');
    expect(q.ballDiameter).toBeCloseTo(6e-3, 12);
    expect(q.drive).toBe(0);
    expect(q.rhoP).toBe(defaultParams().rhoP);
  });

  it('주소가 없으면 2D 기본 공 지름은 1.2 mm', () => {
    expect(default2DParams().ballDiameter).toBeCloseTo(1.2e-3, 12);
  });
});

describe('발표에서 보여줄 관계 (2D 장 기준)', () => {
  const base = { ...defaultParams(), ballDiameter: 1.2e-3 };
  const cal = calibrate(base.directivity, base.reflections);
  const limitMass = (p: typeof base) => {
    const sc = buildScene(p, cal);
    return { sc, m: fieldLimitDensity(sc, trapNear(sc, p.d / 2)!) * sc.particle.V };
  };

  it('구동 세기 2배 → P0 2배, 부양 한계 4배', () => {
    const a = limitMass(base);
    const b = limitMass({ ...base, drive: 2 });
    expect(b.sc.P0 / a.sc.P0).toBeCloseTo(2, 6);
    expect(b.m / a.m).toBeCloseTo(4, 1);
  });

  it('공 지름을 바꿔도 "지금 무게의 N배"는 같다 (r³ 약분)', () => {
    const ratio = (dia: number) => {
      const r = limitMass({ ...base, ballDiameter: dia });
      return r.m / r.sc.particle.m;
    };
    const r0 = ratio(1.2e-3);
    for (const d of [1e-3, 2e-3, 3e-3, 6e-3]) expect(ratio(d) / r0).toBeCloseTo(1, 3);
  });
});
