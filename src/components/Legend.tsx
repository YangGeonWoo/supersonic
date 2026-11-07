import type { Scene } from '../sim/scene';
import { LUT_DIV, LUT_SEQ, lutCss } from './colormap';
import { P_SCALE, potentialScale, type DisplayMode } from './FieldView';

function gradient(lut: Uint8ClampedArray): string {
  const stops = Array.from({ length: 11 }, (_, i) => `${lutCss(lut, i / 10)} ${i * 10}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export default function Legend({ mode, scene }: { mode: DisplayMode; scene: Scene | null }) {
  let lo = '';
  let mid = '';
  let hi = '';
  let title = '';
  if (mode === 'amp') {
    title = '압력 진폭 |P|';
    lo = '0';
    mid = `${P_SCALE / 2} Pa`;
    hi = `≥ ${P_SCALE} Pa`;
  } else if (mode === 'instant') {
    title = '순간 압력 Re P(t)';
    lo = `−${P_SCALE} Pa`;
    mid = '0';
    hi = `+${P_SCALE} Pa`;
  } else {
    title = 'Gor’kov 퍼텐셜 U (파랑 = 낮음, 공이 모이는 곳)';
    const u = scene ? potentialScale(scene) : 0;
    lo = `−${(u * 1e9).toFixed(0)} nJ`;
    mid = '0';
    hi = `+${(u * 1e9).toFixed(0)} nJ`;
  }
  return (
    <div className="legend">
      <div className="legend-title">
        {title}
        <span className="legend-note">점선 = 공이 머무는 자리(압력 마디)</span>
      </div>
      <div className="legend-bar" style={{ background: gradient(mode === 'amp' ? LUT_SEQ : LUT_DIV) }} />
      <div className="legend-ticks">
        <span>{lo}</span>
        <span>{mid}</span>
        <span>{hi}</span>
      </div>
    </div>
  );
}
