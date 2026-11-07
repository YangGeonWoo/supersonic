/**
 * M6: 측면 안정성 조사 (검증 11 보충)
 *
 * 결과 요약 (README "측면 안정성" 참고)
 *  - 가운데 마디: 조사한 모든 a_t(4~10mm), d(4~8·λ/2)에서 F_x가 복원 방향.
 *  - 면에 가까운 바깥 마디(면에서 약 0.4λ): 발생기가 크고(a_t ≳ 8mm) 간격이 짧으면 축 위에서 F_x가
 *    바깥쪽을 향한다. 원판 가장자리에서 오는 큰 각도 성분이 근접장에서 축 밖에 압력 극대를 만들기 때문.
 *    이때 공은 축에서 1~2mm 떨어진 곳(F_x가 다시 복원으로 바뀌는 곳)에 머문다.
 *  - 점음원 지향성 (1+cosθ)/2를 켜면 큰 각도 성분이 줄어 바깥 마디도 (약하게) 복원된다.
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { axisPotential, findLocalMinima, sampleForce } from '../src/physics/field2d';
import { BallSim, sceneDynamics } from '../src/sim/ballSim';
import { buildScene, type Scene } from '../src/sim/scene';
import { base, med } from './helpers';

function uMinima(sc: Scene): number[] {
  return findLocalMinima(sc.axis.z, axisPotential(sc.axis, med, sc.particle, sc.s * sc.s)).map((m) => m.z);
}

function fxOverMg(sc: Scene, x: number, z: number): number {
  const out = { fx: 0, fz: 0 };
  sampleForce(sc.potential, sc.s * sc.s, x, z, out);
  return out.fx / sc.weight;
}

/** 마디 (x0, zn)에 놓고 seconds 동안 시뮬레이션 */
function releaseAt(sc: Scene, x0: number, zn: number, seconds = 3) {
  const sim = new BallSim(sceneDynamics(sc), sc.dt, sc.Tosc, sc.particle.a, x0, zn);
  sim.advanceSim(seconds);
  return sim;
}

const calOff = calibrate(false);
const calOn = calibrate(true);

describe('측면 안정성: 발생기 반지름·간격 스캔 (지향성 off)', () => {
  it('가운데 마디는 모든 조건에서 복원, 바깥 마디는 a_t가 크면 불안정', () => {
    const rows: string[] = [];
    for (const at of [4e-3, 6e-3, 8e-3, 10e-3]) {
      for (const n of [4, 5, 6, 8]) {
        const sc = buildScene({ ...base, at, d: (n * med.lambda) / 2 }, calOff);
        const mins = uMinima(sc);
        const v = mins.map((zn) => fxOverMg(sc, 0.3e-3, zn));
        rows.push(`a_t=${(at * 1e3).toFixed(0)}mm d=${n}·λ/2: F_x/mg(x=+0.3mm) = ${v.map((x) => x.toFixed(2)).join(', ')}`);
        // 바깥 마디(양 끝)를 뺀 가운데 마디는 복원 방향
        for (const fx of v.slice(1, -1)) expect(fx).toBeLessThan(0);
        // 작은 발생기는 바깥 마디도 복원
        if (at <= 6e-3) for (const fx of v) expect(fx).toBeLessThan(0);
      }
    }
    console.log('[M6 측면]\n  ' + rows.join('\n  '));
  });
});

describe('측면 안정성: 기본 조건의 바깥 마디', () => {
  it('지향성 off: 축 위는 불안정, 공은 축에서 1~2.5mm 떨어져 부양', () => {
    const sc = buildScene(base, calOff);
    const outer = uMinima(sc).at(-1)!;
    expect(fxOverMg(sc, 0.3e-3, outer)).toBeGreaterThan(0); // 바깥으로 밂
    expect(fxOverMg(sc, 3e-3, outer)).toBeLessThan(0); // 멀리서는 다시 복원
    const sim = releaseAt(sc, 0.5e-3, outer);
    console.log(`[M6 측면] 지향성 off, 바깥 마디 z=${(outer * 1e3).toFixed(2)}mm에 x=0.5mm로 놓음 → x=${(sim.state.x * 1e3).toFixed(2)}mm, ${sim.status}`);
    expect(sim.status).toBe('levitating');
    expect(Math.abs(sim.state.x)).toBeGreaterThan(1e-3);
    expect(Math.abs(sim.state.x)).toBeLessThan(2.5e-3);
  });

  it('지향성 on: 바깥 마디도 복원, 공은 축으로 돌아옴', () => {
    const sc = buildScene({ ...base, directivity: true }, calOn);
    const outer = uMinima(sc).at(-1)!;
    expect(fxOverMg(sc, 0.3e-3, outer)).toBeLessThan(0);
    const sim = releaseAt(sc, 0.5e-3, outer, 6);
    console.log(`[M6 측면] 지향성 on, 바깥 마디에 x=0.5mm로 놓음 → 6 s 후 x=${(sim.state.x * 1e3).toFixed(3)}mm, ${sim.status}`);
    expect(sim.status).toBe('levitating');
    expect(Math.abs(sim.state.x)).toBeLessThan(0.2e-3);
  });
});
