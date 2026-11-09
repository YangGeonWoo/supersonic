/**
 * 3D 페이지의 GPU 3D 격자 모드 상태: GPU 장 계산(디바운스), 3D 장면, 3D 공, 무게 늘리기.
 * GPU를 쓸 수 없으면 supported = false (3D 페이지는 안내와 2D 링크만 보여준다).
 * 공의 위치·속도는 React 상태가 아니라 sim3Ref에 있고 View3D의 rAF 루프에서 진행한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GpuField } from '../gpu/fieldGpu';
import { compareWithCpu, type SelfTestResult } from '../gpu/selftest';
import { makeMedium } from '../physics/acoustics';
import { calibrate } from '../physics/calibration';
import { computeDomain3, fillMask, gridDims, type Grid3 } from '../physics/grid3';
import type { SimParams } from '../physics/params';
import type { BallStatus } from '../sim/ballSim';
import { createBallSim3, fieldLimitDensity3, maxUpwardForce3, nearestTrap3, rebaseBallSim3, type BallSim3 } from '../sim/ballSim3';
import { fieldParamsOf, makeSources } from '../sim/scene';
import { finishScene3 } from '../sim/scene3';

export type GridRes = 'low' | 'normal' | 'high';

/** 격자 간격 (파장 대비). SPEC 2D 격자는 λ/40 */
export const GRID_SPACING: Record<GridRes, number> = { low: 1 / 16, normal: 1 / 24, high: 1 / 40 };
export const GRID_LABEL: Record<GridRes, string> = { low: '낮음 λ/16', normal: '보통 λ/24', high: '높음 λ/40' };

const DEBOUNCE_MS = 150;

/** 휴대폰 등 터치 기기는 기본 해상도를 낮춤 */
export function defaultGridRes(): GridRes {
  if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return 'low';
  return 'normal';
}

export function useGpuSim(params: SimParams, res: GridRes) {
  const gpuRef = useRef<GpuField | null | undefined>(undefined);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [grid, setGrid] = useState<{ grid: Grid3; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<BallStatus>('moving');
  const [testing, setTesting] = useState(false);
  const [selftest, setSelftest] = useState<SelfTestResult | null>(null);
  const sim3Ref = useRef<BallSim3 | null>(null);
  const releaseNext = useRef(true);
  const reqId = useRef(0);

  // GPU 준비 (한 번)
  useEffect(() => {
    const g = GpuField.create();
    gpuRef.current = g;
    setSupported(!!g);
    return () => {
      g?.dispose();
      gpuRef.current = null;
    };
  }, []);

  // 장 변수·해상도가 바뀌면 디바운스 후 GPU 계산
  const fpKey = JSON.stringify({ ...fieldParamsOf(params), res });
  useEffect(() => {
    if (!supported) return;
    setBusy(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      const gpu = gpuRef.current;
      if (!gpu) return;
      const fp = JSON.parse(fpKey) as ReturnType<typeof fieldParamsOf> & { res: GridRes };
      try {
        const med = makeMedium(fp.f, fp.T);
        const pose = { tilt: fp.tilt, offset: fp.offset };
        const src = makeSources(fp, med.lambda);
        const g = gridDims(computeDomain3(fp.d, med.lambda, pose), med.lambda, GRID_SPACING[fp.res]);
        const r = await gpu.compute(src, med, g, fp.directivity);
        fillMask(r.grid, fp.d, med.lambda, pose);
        if (id !== reqId.current) return; // 오래된 결과
        setGrid({ grid: r.grid, ms: r.ms });
        setError(null);
        if (new URLSearchParams(location.search).has('selftest')) setSelftest(compareWithCpu(r.grid, src, med, fp.directivity, 300));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === reqId.current) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fpKey, supported]);

  const cal = useMemo(() => calibrate(params.directivity, params.reflections), [params.directivity, params.reflections]);

  // 가벼운 단계: 세기, 공 물성, 감쇠 → 장면 (시간 배율·놓는 방향은 제외)
  const { timeScale: _t, releaseAzimuth: _a, ...phys } = params;
  const physKey = JSON.stringify(phys);
  const scene3 = useMemo(
    () => (grid ? finishScene3(grid.grid, { ...(JSON.parse(physKey) as SimParams), timeScale: 0, releaseAzimuth: 0 }, cal, grid.ms, 'gpu') : null),
    [grid, physKey, cal],
  );

  const azimuth = params.releaseAzimuth;
  useEffect(() => {
    if (!scene3) return;
    if (releaseNext.current || !sim3Ref.current) {
      sim3Ref.current = createBallSim3(scene3, azimuth);
      releaseNext.current = false;
      setTesting(false);
    } else {
      sim3Ref.current = rebaseBallSim3(sim3Ref.current, scene3);
    }
    // azimuth는 '공 놓기'를 누를 때 반영
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene3]);

  const onStatus = useCallback((s: BallStatus) => {
    setStatus(s);
    if (sim3Ref.current?.test && !sim3Ref.current.test.active) setTesting(false);
  }, []);

  const onRelease = useCallback(() => {
    if (scene3) sim3Ref.current = createBallSim3(scene3, azimuth);
    setTesting(false);
  }, [scene3, azimuth]);

  const onWeightTest = useCallback(
    (speed: number) => {
      if (!scene3) return;
      const sim = sim3Ref.current;
      if (testing) {
        sim?.stopWeightTest();
        setTesting(false);
        return;
      }
      const fresh = !sim || sim.status === 'falling' || sim.status === 'escaped' || sim.test !== null ? createBallSim3(scene3, azimuth) : sim;
      fresh.startWeightTest(scene3, speed);
      sim3Ref.current = fresh;
      setTesting(true);
    },
    [scene3, testing, azimuth],
  );

  const onReset = useCallback(() => {
    releaseNext.current = true;
  }, []);

  /** 상태 칸에 쓸 한계 (공이 있는 덫, 3D 격자 기준) */
  const limitsFor = useCallback(
    (ball: { x: number; y?: number; z: number }, rhoP: number) => {
      if (!scene3) return null;
      const trap = nearestTrap3(scene3, { x: ball.x, y: ball.y ?? 0, z: ball.z });
      if (!trap) return null;
      const p = scene3.particle;
      return {
        rhoLimit: fieldLimitDensity3(scene3, trap),
        margin: maxUpwardForce3(scene3, trap, rhoP) / ((rhoP * p.V) * 9.81),
      };
    },
    [scene3],
  );

  return { supported, scene3, sim3Ref, busy, error, status, onStatus, testing, onRelease, onWeightTest, onReset, limitsFor, selftest };
}
