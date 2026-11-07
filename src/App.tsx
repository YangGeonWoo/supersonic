import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from './components/ControlPanel';
import FieldView, { type DisplayMode } from './components/FieldView';
import Legend from './components/Legend';
import SideGraphs from './components/SideGraphs';
import StatsPanel from './components/StatsPanel';
import { makeMedium } from './physics/acoustics';
import { calibrate } from './physics/calibration';
import { nearestResonanceGapIn } from './physics/resonance';
import { defaultParams, type SimParams } from './physics/params';
import { createBallSim, rebaseBallSim, type BallSim, type BallStatus } from './sim/ballSim';
import type { FieldRequest, FieldResponse } from './sim/field.worker';
import { buildField, fieldParamsOf, finishScene, type FieldData } from './sim/scene';
import { SLIDERS, type SliderDef } from './state/sliders';
import './index.css';

/** 음향장 재계산 디바운스 [ms] (SPEC 5장: 100~200ms) */
const DEBOUNCE_MS = 150;

const D_SLIDER = SLIDERS.find((s) => s.key === 'd')!;

export default function App() {
  const [params, setParams] = useState<SimParams>(defaultParams);
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

  // Web Worker (음향장 계산). 만들 수 없거나 ?noworker면 메인 스레드에서 계산
  useEffect(() => {
    if (new URLSearchParams(location.search).has('noworker')) return;
    let w: Worker;
    try {
      w = new Worker(new URL('./sim/field.worker.ts', import.meta.url), { type: 'module' });
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

  // 보정은 지향성 설정별로 한 번
  const cal = useMemo(() => calibrate(params.directivity), [params.directivity]);

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
      return { ...p, d: nearestResonanceGapIn(p.d, lam, D_SLIDER.fromUi(D_SLIDER.min), D_SLIDER.fromUi(D_SLIDER.max)) };
    });
  }, []);

  const onReset = useCallback(() => {
    releaseNext.current = true;
    setParams(defaultParams());
    setMode('amp');
  }, []);

  return (
    <div className="app">
      <header>
        <h1>초음파 공중부양</h1>
        <p>위아래 초음파 발생기 사이의 정상파가 스티로폼 공을 붙잡습니다. "무게 늘리기"로 공이 얼마나 무거워질 때까지 버티는지 확인해 보세요.</p>
      </header>
      <main className="layout">
        <ControlPanel
          params={params}
          onChange={onChange}
          onDirectivity={(on) => setParams((p) => ({ ...p, directivity: on }))}
          mode={mode}
          onMode={setMode}
          animate={animate}
          onAnimate={setAnimate}
          showForces={showForces}
          onShowForces={setShowForces}
          onSnapResonance={onSnapResonance}
          halfWaves={params.d / (lambda / 2)}
          onRelease={onRelease}
          onReset={onReset}
          testing={testing}
          onWeightTest={onWeightTest}
          weightSpeed={weightSpeed}
          onWeightSpeed={onWeightSpeed}
        />
        <section className="view">
          <FieldView scene={scene} simRef={simRef} mode={mode} animate={animate} showForces={showForces} timeScale={params.timeScale} onStatus={onStatus} />
          <Legend mode={mode} scene={scene} />
          <SideGraphs scene={scene} simRef={simRef} />
        </section>
        <StatsPanel scene={scene} status={status} busy={busy} simRef={simRef} />
      </main>
      <footer>
        정량값이 아니라 경향을 보여주는 모델입니다 (Gor’kov 근사, x-z 단면, 공 운동은 느리게 재생). 발생기 면에서 λ/8 이내는 계산하지
        않습니다(회색). 점음원 지향성을 끄면, 면에 가까운 마디는 발생기가 클 때 축 위에서 옆으로 불안정해 공이 축에서 조금 벗어난 곳에
        머물 수 있습니다.
      </footer>
    </div>
  );
}
