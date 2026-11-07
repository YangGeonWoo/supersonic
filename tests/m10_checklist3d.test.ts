/**
 * PLAN_3D.md 6장 검증 체크리스트 중 다른 파일에서 다루지 않은 항목
 *  - 온도 T를 바꾸면 마디 간격이 c/(2f)로 바뀜 (c = 331.3 + 0.606·T)
 *  - 공 지름 > λ/2이면 Gor'kov 한계 경고
 *  - 3D 페이지 수치(F_max, 마디 개수, 상태)가 2D와 같음
 * (공진 이득 최대: m5_graphs, 위상차 φ 마디 이동: m2_layerB 검증 4, 비대칭 밀림: m9_push)
 */
import { describe, expect, it } from 'vitest';
import { default3DParams } from '../src/App3D';
import { makeMedium, soundSpeed } from '../src/physics/acoustics';
import { calibrate } from '../src/physics/calibration';
import { gorkovValidity } from '../src/physics/gorkov';
import { defaultParams } from '../src/physics/params';
import { createBallSim } from '../src/sim/ballSim';
import { buildScene } from '../src/sim/scene';
import { base } from './helpers';

const cal = calibrate(false);

describe('온도와 마디 간격', () => {
  for (const T of [0, 20, 40]) {
    // SPEC 검증 2와 같은 조건(작은 발생기, 긴 간격): 근접장 영향이 작은 가운데 구간
    // (기본 조건 a_t = 8 mm, d = 5λ/2에서는 근접장 때문에 가운데 간격이 λ/2보다 약 11% 넓음)
    it(`T = ${T} °C: 가운데 마디 간격 = c/(2f) (1%, a_t = 4 mm, d = 9λ/2)`, () => {
      const sc = buildScene({ ...base, T, at: 4e-3, d: (9 * makeMedium(base.f, T).lambda) / 2 }, cal);
      const n = sc.nodesB;
      const mid = n[Math.floor(n.length / 2)] - n[Math.floor(n.length / 2) - 1];
      const expected = soundSpeed(T) / (2 * base.f);
      console.log(`[체크] T=${T}°C c=${soundSpeed(T).toFixed(1)} m/s: 가운데 간격 ${(mid * 1e3).toFixed(4)} mm, c/(2f) = ${(expected * 1e3).toFixed(4)} mm`);
      expect(Math.abs(mid / expected - 1)).toBeLessThan(0.01);
    });
  }
});

describe('Gor’kov 한계 경고', () => {
  const lam = makeMedium(40e3, 20).lambda;
  it('ka < 0.5 정상, 지름 < λ/2 주의, 지름 ≥ λ/2(≈ 4.29 mm) 경고', () => {
    expect(gorkovValidity(1e-3, lam).level).toBe('ok');
    expect(gorkovValidity(3e-3, lam).level).toBe('caution'); // 기본 공: ka ≈ 1.1
    expect(gorkovValidity(3e-3, lam).ka).toBeCloseTo((Math.PI * 3e-3) / lam, 12);
    expect(gorkovValidity(4.2e-3, lam).level).toBe('caution');
    expect(gorkovValidity(4.4e-3, lam).level).toBe('invalid');
    expect(gorkovValidity(6e-3, lam).level).toBe('invalid');
  });
});

describe('3D 페이지 수치 = 2D', () => {
  it('밀림 off: F_max, 마디, 안착 위치·상태가 2D와 완전히 같음', () => {
    const p2 = defaultParams();
    const p3 = { ...default3DParams(), travelingForce: false };
    const c = calibrate(p2.directivity);
    const a = buildScene(p2, c);
    const b = buildScene(p3, c);
    expect(b.Fmax).toBe(a.Fmax);
    expect(b.nodesB).toEqual(a.nodesB);
    const sa = createBallSim(a);
    const sb = createBallSim(b);
    sa.advanceSim(3);
    sb.advanceSim(3);
    expect(sb.state.z).toBe(sa.state.z);
    expect(sb.status).toBe(sa.status);
  });

  it('밀림 on(3D 기본): F_max·마디 개수·상태는 같고, 안착 위치만 조금 다름', () => {
    const c = calibrate(true);
    const a = buildScene(defaultParams(), c);
    const b = buildScene(default3DParams(), c);
    expect(b.Fmax).toBe(a.Fmax);
    expect(b.nodesB.length).toBe(a.nodesB.length);
    const sa = createBallSim(a);
    const sb = createBallSim(b);
    sa.advanceSim(3);
    sb.advanceSim(3);
    expect(sb.status).toBe(sa.status);
    console.log(`[체크] 3D 기본(밀림 on) 안착 z = ${(sb.state.z * 1e3).toFixed(4)} mm, 2D ${(sa.state.z * 1e3).toFixed(4)} mm (차이 ${((sb.state.z - sa.state.z) * 1e6).toFixed(1)} µm)`);
    expect(Math.abs(sb.state.z - sa.state.z)).toBeLessThan(0.1e-3);
  });
});
