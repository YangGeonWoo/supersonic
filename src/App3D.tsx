import ControlPanel from './components/ControlPanel';
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
        <section className="view">3D 뷰 준비 중</section>
        <StatsPanel scene={scene} status={sim.status} busy={sim.busy} simRef={simRef} />
      </main>
    </div>
  );
}
