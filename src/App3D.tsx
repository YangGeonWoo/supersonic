import { useCallback, useState } from 'react';
import ControlPanel, { Slider } from './components/ControlPanel';
import Legend from './components/Legend';
import SideGraphs from './components/SideGraphs';
import SizeNote from './components/SizeNote';
import StatsPanel from './components/StatsPanel';
import type { GpuViewOptions, VolumeMode } from './components3d/gpuVisuals';
import LateralPanel from './components3d/LateralPanel';
import StiffnessPanel from './components3d/StiffnessPanel';
import View3D, { type View3DOptions } from './components3d/View3D';
import { defaultParams, type SimParams } from './physics/params';
import { AMP_RATIO_SLIDER, POSE_SLIDERS } from './state/sliders';
import { defaultGridRes, GRID_LABEL, useGpuSim, type GridRes } from './state/useGpuSim';
import { useSimulation } from './state/useSimulation';
import './index.css';

/** 3D 페이지 기본값: 2D와 같고 진행파 복사압(밀림)과 반사파 직접 계산을 켠다 */
export function default3DParams(): SimParams {
  return { ...defaultParams(), travelingForce: true, reflections: true };
}

const DEFAULT_VIEW: View3DOptions = { planes: true, opacity: 0.85, nodes: true };
const DEFAULT_GPU_VIEW: GpuViewOptions = {
  sliceXZ: true,
  sliceYZ: true,
  sliceXY: false,
  sliceZ: null,
  opacity: 0.85,
  volume: 'off',
  iso: 0.6,
  traps: true,
};

type ComputeMode = 'gpu' | 'cpu';

