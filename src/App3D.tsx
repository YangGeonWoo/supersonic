import { useCallback, useState } from 'react';
import ControlPanel, { Slider } from './components/ControlPanel';
import Legend from './components/Legend';
import SideGraphs from './components/SideGraphs';
import SizeNote from './components/SizeNote';
import StatsPanel from './components/StatsPanel';
import type { DisplayMode } from './components/heatmap';
import type { FieldStyle, GpuViewOptions } from './components3d/gpuVisuals';
import StiffnessPanel from './components3d/StiffnessPanel';
import View3D from './components3d/View3D';
import { defaultParams, type SimParams } from './physics/params';
import { AMP_RATIO_SLIDER, POSE_SLIDERS } from './state/sliders';
import { defaultGridRes, GRID_LABEL, useGpuSim, type GridRes } from './state/useGpuSim';
import { useSimulation } from './state/useSimulation';
import './index.css';

/** 3D 페이지 기본값: 2D와 같고 진행파 복사압(밀림)과 반사파 직접 계산을 켠다 */
export function default3DParams(): SimParams {
  return { ...defaultParams(), travelingForce: true, reflections: true };
}

/** 3D 장 표시 기본값: 압력장을 볼륨으로 켠 상태 */
const DEFAULT_GPU_VIEW: GpuViewOptions = { style: 'volume', level: 0.5, density: 1, cut: false, traps: true };

/** 기준값 슬라이더 이름 (표시 모드별) */
const LEVEL_LABEL: Record<DisplayMode, string> = { amp: '|P| 기준', potential: '덫 깊이 (U 저점)', instant: '±Re P 기준' };

