/**
 * 음향장 캐시. 두 단계로 나눈다.
 *  1) buildField  (무거움, Web Worker에서 실행): 점음원 합으로 2D 격자와 축 위 1D 샘플 (s = 1 기준)
 *  2) finishScene (가벼움, 메인 스레드): 실제 세기 s, Gor'kov 퍼텐셜/힘 격자, A층 기준값, 수치
 * 구동 세기·공 크기·밀도·감쇠·R 변경은 2)만 다시 하면 되므로 즉시 반영된다. React 의존 없음.
 */
import { makeMedium, type Medium } from '../physics/acoustics';
import { sourceStrength, splFromAmplitude, type Calibration } from '../physics/calibration';
import { FAR_IMAGE_SPACING_FRACTION, GRAVITY, SOURCE_SPACING_FRACTION } from '../physics/constants';
import {
  axisForce,
  axisMaxPressure,
  axisPotential,
  axisPressureNodes,
  findLocalMinima,
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
import { drivenPairGain, resonanceGain } from '../physics/resonance';
import { pushCoefficient, radiationForceFunction } from '../physics/scattering';
import { lateralStability } from '../physics/lateral';
import {
  makeSourceSet,
  reflectionOrders,
  sampleDisc,
  withReflections,
  type DiscSample,
  type SourceSet,
} from '../physics/sourceSampling';

/** 음향장(1단계)을 정하는 변수 */
export interface FieldParams {
  f: number;
  T: number;
  d: number;
  at: number;
  phi: number;
  directivity: boolean;
  /** 위 발생기 진폭비 */
  ampRatio: number;
  /** 거울상 반사의 반사계수 (0이면 거울상 없음 → G(d) 배율 모델) */
  imageR: number;
  /** 위 발생기 기울기 [rad], 어긋남 [m] */
  tilt: number;
  offset: number;
}

export function fieldParamsOf(p: SimParams): FieldParams {
  return { f: p.f, T: p.T, d: p.d, at: p.at, phi: p.phi, directivity: p.directivity, ampRatio: p.ampRatio, imageR: p.reflections ? p.R : 0, tilt: p.tilt, offset: p.offset };
}

export function sameFieldParams(a: FieldParams, b: FieldParams): boolean {
  return a.f === b.f && a.T === b.T && a.d === b.d && a.at === b.at && a.phi === b.phi && a.directivity === b.directivity && a.ampRatio === b.ampRatio && a.imageR === b.imageR && a.tilt === b.tilt && a.offset === b.offset;
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
  /** 진행파 복사압 함수 Y_p(ka) (강체 구) */
  Yp: number;
  /** 진행파 복사압 계수 Y_p·π a²/c (travelingForce가 꺼져 있으면 0) */
  pushCoeff: number;
  /** 축 위 밀림 힘 F_z,push [N] */
  axisFpush: Float64Array;
  /** 축 위 F_z 합계 = axisF + axisFpush [N] */
  axisFz: Float64Array;
  /**
   * 가운데 덫의 횡방향 강성 κ_ρ / A층 κ (옆 방향 감쇠 계수용 비율).
   * 옆 방향 감쇠 c_dx = 2ζ·√(m·|ratio|·κ_A) — 유효 감쇠비 ζ를 위아래와 옆에 같게 준다 (가정값).
   */
  lateralRatio: number;
  /** 옆 방향 감쇠 계수 [kg/s] */
  cdx: number;
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

/** 장 변수로 점음원(거울상 포함) 만들기 — CPU 장 계산과 GPU 장 계산이 같은 점음원을 쓴다 */
export function makeSources(fp: FieldParams, lambda: number): SourceSet {
  const pose = { tilt: fp.tilt ?? 0, offset: fp.offset ?? 0 };
  let sources = makeSourceSet(getDisc(fp.at, lambda), fp.d, fp.phi, fp.ampRatio, pose);
  if (fp.imageR > 0) {
    const far = makeSourceSet(sampleDisc(fp.at, lambda * FAR_IMAGE_SPACING_FRACTION), fp.d, fp.phi, fp.ampRatio, pose);
    sources = withReflections(sources, far, fp.d, fp.imageR, reflectionOrders(fp.imageR), pose);
  }
  return sources;
}

export function buildField(fp: FieldParams): FieldData {
  const t0 = now();
  const med = makeMedium(fp.f, fp.T);
  const domain = computeDomain(fp.d, med.lambda);
  const sources = makeSources(fp, med.lambda);
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
  const axisF = axisForce(fd.axis.z, axisU);
  const Yp = radiationForceFunction(med.k * particle.a);
  const pushCoeff = params.travelingForce ? pushCoefficient(particle.a, med.k, med.c) : 0;
  const axisFpush = new Float64Array(axisF.length);
  const axisFz = new Float64Array(axisF.length);
  for (let i = 0; i < axisF.length; i++) {
    axisFpush[i] = pushCoeff * s * s * fd.axis.Iz[i];
    axisFz[i] = axisF[i] + axisFpush[i];
  }
  // 가운데 덫(d/2에 가장 가까운 U 최소)의 횡방향 강성
  const mins = findLocalMinima(fd.axis.z, axisU).map((m) => m.z);
  let lateralRatio = 0.05; // 덫이 없을 때의 기본값 (가운데 덫 결과의 전형값)
  if (mins.length > 0 && kappa > 0) {
    const zc = mins.reduce((a, b) => (Math.abs(b - params.d / 2) < Math.abs(a - params.d / 2) ? b : a));
    const lat = lateralStability(fd.sources, med, particle, s * s, zc, fd.axis.z, axisFz, params.directivity, pushCoeff, 4e-3);
    if (Math.abs(lat.kappaRho) > 0) lateralRatio = Math.abs(lat.kappaRho) / kappa;
  }
  return {
    ...fd,
    lateralRatio,
    cdx: dampingCoeff(params.zeta, particle.m, lateralRatio * kappa),
    params,
    particle,
    potential,
    s,
    gain: params.reflections ? drivenPairGain(params.d, med.k, params.R, params.phi) : resonanceGain(params.d, med.k, params.R),
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
    axisF,
    Yp,
    pushCoeff,
    axisFpush,
    axisFz,
  };
}

export function buildScene(params: SimParams, cal: Calibration): Scene {
  return finishScene(buildField(fieldParamsOf(params)), params, cal);
}
