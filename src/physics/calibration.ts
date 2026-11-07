/**
 * 구동 세기 보정 (SPEC 2.5).
 * 기본 조건에서 s = 1로 계산한 축 위 최대 |P|로 s_ref = P0_ref / max|P_axis|를 구하고 고정한다.
 * 실제 세기 s = drive · s_ref · G(d)/G(d_ref).
 */
import { makeMedium, type Medium } from './acoustics';
import {
  ASSUMED_P0_REF,
  DEFAULT_FREQUENCY,
  DEFAULT_TEMPERATURE,
  DEFAULT_TRANSDUCER_RADIUS,
  P_REF_SPL,
  SOURCE_SPACING_FRACTION,
} from './constants';
import { axisMaxPressure, computeAxisProfile, computeDomain } from './field2d';
import { defaultGap } from './params';
import { resonanceGain } from './resonance';
import { makeSourceSet, sampleDisc } from './sourceSampling';

export interface Calibration {
  /** 단위 면적당 기준 세기 */
  sRef: number;
  /** 기준 간격 [m] (기본 조건의 5·λ/2, 고정) */
  dRef: number;
  /** 보정 시 s = 1 축 위 최대 |P| */
  maxP1: number;
  /** 보정에 쓴 지향성 설정 */
  directivity: boolean;
}

export function calibrate(directivity: boolean): Calibration {
  const med = makeMedium(DEFAULT_FREQUENCY, DEFAULT_TEMPERATURE);
  const dRef = defaultGap();
  const disc = sampleDisc(DEFAULT_TRANSDUCER_RADIUS, med.lambda * SOURCE_SPACING_FRACTION);
  const src = makeSourceSet(disc, dRef, 0);
  const dom = computeDomain(dRef, med.lambda);
  const prof = computeAxisProfile(src, med, dom.zMin, dom.zMax, directivity);
  const maxP1 = axisMaxPressure(prof);
  return { sRef: ASSUMED_P0_REF / maxP1, dRef, maxP1, directivity };
}

/** s = drive · s_ref · G(d)/G(d_ref)  (G는 현재 k로 계산) */
export function sourceStrength(cal: Calibration, drive: number, d: number, R: number, med: Medium): number {
  return (drive * cal.sRef * resonanceGain(d, med.k, R)) / resonanceGain(cal.dRef, med.k, R);
}

/** SPL = 20·log10(P0/√2 / 20µPa) [dB] */
export function splFromAmplitude(P0: number): number {
  return 20 * Math.log10(P0 / Math.SQRT2 / P_REF_SPL);
}
