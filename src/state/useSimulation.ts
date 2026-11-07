/**
 * 2D/3D 페이지가 공유하는 시뮬레이션 상태 훅.
 * 변수, 음향장 계산(Web Worker + 디바운스), 보정, 장면(Scene), 공(simRef), 무게 늘리기, 공진 맞춤.
 * 공의 위치/속도는 React 상태가 아니라 simRef에 있고, 각 뷰의 requestAnimationFrame 루프에서 stepBall로 진행한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { DisplayMode } from '../components/heatmap';
import { makeMedium } from '../physics/acoustics';
import { calibrate } from '../physics/calibration';
import type { SimParams } from '../physics/params';
import { nearestPairResonance, nearestResonanceGapIn } from '../physics/resonance';
import { createBallSim, rebaseBallSim, type BallSim, type BallStatus } from '../sim/ballSim';
import type { FieldRequest, FieldResponse } from '../sim/field.worker';
import { buildField, fieldParamsOf, finishScene, type FieldData, type Scene } from '../sim/scene';
import { SLIDERS, type SliderDef } from './sliders';

/** 음향장 재계산 디바운스 [ms] (SPEC 5장: 100~200ms) */
const DEBOUNCE_MS = 150;

const D_SLIDER = SLIDERS.find((s) => s.key === 'd')!;

/** 뷰의 rAF 루프에서 한 프레임 공을 진행하고, 상태가 바뀌면 알린다 */
export function stepBall(
  simRef: MutableRefObject<BallSim | null>,
  realDt: number,
  timeScale: number,
  scene: Scene | null,
  last: { status: BallStatus | null },
  report: (s: BallStatus) => void,
): void {
  const sim = simRef.current;
  if (!sim) return;
  sim.advanceFrame(realDt, timeScale, scene ?? undefined);
  if (sim.status !== last.status) {
    last.status = sim.status;
    report(sim.status);
  }
}

