/**
 * 장면(Scene)에서 횡방향 안정성 계산 (physics/lateral.ts를 장면 값으로 호출)
 */
import { findLocalMinima } from '../physics/field2d';
import { lateralStability, type LateralResult } from '../physics/lateral';
import type { Scene } from './scene';

/** 축 위 덫(U 최소) 위치 목록 */
export function trapsOf(sc: Scene): number[] {
  return findLocalMinima(sc.axis.z, sc.axisU).map((m) => m.z);
}

export function lateralFor(sc: Scene, zTrap: number): LateralResult {
  return lateralStability(sc.sources, sc.med, sc.particle, sc.s * sc.s, zTrap, sc.axis.z, sc.axisF, sc.params.directivity);
}
