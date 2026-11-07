import { useState } from 'react';
import ControlPanel from './components/ControlPanel';
import Legend from './components/Legend';
import SideGraphs from './components/SideGraphs';
import View3D, { type View3DOptions } from './components3d/View3D';
import StatsPanel from './components/StatsPanel';
import { defaultParams, type SimParams } from './physics/params';
import { useSimulation } from './state/useSimulation';
import './index.css';

/** 3D 페이지 기본값: 2D와 같고 진행파 복사압(밀림)만 켠다 */
export function default3DParams(): SimParams {
  return { ...defaultParams(), travelingForce: true };
}

export default function App3D() {
  const sim = useSimulation(default3DParams);
  const { params, scene, simRef } = sim;
  const [view, setView] = useState<View3DOptions>({ planes: true, opacity: 0.85, nodes: true });

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
          onReset={sim.onReset}
          testing={sim.testing}
          onWeightTest={sim.onWeightTest}
          weightSpeed={sim.weightSpeed}
          onWeightSpeed={sim.onWeightSpeed}
        />
        <section className="view">
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
              <span className="sw sw-acoustic" /> 음향 방사력 <span className="sw sw-gravity" /> 중력
            </p>
          )}
          <Legend mode={sim.mode} scene={scene} />
          <SideGraphs scene={scene} simRef={simRef} />
        </section>
        <StatsPanel scene={scene} status={sim.status} busy={sim.busy} simRef={simRef} />
      </main>
    </div>
  );
}
