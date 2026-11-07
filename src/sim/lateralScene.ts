/**
 * 장면(Scene)에서 횡방향 안정성과 밀림 효과 계산 (physics/lateral.ts를 장면 값으로 호출)
 */
import { findLocalMinima } from '../physics/field2d';
import { lateralStability, type LateralResult } from '../physics/lateral';
import type { Scene } from './scene';

/** F(z)의 + → − 영점 (선형 보간). [lo, hi] 안에서 target에 가장 가까운 것 */
function zeroCrossing(z: Float64Array, F: ArrayLike<number>, lo: number, hi: number, target: number, offset = 0): number | null {
  let best: number | null = null;
  for (let i = 1; i < z.length; i++) {
    if (z[i] < lo || z[i - 1] > hi) continue;
    const a = F[i - 1] - offset;
    const b = F[i] - offset;
    if (a > 0 && b <= 0) {
      const zc = z[i - 1] + (a / (a - b)) * (z[i] - z[i - 1]);
      if (best === null || Math.abs(zc - target) < Math.abs(best - target)) best = zc;
    }
  }
  return best;
}

/**
 * 축 위 덫 위치 목록. 중력 없이 축 방향 합력(Gor'kov + 밀림)이 0이 되는 안정 평형점.
 * 밀림이 꺼져 있으면 U 최소점과 같다.
 */
export function trapsOf(sc: Scene): number[] {
  const mins = findLocalMinima(sc.axis.z, sc.axisU).map((m) => m.z);
  if (sc.pushCoeff === 0) return mins;
  const w = sc.med.lambda / 8;
  return mins.map((zm) => zeroCrossing(sc.axis.z, sc.axisFz, zm - w, zm + w, zm) ?? zm);
}

export function lateralFor(sc: Scene, zTrap: number): LateralResult {
  return lateralStability(sc.sources, sc.med, sc.particle, sc.s * sc.s, zTrap, sc.axis.z, sc.axisFz, sc.params.directivity, sc.pushCoeff);
}

export interface PushEffect {
  /** 덫(U 최소) [m] */
  zNode: number;
  /** 중력 포함 평형 위치: 밀림 없을 때 / 있을 때 [m] */
  zEqGorkov: number | null;
  zEqTotal: number | null;
  /** 평형 이동량 (위 +) [m] */
  shift: number | null;
  /** 평형 위치에서 밀림 힘 F_z,push [N] */
  push: number;
}

/** 공이 있는 덫에서 밀림이 평형 위치를 얼마나 옮기는지 (중력 포함, 축 위) */
export function pushEffect(sc: Scene, zNear: number): PushEffect | null {
  const mins = findLocalMinima(sc.axis.z, sc.axisU).map((m) => m.z);
  if (mins.length === 0) return null;
  const zNode = mins.reduce((a, b) => (Math.abs(b - zNear) < Math.abs(a - zNear) ? b : a));
  const w = sc.med.lambda / 4;
  const zEqGorkov = zeroCrossing(sc.axis.z, sc.axisF, zNode - w, zNode + w, zNode, sc.weight);
  const zEqTotal = zeroCrossing(sc.axis.z, sc.axisFz, zNode - w, zNode + w, zNode, sc.weight);
  let push = 0;
  if (zEqTotal !== null) {
    let i = 0;
    while (i < sc.axis.z.length - 1 && sc.axis.z[i] < zEqTotal) i++;
    push = sc.axisFpush[i];
  }
  return {
    zNode,
    zEqGorkov,
    zEqTotal,
    shift: zEqGorkov !== null && zEqTotal !== null ? zEqTotal - zEqGorkov : null,
    push,
  };
}
