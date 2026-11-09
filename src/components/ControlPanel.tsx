import type { ReactNode } from 'react';
import { ASSUMED_P0_REF } from '../physics/constants';
import type { SimParams } from '../physics/params';
import { WEIGHT_SPEEDS, WEIGHT_TEST_SECONDS } from '../sim/ballSim';
import { SLIDERS, type SliderDef } from '../state/sliders';
import type { DisplayMode } from './heatmap';

interface Props {
  params: SimParams;
  onChange: (key: SliderDef['key'], si: number) => void;
  onDirectivity: (on: boolean) => void;
  mode: DisplayMode;
  onMode: (m: DisplayMode) => void;
  animate: boolean;
  onAnimate: (on: boolean) => void;
  showForces: boolean;
  onShowForces: (on: boolean) => void;
  onSnapResonance: () => void;
  /** 현재 d / (λ/2) */
  halfWaves: number;
  onRelease: () => void;
  onReset: () => void;
  testing: boolean;
  onWeightTest: () => void;
  weightSpeed: number;
  onWeightSpeed: (s: number) => void;
  /** 기본 조작 끝에 덧붙일 요소 (3D 페이지 전용 조작) */
  extraCore?: ReactNode;
  /** 힘 화살표 체크박스 문구 */
  forcesLabel?: string;
  /** 지금 음압 P0 [Pa] (구동 세기 슬라이더 아래에 가정값 기준으로 표시) */
  p0?: number;
}

/** 기본으로 보여줄 핵심 조작 */
const CORE: SliderDef['key'][] = ['drive', 'd', 'ballDiameter', 'rhoP'];

const MODES: { id: DisplayMode; label: string }[] = [
  { id: 'amp', label: '압력 진폭 |P|' },
  { id: 'potential', label: '퍼텐셜 U' },
  { id: 'instant', label: '순간 압력 Re P(t)' },
];

export function Slider({ s, params, onChange }: { s: SliderDef; params: SimParams; onChange: Props['onChange'] }) {
  const ui = s.toUi(params[s.key]);
  return (
    <label className="slider">
      <span className="slider-head">
        <span>
          {s.label}
          {s.assumed && <span className="badge">가정값</span>}
        </span>
        <output>
          {ui.toFixed(s.digits)} {s.unit}
        </output>
      </span>
      <input
        type="range"
        min={s.min}
        max={s.max}
        step={s.step}
        value={ui}
        onChange={(e) => onChange(s.key, s.fromUi(Number(e.target.value)))}
      />
    </label>
  );
}

export default function ControlPanel(p: Props) {
  const core = CORE.map((k) => SLIDERS.find((s) => s.key === k)!);
  const rest = SLIDERS.filter((s) => !CORE.includes(s.key) && s.key !== 'phi');
  return (
    <div className="panel controls">
      <div className="btn-col">
        <button className="primary" onClick={p.onRelease}>
          공 놓기
        </button>
        <button className={p.testing ? 'danger' : 'accent2'} onClick={p.onWeightTest}>
          {p.testing ? '무게 늘리기 멈춤' : '무게 늘리기 시작'}
        </button>
        <div className="seg-row">
          <span>속도</span>
          <div className="seg" role="radiogroup" aria-label="무게 늘리기 속도">
            {WEIGHT_SPEEDS.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={p.weightSpeed === s}
                className={p.weightSpeed === s ? 'on' : ''}
                onClick={() => p.onWeightSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
          <small>한계까지 약 {Math.round(WEIGHT_TEST_SECONDS / p.weightSpeed)}초</small>
        </div>
      </div>

      <div className="core">
        {core.map((s) => (
          <div key={s.key}>
            <Slider s={s} params={p.params} onChange={p.onChange} />
            {s.key === 'drive' && p.p0 !== undefined && (
              <small className="p0-note">
                → 음압 P0 ≈ <b>{p.p0.toFixed(0)} Pa</b> (가상값: 구동 세기 1 = {ASSUMED_P0_REF} Pa)
              </small>
            )}
            {s.key === 'd' && (
              <button className="snap" onClick={p.onSnapResonance} title="d를 λ/2의 가장 가까운 정수배로">
                가장 가까운 공진 거리로 맞추기
                <small>지금 d = {p.halfWaves.toFixed(2)} × λ/2</small>
              </button>
            )}
          </div>
        ))}
        {(() => {
          const s = SLIDERS.find((v) => v.key === 'phi')!;
          return <Slider s={s} params={p.params} onChange={p.onChange} />;
        })()}
        {p.extraCore}
        <label className="check">
          <input type="checkbox" checked={p.showForces} onChange={(e) => p.onShowForces(e.target.checked)} />
          {p.forcesLabel ?? '힘 화살표 (음향 방사력 + 중력)'}
        </label>
      </div>

      <details className="advanced">
        <summary>고급 설정</summary>
        <fieldset className="modes">
          <legend>표시</legend>
          {MODES.map((m) => (
            <label key={m.id} className="radio">
              <input type="radio" name="mode" checked={p.mode === m.id} onChange={() => p.onMode(m.id)} />
              {m.label}
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={p.animate} disabled={p.mode !== 'instant'} onChange={(e) => p.onAnimate(e.target.checked)} />
            시간 진동 (시각화용 1 Hz)
          </label>
        </fieldset>
        <fieldset>
          <legend>변수</legend>
          {rest.map((s) => (
            <Slider key={s.key} s={s} params={p.params} onChange={p.onChange} />
          ))}
          <label className="check">
            <input type="checkbox" checked={p.params.directivity} onChange={(e) => p.onDirectivity(e.target.checked)} />
            점음원 지향성 (1 + cosθ)/2
          </label>
        </fieldset>
        <button onClick={p.onReset}>모두 기본값으로</button>
      </details>
    </div>
  );
}