export default function App3D() {
  const sim = useSimulation(default3DParams);
  const { params, scene } = sim;
  const [gview, setGview] = useState<GpuViewOptions>(DEFAULT_GPU_VIEW);
  const [res, setRes] = useState<GridRes>(() => {
    const q = new URLSearchParams(location.search).get('res');
    return q === 'low' || q === 'normal' || q === 'high' ? q : defaultGridRes();
  });
  const gpu = useGpuSim(params, res);
  const gpuReady = !!gpu.scene3;

  const { onReset: resetSim, onWeightSpeed: setSpeed2 } = sim;
  const { onReset: resetGpu } = gpu;
  // "모두 기본값으로": 시뮬레이션 변수와 함께 3D 표시 설정도 되돌린다
  const onReset = useCallback(() => {
    resetSim();
    resetGpu();
    setGview(DEFAULT_GPU_VIEW);
  }, [resetSim, resetGpu]);
  const onWeightSpeed = useCallback(
    (s: number) => {
      setSpeed2(s);
      gpu.sim3Ref.current?.setWeightSpeed(s);
    },
    [setSpeed2, gpu.sim3Ref],
  );

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
          onRelease={gpu.onRelease}
          onReset={onReset}
          testing={gpu.testing}
          onWeightTest={() => gpu.onWeightTest(sim.weightSpeed)}
          weightSpeed={sim.weightSpeed}
          onWeightSpeed={onWeightSpeed}
          forcesLabel="힘 화살표 (음향 방사력 + 중력 + 밀림)"
          extraCore={
            <>
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
              <Slider s={AMP_RATIO_SLIDER} params={params} onChange={sim.onChange} />
              <fieldset className="pose">
                {POSE_SLIDERS.map((s) => (
                  <Slider key={s.key} s={s} params={params} onChange={sim.onChange} />
                ))}
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
          {gpu.supported === false ? (
            <div className="size-note gpu-missing">
              이 기기(브라우저)는 GPU 3D 계산에 필요한 WebGL2 실수 텍스처 렌더링을 지원하지 않습니다.{' '}
              <a href="./">2D 페이지</a>를 이용해 주세요.
            </div>
          ) : (
            <>
              {!gpuReady && <div className="size-note">GPU로 3D 격자를 계산하는 중…</div>}
              <View3D
                scene3={gpu.scene3}
                sim3Ref={gpu.sim3Ref}
                onStatus={gpu.onStatus}
                options={gview}
                mode={sim.mode}
                animate={sim.animate}
                showForces={sim.showForces}
                timeScale={params.timeScale}
                d={params.d}
                at={params.at}
              />
              <div className="view3d-tools">
                <label className="tool-select">
                  값
                  <select value={sim.mode} onChange={(e) => sim.setMode(e.target.value as DisplayMode)}>
                    <option value="amp">압력 진폭 |P|</option>
                    <option value="instant">순간 압력 Re P(t)</option>
                    <option value="potential">퍼텐셜 U (덫)</option>
                  </select>
                </label>
                <label className="tool-select">
                  표현
                  <select value={gview.style} onChange={(e) => setGview((v) => ({ ...v, style: e.target.value as FieldStyle }))}>
                    <option value="volume">볼륨 (반투명)</option>
                    <option value="iso">등치면</option>
                  </select>
                </label>
                <label className="tool-range">
                  {LEVEL_LABEL[sim.mode]}
                  <input type="range" min={0.05} max={0.95} step={0.01} value={gview.level} onChange={(e) => setGview((v) => ({ ...v, level: Number(e.target.value) }))} />
                </label>
                <label className="tool-range">
                  진하기
                  <input
                    type="range"
                    min={0.2}
                    max={4}
                    step={0.1}
                    value={gview.density}
                    disabled={gview.style !== 'volume'}
                    onChange={(e) => setGview((v) => ({ ...v, density: Number(e.target.value) }))}
                  />
                </label>
                <label className="check">
                  <input type="checkbox" checked={gview.cut} onChange={(e) => setGview((v) => ({ ...v, cut: e.target.checked }))} />
                  절반 자르기
                </label>
                <label className="check">
                  <input type="checkbox" checked={gview.traps} onChange={(e) => setGview((v) => ({ ...v, traps: e.target.checked }))} />
                  덫 표시
                </label>
                <span className="hint">드래그·방향키: 회전 · 휠·+/−: 확대 · 0: 처음 시점</span>
              </div>
            </>
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
          <SideGraphs scene={scene} simRef={gpu.sim3Ref} />
        </section>
        <div className="side-col">
          <StatsPanel
            scene={scene}
            status={gpu.status}
            busy={sim.busy || gpu.busy}
            simRef={gpu.sim3Ref}
            lateralUnstable={!!L && L.kMin <= 0}
            limitsFor={gpuReady ? gpu.limitsFor : null}
          />
          {gpu.supported !== false && (
            <StiffnessPanel scene3={gpu.scene3} sim3Ref={gpu.sim3Ref} busy={gpu.busy} error={gpu.error} res={res} selftest={gpu.selftest} />
          )}
        </div>
      </main>
      <footer>
        정량값이 아니라 경향을 보여주는 모델입니다. Gor’kov 근사는 공이 파장(약 8.6 mm)보다 충분히 작을 때(ka ≪ 1, 지름 약 1.4 mm
        이하)만 잘 맞고 기본 공 3 mm(ka ≈ 1.1)는 그 범위 밖입니다. 반사계수 R·감쇠비 ζ는 가정값입니다. 발생기 면에서 λ/8 이내는 계산하지
        않습니다. 진행파 복사압은 강체 구 가정으로 정상파 항에 단순히 더한 근사입니다. 반사파는 발생기 면을 무한 평면으로 보고 거울상
        점음원(5차까지)으로 더하므로 실제 원판보다 반사가 조금 크게 들어갑니다. 음향 유동, 비선형 효과는 다루지 않습니다.
        {' '}3D 페이지는 축대칭을 가정하지 않고 GPU로 3차원 격자 전체를 계산하며, 격자 간격(보통 λ/24) 때문에 힘이 약 5% 작게 나올 수
        있습니다. 아래 그래프와 음압·마디 수치는 축대칭 계산의 x = y = 0 수직선 값을 참고로 보여줍니다.
      </footer>
    </div>
  );
}
