import { makeMedium } from '../src/physics/acoustics';
import { GRAVITY } from '../src/physics/constants';
import { force1D, makeParticle, potential1D, type Particle } from '../src/physics/gorkov';
import type { Dynamics } from '../src/physics/integrator';
import { defaultParams } from '../src/physics/params';

/** SPEC 6장 검증의 기준 모델: 지향성 없는 점음원 (앱 기본값은 지향성 on, tests/m7_defaults 참고) */
export const base = { ...defaultParams(), directivity: false };
export const med = makeMedium(base.f, base.T);
export const particle: Particle = makeParticle(base.ballDiameter, base.rhoP, base.Kp, med);
export const weight = particle.m * GRAVITY;

/** A층 해석적 힘으로 만든 동역학 (x 방향 힘 0) */
export function dynamicsA(opts: {
  P0: number;
  d?: number;
  phi?: number;
  cd?: number;
  g?: number;
  walls?: boolean;
}): Dynamics {
  const d = opts.d ?? base.d;
  const phi = opts.phi ?? 0;
  const walls = opts.walls ?? false;
  return {
    m: particle.m,
    cd: opts.cd ?? 0,
    g: opts.g ?? 0,
    zMin: walls ? particle.a : -Infinity,
    zMax: walls ? d - particle.a : Infinity,
    force: (_x, z, out) => {
      out.fx = 0;
      out.fz = force1D(z, opts.P0, d, phi, med, particle);
    },
  };
}

export function potentialA(P0: number, d = base.d, phi = 0) {
  return (_x: number, z: number) => potential1D(z, P0, d, phi, med, particle);
}

export const mm = (v: number) => (v * 1e3).toFixed(4) + ' mm';
