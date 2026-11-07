/**
 * 음향장 히트맵 픽셀 계산 (2D 캔버스와 3D 텍스처가 공유).
 * 출력 행 0이 z 최댓값(위쪽)이 되도록 뒤집어서 쓴다.
 */
import { energyCoeff } from '../physics/gorkov';
import type { Scene } from '../sim/scene';
import { LUT_DIV, LUT_SEQ } from './colormap';

export type DisplayMode = 'amp' | 'potential' | 'instant';

/** 고정 색 범위 (구동 세기 변화가 화면 밝기로 보이도록) */
export const P_SCALE = 2000; // Pa

export function potentialScale(scene: Scene): number {
  // 기준 P0 = 1500 Pa일 때 A층 마디의 |U| 크기
  return scene.particle.V * energyCoeff(1500, scene.med) * 1.5 * Math.max(scene.particle.f2, 0.1);
}

/**
 * scene.field 격자(nx × nz)를 RGBA로 칠한다. data 길이는 nx·nz·4.
 * phase: 순간 압력 모드의 시각화 위상 [rad]
 */
export function fieldToRGBA(sc: Scene, m: DisplayMode, phase: number, data: Uint8ClampedArray, alpha = 255): void {
  const g = sc.field;
  const s = sc.s;
  const s2 = s * s;
  const uScale = potentialScale(sc);
  const lut = m === 'amp' ? LUT_SEQ : LUT_DIV;
  const c = Math.cos(phase);
  const sn = Math.sin(phase);
  for (let iz = 0; iz < g.nz; iz++) {
    const row = g.nz - 1 - iz; // z 위쪽이 화면 위
    for (let ix = 0; ix < g.nx; ix++) {
      const i = iz * g.nx + ix;
      let t: number;
      if (m === 'amp') t = (s * Math.sqrt(g.p2[i])) / P_SCALE;
      else if (m === 'potential') t = 0.5 + (0.5 * s2 * sc.potential.U[i]) / uScale;
      else t = 0.5 + (0.5 * s * (g.pRe[i] * c + g.pIm[i] * sn)) / P_SCALE;
      const li = Math.max(0, Math.min(255, (t * 255) | 0)) * 3;
      const o = (row * g.nx + ix) * 4;
      data[o] = lut[li];
      data[o + 1] = lut[li + 1];
      data[o + 2] = lut[li + 2];
      data[o + 3] = alpha;
    }
  }
}
