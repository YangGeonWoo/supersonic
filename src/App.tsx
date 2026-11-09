import ControlPanel from './components/ControlPanel';
import FieldView from './components/FieldView';
import Legend from './components/Legend';
import SideGraphs from './components/SideGraphs';
import SizeNote from './components/SizeNote';
import StatsPanel from './components/StatsPanel';
import { defaultParams, type SimParams } from './physics/params';
import { applyUrlParams } from './state/urlParams';
import { useSimulation } from './state/useSimulation';
import './index.css';

/** 2D 페이지 기본값: 공 지름 1.2 mm (ka ≈ 0.44, Gor'kov 근사 범위 안). 주소의 ?dia=&drive=&rho=가 있으면 그 값 */
export function default2DParams(): SimParams {
  return applyUrlParams({ ...defaultParams(), ballDiameter: 1.2e-3 });
}

export default function App() {
  const sim = useSimulation(default2DParams);
  const { params, scene, simRef } = sim;

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <h1>초음파 공중부양</h1>
          <a className="page-link" href="./3d.html">
            3D로 보기 →
          </a>
        </div>
        <p>위아래 초음파 발생기 사이의 정상파가 스티로폼 공을 붙잡습니다. "무게 늘리기"로 공이 얼마나 무거워질 때까지 버티는지 확인해 보세요.</p>
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
          p0={scene?.P0}
        />
        <section className="view">
          <SizeNote params={params} />
          <FieldView
            scene={scene}
            simRef={simRef}
            mode={sim.mode}
            animate={sim.animate}
            showForces={sim.showForces}
            timeScale={params.timeScale}
            onStatus={sim.onStatus}
          />
          <Legend mode={sim.mode} scene={scene} />
          <SideGraphs scene={scene} simRef={simRef} />
        </section>
        <StatsPanel scene={scene} status={sim.status} busy={sim.busy} simRef={simRef} />
      </main>
      <footer>
        정량값이 아니라 경향을 보여주는 모델입니다 (Gor’kov 근사, x-z 단면, 공 운동은 느리게 재생). 발생기 면에서 λ/8 이내는 계산하지
        않습니다(회색). 점음원 지향성을 끄면, 면에 가까운 마디는 발생기가 클 때 축 위에서 옆으로 불안정해 공이 축에서 조금 벗어난 곳에
        머물 수 있습니다.
      </footer>
    </div>
  );
}