export function useSimulation(makeDefaults: () => SimParams) {
  const [params, setParams] = useState<SimParams>(makeDefaults);
  const [fieldData, setFieldData] = useState<FieldData | null>(null);
  const [busy, setBusy] = useState(true);
  const [mode, setMode] = useState<DisplayMode>('amp');
  const [animate, setAnimate] = useState(true);
  const [showForces, setShowForces] = useState(false);
  const [status, setStatus] = useState<BallStatus>('moving');
  const [testing, setTesting] = useState(false);
  const [weightSpeed, setWeightSpeed] = useState(1);

  const simRef = useRef<BallSim | null>(null);
  const releaseNext = useRef(true);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const defaultsRef = useRef(makeDefaults);
  defaultsRef.current = makeDefaults;

  // Web Worker (음향장 계산). 만들 수 없거나 ?noworker면 메인 스레드에서 계산
  useEffect(() => {
    if (new URLSearchParams(location.search).has('noworker')) return;
    let w: Worker;
    try {
      w = new Worker(new URL('../sim/field.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return;
    }
    w.onmessage = (e: MessageEvent<FieldResponse>) => {
      if (e.data.id !== reqId.current) return; // 오래된 결과는 버림
      setFieldData(e.data.fd);
      setBusy(false);
    };
    w.onerror = (e) => {
      console.error('field worker 오류, 메인 스레드로 전환', e.message);
      workerRef.current = null;
      w.terminate();
    };
    workerRef.current = w;
    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, []);

  // 음향장 변수가 바뀌면 디바운스 후 Worker(없으면 메인 스레드)에서 계산
  const fpKey = JSON.stringify(fieldParamsOf(params));
  useEffect(() => {
    setBusy(true);
    const t = setTimeout(() => {
      const req: FieldRequest = { id: ++reqId.current, fp: JSON.parse(fpKey) };
      const w = workerRef.current;
      if (w) {
        w.postMessage(req);
      } else {
        setFieldData(buildField(req.fp));
        setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fpKey]);

  // 보정은 지향성·반사 모델 설정별로 한 번
  const cal = useMemo(() => calibrate(params.directivity, params.reflections), [params.directivity, params.reflections]);

  // 가벼운 2단계 (구동 세기, 공, 감쇠 등은 즉시 반영). 시간 배율은 장과 무관하므로 제외
  const { timeScale: _ts, ...physParams } = params;
  const physKey = JSON.stringify(physParams);
  const scene = useMemo(
    () => (fieldData ? finishScene(fieldData, { ...JSON.parse(physKey), timeScale: 0 } as SimParams, cal) : null),
    [fieldData, physKey, cal],
  );

  // 장이 바뀌면 공을 새 장으로 옮기거나 처음/리셋이면 새로 놓기
  useEffect(() => {
    if (!scene) return;
    if (releaseNext.current || !simRef.current) {
      simRef.current = createBallSim(scene);
      releaseNext.current = false;
      setTesting(false);
    } else {
      simRef.current = rebaseBallSim(simRef.current, scene);
    }
  }, [scene]);

  const onStatus = useCallback((s: BallStatus) => {
    setStatus(s);
    if (simRef.current?.test && !simRef.current.test.active) setTesting(false);
  }, []);

  const onChange = useCallback((key: SliderDef['key'], v: number) => {
    setParams((p) => ({ ...p, [key]: v }));
  }, []);

  const setFlag = useCallback((key: 'directivity' | 'travelingForce' | 'reflections', on: boolean) => {
    setParams((p) => ({ ...p, [key]: on }));
  }, []);

  const onRelease = useCallback(() => {
    if (scene) simRef.current = createBallSim(scene);
    setTesting(false);
  }, [scene]);

  const onWeightTest = useCallback(() => {
    if (!scene) return;
    const sim = simRef.current;
    if (testing) {
      sim?.stopWeightTest();
      setTesting(false);
      return;
    }
    // 떨어진 공이나 이미 무거워진 공이면 새로 놓고 시작
    const fresh = !sim || sim.status === 'falling' || sim.status === 'escaped' || sim.test !== null ? createBallSim(scene) : sim;
    fresh.startWeightTest(scene, weightSpeed);
    simRef.current = fresh;
    setTesting(true);
  }, [scene, testing, weightSpeed]);

  const onWeightSpeed = useCallback((s: number) => {
    setWeightSpeed(s);
    simRef.current?.setWeightSpeed(s); // 진행 중인 테스트에도 바로 적용
  }, []);

  const lambda = makeMedium(params.f, params.T).lambda;
  const onSnapResonance = useCallback(() => {
    setParams((p) => {
      const lam = makeMedium(p.f, p.T).lambda;
      const lo = D_SLIDER.fromUi(D_SLIDER.min);
      const hi = D_SLIDER.fromUi(D_SLIDER.max);
      // 반사파 직접 계산(3D)이면 두 발생기 구동 공진(위상 φ 반영), 아니면 SPEC의 λ/2 정수배
      const d = p.reflections ? nearestPairResonance(p.d, lam, Math.max(p.R, 0.05), p.phi, lo, hi) : nearestResonanceGapIn(p.d, lam, lo, hi);
      return { ...p, d };
    });
  }, []);

  const onReset = useCallback(() => {
    releaseNext.current = true;
    setParams(defaultsRef.current());
    // 표시 설정도 처음 상태로
    setMode('amp');
    setAnimate(true);
    setShowForces(false);
    setWeightSpeed(1);
  }, []);

  return {
    params,
    setFlag,
    onChange,
    scene,
    busy,
    simRef,
    status,
    onStatus,
    mode,
    setMode,
    animate,
    setAnimate,
    showForces,
    setShowForces,
    testing,
    onRelease,
    onReset,
    onWeightTest,
    weightSpeed,
    onWeightSpeed,
    onSnapResonance,
    halfWaves: params.d / (lambda / 2),
  };
}
