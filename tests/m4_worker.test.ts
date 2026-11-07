/**
 * M4: Worker 경로 확인 — buildField 결과가 structured clone(+transfer) 후에도
 * 메인 스레드 finishScene과 같은 결과를 내는지.
 */
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/physics/calibration';
import { buildField, buildScene, fieldParamsOf, finishScene } from '../src/sim/scene';
import { base } from './helpers';

describe('Worker 데이터 전달', () => {
  it('structuredClone(transfer) 후 finishScene = buildScene', () => {
    const cal = calibrate(false);
    const fd = buildField(fieldParamsOf(base));
    const transfer = [fd.field.pRe.buffer, fd.field.pIm.buffer, fd.field.p2.buffer, fd.field.g2.buffer, fd.axis.z.buffer, fd.axis.p2.buffer, fd.axis.g2.buffer];
    const cloned = structuredClone(fd, { transfer });
    const a = finishScene(cloned, { ...base, drive: 1.3 }, cal);
    const b = buildScene({ ...base, drive: 1.3 }, cal);
    expect(a.P0).toBeCloseTo(b.P0, 9);
    expect(a.nodesB).toEqual(b.nodesB);
    expect(Array.from(a.potential.Fz.slice(0, 50))).toEqual(Array.from(b.potential.Fz.slice(0, 50)));
  });

  it('장이 아직 옛 값이면 d 등 음향장 변수는 장 기준으로 맞춘다', () => {
    const cal = calibrate(false);
    const fd = buildField(fieldParamsOf(base));
    const sc = finishScene(fd, { ...base, d: 40e-3 }, cal);
    expect(sc.params.d).toBe(base.d);
  });
});
