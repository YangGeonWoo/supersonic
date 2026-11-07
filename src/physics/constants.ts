/**
 * 물리 상수와 수치 설정. 내부 계산은 전부 SI 단위(m, kg, s, Pa, rad).
 */

/** 중력가속도 [m/s²] (고정) */
export const GRAVITY = 9.81;

/** SPL 기준 압력 [Pa] */
export const P_REF_SPL = 20e-6;

/** 대기압 [Pa] */
export const ATM_PRESSURE = 101325;

/** 건조 공기 기체상수 [J/(kg·K)] */
export const R_AIR = 287.05;

// ───────────── 가정값 (UI에 "가정값"으로 표시) ─────────────

/** 공진 이득 모델의 반사계수 R (가정값) */
export const ASSUMED_REFLECTION = 0.5;
/** 유효 감쇠비 ζ (가정값) */
export const ASSUMED_DAMPING_RATIO = 0.1;
/** 입자 체적탄성률 Kp [Pa] (가정값, f1 ≈ 1) */
export const ASSUMED_PARTICLE_BULK_MODULUS = 1e8;
/** 구동 세기 1.0일 때 기본 조건에서 축 위 정상파 배의 압력 진폭 [Pa] (가정값) */
export const ASSUMED_P0_REF = 1500;

// ───────────── 기본 조건 (보정 기준) ─────────────

export const DEFAULT_FREQUENCY = 40e3; // Hz
export const DEFAULT_TEMPERATURE = 20; // °C
export const DEFAULT_TRANSDUCER_RADIUS = 8e-3; // m
/** 기본 간격 = DEFAULT_HALF_WAVES · λ/2 */
/** 점음원 지향성 (1 + cosθ)/2 기본값. 실제 발생기에 가깝고, 면 근처 마디의 측면 불안정이 사라진다 (README 측면 안정성) */
export const DEFAULT_DIRECTIVITY = true;
export const DEFAULT_HALF_WAVES = 5;

// ───────────── 수치 설정 ─────────────

/** 점음원 간격 상한 = λ/4 */
export const SOURCE_SPACING_FRACTION = 1 / 4;
/** 2차 이상 거울상 점음원 간격 (계산 영역에서 2d 이상 떨어져 있어 거칠게 둬도 됨) */
export const FAR_IMAGE_SPACING_FRACTION = 1 / 2;
/** 2D 격자 간격 상한 = λ/40 */
export const GRID_SPACING_FRACTION = 1 / 40;
/** 축 위 1D 샘플 간격 상한 = λ/200 */
export const AXIS_SPACING_FRACTION = 1 / 200;
/** 면에서 제외하는 거리 = λ/8 */
export const FACE_MARGIN_FRACTION = 1 / 8;
/** 계산 영역 x 반폭 [m] */
export const DOMAIN_HALF_WIDTH = 12e-3;

/** 진동 한 주기당 적분 단계 수 */
export const STEPS_PER_PERIOD = 50;
/** dt 상한 [s] */
export const DT_MAX = 2e-4;
/** c_d 계산에 쓰는 κ 하한 [N/m] */
export const KAPPA_MIN = 1e-6;
/** 화면 한 프레임당 적분 단계 상한 */
export const MAX_STEPS_PER_FRAME = 200;

// ───────────── 상태 판정 ─────────────

/** 부양 판정: 이 시간(T_osc 배수) 동안 조용해야 함 */
export const LEVITATION_WINDOW_PERIODS = 5;
/** 부양 판정 속도 기준 [m/s] */
export const LEVITATION_SPEED_TOL = 1e-3;
/** 부양 판정 위치 변화 기준 [m] */
export const LEVITATION_POSITION_TOL = 0.05e-3;

// ───────────── 공 놓기 ─────────────

export const RELEASE_OFFSET_X = 0.5e-3;
export const RELEASE_OFFSET_Z = 0.5e-3;
