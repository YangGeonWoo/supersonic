import { useCallback, useState } from 'react';
import ControlPanel, { Slider } from './components/ControlPanel';
import SizeNote from './components/SizeNote';
import Legend from './components/Legend';
import SideGraphs from './components/SideGraphs';
import LateralPanel from './components3d/LateralPanel';
import View3D, { type View3DOptions } from './components3d/View3D';
import StatsPanel from './components/StatsPanel';
import { defaultParams, type SimParams } from './physics/params';
import { AMP_RATIO_SLIDER } from './state/sliders';
import { useSimulation } from './state/useSimulation';
import './index.css';

/** 3D 페이지 기본값: 2D와 같고 진행파 복사압(밀림)만 켠다 */
export function default3DParams(): SimParams {
  return { ...defaultParams(), travelingForce: true };
}

const DEFAULT_VIEW: View3DOptions = { planes: true, opacity: 0.85, nodes: true };

export default function App3D() {
  const sim = useSimulation(default3DParams);
  const { params, scene, simRef } = sim;
  const [view, setView] = useState<View3DOptions>(DEFAULT_VIEW);
  const [lateralUnstable, setLateralUnstable] = useState(false);
  const onStable = useCallback((ok: boolean) => setLateralUnstable(!ok), []);
  const { onReset: resetSim } = sim;
  // "모두 기본값으로": 시뮬레이션 변수와 함께 3D 표시 설정도 되돌린다
  const onReset = useCallback(() => {
    resetSim();
    setView(DEFAULT_VIEW);
  }, [resetSim]);

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
          onRelease={sim.onRelease}
          onReset={onReset}
          testing={sim.testing}
          onWeightTest={sim.onWeightTest}
          weightSpeed={sim.weightSpeed}
          onWeightSpeed={sim.onWeightSpeed}
          forcesLabel="힘 화살표 (음향 방사력 + 중력 + 밀림)"
          extraCore={
            <>
              <Slider s={AMP_RATIO_SLIDER} params={params} onChange={sim.onChange} />
              <label className="check">
                <input type="checkbox" checked={params.travelingForce} onChange={(e) => sim.setFlag('travelingForce', e.target.checked)} />
                진행파 복사압 (밀림)
              </label>
            </>
          }
        />
        <section className="view">
          <SizeNote params={params} />
          <View3D
            scene={scene}
            simRef={simRef}
            mode={sim.mode}
            animate={sim.animate}
            showForces={sim.showForces}
            timeScale={params.timeScale}
            onStatus={sim.onStatus}
            options={view}
          />
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
            <span className="hint">드래그: 회전 · 휠: 확대 · 우클릭 드래그: 이동</span>
          </div>
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
          <SideGraphs scene={scene} simRef={simRef} />
        </section>
        <div className="side-col">
          <StatsPanel scene={scene} status={sim.status} busy={sim.busy} simRef={simRef} lateralUnstable={lateralUnstable} />
          <LateralPanel scene={scene} simRef={simRef} onStable={onStable} />
        </div>
      </main>
      <footer>
        정량값이 아니라 경향을 보여주는 모델입니다. Gor’kov 근사는 공이 파장(약 8.6 mm)보다 충분히 작을 때(ka ≪ 1, 지름 약 1.4 mm
        이하)만 잘 맞고 기본 공 3 mm(ka ≈ 1.1)는 그 범위 밖입니다. 반사계수 R·감쇠비 ζ는 가정값입니다. 발생기 면에서 λ/8 이내는 계산하지 않습니다. 진행파 복사압은 강체 구 가정으로
        정상파 항에 단순히 더한 근사입니다. 음향 유동, 비선형 효과, 발생기 기울어짐·어긋남은 다루지 않습니다. 장은 축대칭이라 x-z
        단면 하나를 회전시켜 보여줍니다.
      </footer>
    </div>
  );
}
