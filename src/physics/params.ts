import {
  ASSUMED_DAMPING_RATIO,
  ASSUMED_PARTICLE_BULK_MODULUS,
  ASSUMED_REFLECTION,
  DEFAULT_DIRECTIVITY,
  DEFAULT_FREQUENCY,
  DEFAULT_HALF_WAVES,
  DEFAULT_TEMPERATURE,
  DEFAULT_TRANSDUCER_RADIUS,
} from './constants';
import { makeMedium } from './acoustics';

/** 시뮬레이션 입력 변수 (전부 SI, 각도는 rad) */
export interface SimParams {
  /** 주파수 [Hz] */
  f: number;
  /** 온도 [°C] */
  T: number;
  /** 발생기 간격 [m] */
  d: number;
  /** 발생기 반지름 [m] */
  at: number;
  /** 위 발생기 위상차 [rad] */
  phi: number;
  /** 구동 세기 (무차원, 1.0 = 기준) */
  drive: number;
  /** 반사계수 (가정값) */
  R: number;
  /** 공 지름 [m] */
  ballDiameter: number;
  /** 공 밀도 [kg/m³] */
  rhoP: number;
  /** 입자 체적탄성률 [Pa] (가정값) */
  Kp: number;
  /** 감쇠비 (가정값) */
  zeta: number;
  /** 시간 배율 */
  timeScale: number;
  /** 점음원 지향성 (1 + cosθ)/2 사용 여부 */
  directivity: boolean;
  /** 위 발생기 진폭 / 아래 발생기 진폭 (1 = 같은 신호). 3D 페이지에서만 조절 */
  ampRatio: number;
  /** 진행파 복사압(밀림) 항을 힘에 더할지. 2D 페이지는 항상 false */
  travelingForce: boolean;
  /**
   * 상대 발생기 면의 반사를 거울상 점음원으로 직접 계산할지 (3D 페이지 기본 true, 2D는 false).
   * false면 SPEC 2.3의 공진 이득 배율 G(d)를 쓴다.
   */
  reflections: boolean;
}

/** 기본 조건의 간격 d = 5·λ/2 [m] */
export function defaultGap(): number {
  return (DEFAULT_HALF_WAVES * makeMedium(DEFAULT_FREQUENCY, DEFAULT_TEMPERATURE).lambda) / 2;
}

export function defaultParams(): SimParams {
  return {
    f: DEFAULT_FREQUENCY,
    T: DEFAULT_TEMPERATURE,
    d: defaultGap(),
    at: DEFAULT_TRANSDUCER_RADIUS,
    phi: 0,
    drive: 1,
    R: ASSUMED_REFLECTION,
    ballDiameter: 3e-3,
    rhoP: 25,
    Kp: ASSUMED_PARTICLE_BULK_MODULUS,
    zeta: ASSUMED_DAMPING_RATIO,
    timeScale: 0.05,
    directivity: DEFAULT_DIRECTIVITY,
    ampRatio: 1,
    travelingForce: false,
    reflections: false,
  };
}
