/**
 * 슬라이더 정의: UI 단위(mm, kHz, °C, °)와 SI 사이 변환. SPEC 3장 표.
 */
import type { SimParams } from '../physics/params';

export type NumericKey = {
  [K in keyof SimParams]: SimParams[K] extends number ? K : never;
}[keyof SimParams];

export interface SliderDef {
  key: NumericKey;
  label: string;
  unit: string;
  /** UI 값 범위 */
  min: number;
  max: number;
  step: number;
  /** SI → UI */
  toUi: (v: number) => number;
  /** UI → SI */
  fromUi: (v: number) => number;
  digits: number;
  assumed?: boolean;
  /** 음향장 재계산이 필요한 변수 (디바운스 대상) */
  heavy?: boolean;
  group: '음향' | '공' | '시뮬레이션';
}

const id = (v: number) => v;
const mmIn = (v: number) => v * 1e3;
const mmOut = (v: number) => v / 1e3;

/** 3D 페이지 전용: 위 발생기 진폭비 (2D 화면에는 나오지 않음) */
export const AMP_RATIO_SLIDER: SliderDef = {
  key: 'ampRatio',
  label: '위 발생기 출력 (아래 대비)',
  unit: '×',
  min: 0,
  max: 1,
  step: 0.01,
  toUi: (v) => v,
  fromUi: (v) => v,
  digits: 2,
  heavy: true,
  group: '음향',
};

export const SLIDERS: SliderDef[] = [
  { key: 'f', label: '주파수 f', unit: 'kHz', min: 38, max: 42, step: 0.05, toUi: (v) => v / 1e3, fromUi: (v) => v * 1e3, digits: 2, heavy: true, group: '음향' },
  { key: 'T', label: '온도 T', unit: '°C', min: 0, max: 40, step: 0.5, toUi: id, fromUi: id, digits: 1, heavy: true, group: '음향' },
  { key: 'd', label: '발생기 간격 d', unit: 'mm', min: 10, max: 50, step: 0.05, toUi: mmIn, fromUi: mmOut, digits: 2, heavy: true, group: '음향' },
  { key: 'at', label: '발생기 반지름 a_t', unit: 'mm', min: 4, max: 10, step: 0.1, toUi: mmIn, fromUi: mmOut, digits: 1, heavy: true, group: '음향' },
  { key: 'phi', label: '위상차 φ', unit: '°', min: 0, max: 360, step: 1, toUi: (v) => (v * 180) / Math.PI, fromUi: (v) => (v * Math.PI) / 180, digits: 0, heavy: true, group: '음향' },
  { key: 'drive', label: '구동 세기', unit: '', min: 0, max: 2, step: 0.01, toUi: id, fromUi: id, digits: 2, group: '음향' },
  { key: 'R', label: '반사계수 R', unit: '', min: 0, max: 0.9, step: 0.01, toUi: id, fromUi: id, digits: 2, assumed: true, group: '음향' },
  { key: 'ballDiameter', label: '공 지름', unit: 'mm', min: 1, max: 6, step: 0.1, toUi: mmIn, fromUi: mmOut, digits: 1, group: '공' },
  { key: 'rhoP', label: '공 밀도 ρp', unit: 'kg/m³', min: 10, max: 60, step: 1, toUi: id, fromUi: id, digits: 0, group: '공' },
  { key: 'zeta', label: '감쇠비 ζ', unit: '', min: 0.01, max: 1, step: 0.01, toUi: id, fromUi: id, digits: 2, assumed: true, group: '시뮬레이션' },
  { key: 'timeScale', label: '시간 배율', unit: '×', min: 0.01, max: 1, step: 0.01, toUi: id, fromUi: id, digits: 2, group: '시뮬레이션' },
];
