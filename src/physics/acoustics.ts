import { ATM_PRESSURE, R_AIR } from './constants';

/** 매질(공기)과 주파수로 정해지는 값 묶음 */
export interface Medium {
  /** 주파수 [Hz] */
  f: number;
  /** 온도 [°C] */
  T: number;
  /** 음속 [m/s] */
  c: number;
  /** 공기 밀도 [kg/m³] */
  rho0: number;
  /** 파장 [m] */
  lambda: number;
  /** 파수 [rad/m] */
  k: number;
  /** 각주파수 [rad/s] */
  omega: number;
  /** 공기 체적탄성률 K0 = ρ0·c² [Pa] */
  K0: number;
}

/** c = 331.3 + 0.606·T [m/s], T in °C */
export function soundSpeed(T: number): number {
  return 331.3 + 0.606 * T;
}

/** ρ0 = 101325 / (287.05·(T + 273.15)) [kg/m³] */
export function airDensity(T: number): number {
  return ATM_PRESSURE / (R_AIR * (T + 273.15));
}

export function makeMedium(f: number, T: number): Medium {
  const c = soundSpeed(T);
  const rho0 = airDensity(T);
  const lambda = c / f;
  return {
    f,
    T,
    c,
    rho0,
    lambda,
    k: (2 * Math.PI) / lambda,
    omega: 2 * Math.PI * f,
    K0: rho0 * c * c,
  };
}
