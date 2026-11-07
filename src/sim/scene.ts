/**
 * 음향장 캐시. 두 단계로 나눈다.
 *  1) buildField  (무거움, Web Worker에서 실행): 점음원 합으로 2D 격자와 축 위 1D 샘플 (s = 1 기준)
 *  2) finishScene (가벼움, 메인 스레드): 실제 세기 s, Gor'kov 퍼텐셜/힘 격자, A층 기준값, 수치
 * 구동 세기·공 크기·밀도·감쇠·R 변경은 2)만 다시 하면 되므로 즉시 반영된다. React 의존 없음.
 */
import { makeMedium, type Medium } from '../physics/acoustics';
import { sourceStrength, splFromAmplitude, type Calibration } from '../physics/calibration';
import { GRAVITY, SOURCE_SPACING_FRACTION } from '../physics/constants';
import {
  axisForce,
  axisMaxPressure,
  axisPotential,
  axisPressureNodes,
  computeAxisProfile,
  computeDomain,
  computeFieldGrid,
  computePotentialGrid,
  type AxisProfile,
  type Domain,
  type FieldGrid,
  type PotentialGrid,
} from '../physics/field2d';
import { makeParticle, maxForce, nodes1D, stiffness, type Particle } from '../physics/gorkov';
import { dampingCoeff, oscillationPeriod, timeStep } from '../physics/integrator';
import type { SimParams } from '../physics/params';
import { resonanceGain } from '../physics/resonance';
import { makeSourceSet, sampleDisc, type DiscSample, type SourceSet } from '../physics/sourceSampling';

/** 음향장(1단계)을 정하는 변수 */
export interface FieldParams {
  f: number;
  T: number;
  d: number;
  at: number;
  phi: number;
  directivity: boolean;
}

export function fieldParamsOf(p: SimParams): FieldParams {
  return { f: p.f, T: p.T, d: p.d, at: p.at, phi: p.phi, directivity: p.directivity };
}

export function sameFieldParams(a: FieldParams, b: FieldParams): boolean {
  return a.f === b.f && a.T === b.T && a.d === b.d && a.at === b.at && a.phi === b.phi && a.directivity === b.directivity;
}

/** 1단계 결과 (structured clone 가능한 순수 데이터) */
export interface FieldData {
  fp: FieldParams;
  med: Medium;
  domain: Domain;
  sources: SourceSet;
  field: FieldGrid;
  axis: AxisProfile;
  /** 장 계산 시간 [ms] */
  computeMs: number;
}

export interface Scene extends FieldData {
  /** 실제로 쓰인 변수 (d, f 등은 fp 기준) */
  params: SimParams;
  particle: Particle;
  potential: PotentialGrid;
  /** 실제 세기 s */
  s: number;
  /** 공진 이득 G(d) */
  gain: number;
  /** 실제 P0 = s·max|P_axis| [Pa] */
  P0: number;
  spl: number;
  /** A층 해석식(실제 P0)으로 구한 값 */
  Fmax: number;
  kappa: number;
  weight: number;
  Tosc: number;
  dt: number;
  cd: number;
  /** A층 마디 (계산 영역 안) */
  nodesA: number[];
  /** B층 축 위 압력 마디 */
  nodesB: number[];
  /** 축 위 U(z) [J], F_z(z) [N] (실제 세기, axis.z와 같은 샘플) */
  axisU: Float64Array;
  axisF: Float64Array;
}

/** 원판 샘플 재사용 (a_t, λ가 같으면 같은 좌표) */
let discCache: { key: string; disc: DiscSample } | null = null;

function getDisc(at: number, lambda: number): DiscSample {
  const key = `${at}|${lambda}`;
  if (!discCache || discCache.key !== key) {
    discCache = { key, disc: sampleDisc(at, lambda * SOURCE_SPACING_FRACTION) };
  }
  return discCache.disc;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function buildField(fp: FieldParams): FieldData {
  const t0 = now();
  const med = makeMedium(fp.f, fp.T);
  const domain = computeDomain(fp.d, med.lambda);
  const sources = makeSourceSet(getDisc(fp.at, med.lambda), fp.d, fp.phi);
  const field = computeFieldGrid(sources, med, domain, fp.directivity);
  const axis = computeAxisProfile(sources, med, domain.zMin, domain.zMax, fp.directivity);
  return { fp, med, domain, sources, field, axis, computeMs: now() - t0 };
}

export function finishScene(fd: FieldData, input: SimParams, cal: Calibration): Scene {
  const params: SimParams = { ...input, ...fd.fp };
  const med = fd.med;
  const particle = makeParticle(params.ballDiameter, params.rhoP, params.Kp, med);
  const potential = computePotentialGrid(fd.field, med, particle);
  const s = sourceStrength(cal, params.drive, params.d, params.R, med);
  const P0 = s * axisMaxPressure(fd.axis);
  const Fmax = maxForce(P0, med, particle);
  const kappa = stiffness(P0, med, particle);
  const axisU = axisPotential(fd.axis, med, particle, s * s);
  return {
    ...fd,
    params,
    particle,
    potential,
    s,
    gain: resonanceGain(params.d, med.k, params.R),
    P0,
    spl: splFromAmplitude(P0),
    Fmax,
    kappa,
    weight: particle.m * GRAVITY,
    Tosc: oscillationPeriod(particle.m, kappa),
    dt: timeStep(particle.m, kappa),
    cd: dampingCoeff(params.zeta, particle.m, kappa),
    nodesA: nodes1D(params.d, params.phi, med.lambda, fd.domain.zMin, fd.domain.zMax),
    nodesB: axisPressureNodes(fd.axis),
    axisU,
    axisF: axisForce(fd.axis.z, axisU),
  };
}

export function buildScene(params: SimParams, cal: Calibration): Scene {
  return finishScene(buildField(fieldParamsOf(params)), params, cal);
}