export default function App3D() {
  const sim = useSimulation(default3DParams);
  const { params, scene, simRef } = sim;
  const [view, setView] = useState<View3DOptions>(DEFAULT_VIEW);
  const [gview, setGview] = useState<GpuViewOptions>(DEFAULT_GPU_VIEW);
  const [mode, setMode] = useState<ComputeMode>(() => (new URLSearchParams(location.search).get('mode') === 'cpu' ? 'cpu' : 'gpu'));
  const [res, setRes] = useState<GridRes>(() => {
    const q = new URLSearchParams(location.search).get('res');
    return q === 'low' || q === 'normal' || q === 'high' ? q : defaultGridRes();
  });
  const gpu = useGpuSim(params, mode === 'gpu', res);
  const gpuOn = mode === 'gpu' && gpu.supported === true;
  const gpuReady = gpuOn && !!gpu.scene3;

  const [lateralUnstable, setLateralUnstable] = useState(false);
  const onStable = useCallback((ok: boolean) => setLateralUnstable(!ok), []);
  const { onReset: resetSim, onWeightSpeed: setSpeed2 } = sim;
  const { onReset: resetGpu } = gpu;
  // "모두 기본값으로": 시뮬레이션 변수와 함께 3D 표시 설정도 되돌린다
  const onReset = useCallback(() => {
    resetSim();
    resetGpu();
    setView(DEFAULT_VIEW);
    setGview(DEFAULT_GPU_VIEW);
  }, [resetSim, resetGpu]);
  const onWeightSpeed = useCallback(
    (s: number) => {
      setSpeed2(s);
      gpu.sim3Ref.current?.setWeightSpeed(s);
    },
    [setSpeed2, gpu.sim3Ref],
  );

  const ballRef = gpuReady ? gpu.sim3Ref : simRef;
  const L = gpu.scene3?.lateral;

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <h1>초음파 공중부양 3D</h1>
          <a className="page-link" href="./">
            ← 2D 단면으로
          </a>
        </div>
        <p>발생기, 정상파 마디, 공을 입체로 돌려 보며 축에서 벗어나는 방향(횡방향)의 안정성까지 확인합니다.</p>
      </header>
      <main className="layout">
        <ControlPanel
          params={params}
          onChange={sim.onChange}
          onDirectivity={(on) => sim.setFlag('directivity', on)}
          mode={sim.mode}
          onMode={sim.setMode}
          animate={sim.animate}
          onAnimate={sim.setAnimate}
          showForces={sim.showForces}
          onShowForces={sim.setShowForces}
          onSnapResonance={sim.onSnapResonance}
          halfWaves={sim.halfWaves}
          onRelease={gpuReady ? gpu.onRelease : sim.onRelease}
          onReset={onReset}
          testing={gpuReady ? gpu.testing : sim.testing}
          onWeightTest={gpuReady ? () => gpu.onWeightTest(sim.weightSpeed) : sim.onWeightTest}
          weightSpeed={sim.weightSpeed}
          onWeightSpeed={onWeightSpeed}
          forcesLabel="힘 화살표 (음향 방사력 + 중력 + 밀림)"
          extraCore={
            <>
              <fieldset className="compute-mode">
                <legend>계산 방식</legend>
                <label className="radio">
                  <input type="radio" name="cmode" checked={mode === 'gpu'} disabled={gpu.supported === false} onChange={() => setMode('gpu')} />
                  GPU 3D 격자{gpu.supported === false ? ' (이 기기는 지원 안 함)' : ''}
                </label>
                <label className="radio">
                  <input type="radio" name="cmode" checked={mode === 'cpu' || gpu.supported === false} onChange={() => setMode('cpu')} />
                  축대칭 (CPU)
                </label>
                {gpuOn && (
                  <label className="tool-select">
                    격자
                    <select value={res} onChange={(e) => setRes(e.target.value as GridRes)}>
                      {(Object.keys(GRID_LABEL) as GridRes[]).map((r) => (
                        <option key={r} value={r}>
                          {GRID_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </fieldset>
              <Slider s={AMP_RATIO_SLIDER} params={params} onChange={sim.onChange} />
              <fieldset disabled={!gpuOn} className="pose" title={gpuOn ? '' : 'GPU 3D 격자 모드에서만 (축대칭이 깨지는 조건)'}>
                {POSE_SLIDERS.map((s) => (
                  <Slider key={s.key} s={s} params={params} onChange={sim.onChange} />
                ))}
                {!gpuOn && <small className="pose-note">기울기·어긋남·놓는 방향은 GPU 3D 격자 모드에서만 씁니다.</small>}
              </fieldset>
              <label className="check">
                <input type="checkbox" checked={params.travelingForce} onChange={(e) => sim.setFlag('travelingForce', e.target.checked)} />
                진행파 복사압 (밀림)
              </label>
              <label className="check">
                <input type="checkbox" checked={params.reflections} onChange={(e) => sim.setFlag('reflections', e.target.checked)} />
                반사파 직접 계산 (거울상)
              </label>
            </>
          }
        />
        <section className="view">
          <SizeNote params={params} />
          {gpuOn && !gpuReady && <div className="size-note">GPU로 3D 격자를 계산하는 중… (그동안 축대칭 결과를 보여줍니다)</div>}
          <View3D
            scene={scene}
            simRef={simRef}
            mode={sim.mode}
            animate={sim.animate}
            showForces={sim.showForces}
            timeScale={params.timeScale}
            onStatus={sim.onStatus}
            options={view}
            gpu={gpuReady ? { scene3: gpu.scene3, sim3Ref: gpu.sim3Ref, onStatus3: gpu.onStatus, options: gview } : null}
          />
          {gpuReady ? (
            <div className="view3d-tools">
              <span className="tool-label">단면</span>
              {(
                [
                  ['sliceXZ', 'x-z'],
                  ['sliceYZ', 'y-z'],
                  ['sliceXY', 'x-y'],
                ] as const
              ).map(([k, lab]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={gview[k]} onChange={(e) => setGview((v) => ({ ...v, [k]: e.target.checked }))} />
                  {lab}
                </label>
              ))}
              <label className="tool-range">
                x-y 높이
                <input
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  disabled={!gview.sliceXY}
                  value={gview.sliceZ === null ? (gpu.scene3!.centralTrap?.z ?? params.d / 2) / params.d : gview.sliceZ / params.d}
                  onChange={(e) => setGview((v) => ({ ...v, sliceZ: Number(e.target.value) * params.d }))}
                />
              </label>
              <label className="tool-range">
                불투명도
                <input type="range" min={0.1} max={1} step={0.05} value={gview.opacity} onChange={(e) => setGview((v) => ({ ...v, opacity: Number(e.target.value) }))} />
              </label>
              <label className="tool-select">
                볼륨
                <select value={gview.volume} onChange={(e) => setGview((v) => ({ ...v, volume: e.target.value as VolumeMode }))}>
                  <option value="off">끔</option>
                  <option value="amp">압력 진폭 |P| (반투명)</option>
                  <option value="traps">덫 등치면 (U 저점)</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={gview.traps} onChange={(e) => setGview((v) => ({ ...v, traps: e.target.checked }))} />
                덫 표시
              </label>
              <span className="hint">드래그·방향키: 회전 · 휠·+/−: 확대 · 0: 처음 시점</span>
            </div>
          ) : (
            <div className="view3d-tools">
              <label className="check">
                <input type="checkbox" checked={view.planes} onChange={(e) => setView((v) => ({ ...v, planes: e.target.checked }))} />
                음압 단면 (x-z, y-z)
              </label>
              <label className="check">
                <input type="checkbox" checked={view.nodes} onChange={(e) => setView((v) => ({ ...v, nodes: e.target.checked }))} />
                마디 면
              </label>
              <label className="tool-range">
                단면 불투명도
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={view.opacity}
                  disabled={!view.planes}
                  onChange={(e) => setView((v) => ({ ...v, opacity: Number(e.target.value) }))}
                />
              </label>
              <span className="hint">드래그·방향키: 회전 · 휠·+/−: 확대 · 우클릭 드래그: 이동 · 0: 처음 시점</span>
            </div>
          )}
          {sim.showForces && (
            <p className="arrow-key">
              <span className="sw sw-acoustic" /> 음향 방사력(합계) <span className="sw sw-gravity" /> 중력
              {params.travelingForce && (
                <>
                  <span className="sw sw-push" /> 그중 밀림
                </>
              )}
            </p>
          )}
          <Legend mode={sim.mode} scene={scene} />
          <SideGraphs scene={scene} simRef={ballRef} />
        </section>
        <div className="side-col">
          <StatsPanel
            scene={scene}
            status={gpuReady ? gpu.status : sim.status}
            busy={sim.busy || (gpuOn && gpu.busy)}
            simRef={ballRef}
            lateralUnstable={gpuReady ? !!L && L.kMin <= 0 : lateralUnstable}
            limitsFor={gpuReady ? gpu.limitsFor : null}
          />
          {gpuOn ? (
            <StiffnessPanel scene3={gpu.scene3} sim3Ref={gpu.sim3Ref} busy={gpu.busy} error={gpu.error} res={res} selftest={gpu.selftest} />
          ) : (
            <LateralPanel scene={scene} simRef={simRef} onStable={onStable} />
          )}
        </div>
      </main>
      <footer>
        정량값이 아니라 경향을 보여주는 모델입니다. Gor’kov 근사는 공이 파장(약 8.6 mm)보다 충분히 작을 때(ka ≪ 1, 지름 약 1.4 mm
        이하)만 잘 맞고 기본 공 3 mm(ka ≈ 1.1)는 그 범위 밖입니다. 반사계수 R·감쇠비 ζ는 가정값입니다. 발생기 면에서 λ/8 이내는 계산하지
        않습니다. 진행파 복사압은 강체 구 가정으로 정상파 항에 단순히 더한 근사입니다. 반사파는 발생기 면을 무한 평면으로 보고 거울상
        점음원(5차까지)으로 더하므로 실제 원판보다 반사가 조금 크게 들어갑니다. 음향 유동, 비선형 효과는 다루지 않습니다.
        {gpuReady
          ? ' GPU 3D 격자 모드는 축대칭을 가정하지 않고 3차원 격자 전체를 계산하며, 격자 간격(보통 λ/24) 때문에 힘이 약 5% 작게 나올 수 있습니다. 아래 그래프와 음압·마디 수치는 축대칭(CPU) 계산의 x = y = 0 수직선 값입니다.'
          : ' 축대칭 모드는 x-z 단면 하나를 회전시켜 보여줍니다.'}
      </footer>
    </div>
  );
}
