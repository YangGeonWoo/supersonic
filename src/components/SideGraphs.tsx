/**
 * 사이드 그래프
 *  1) 축(x = 0) 위 U(z)와 F_z(z), 공의 현재 z (매 프레임 simRef에서 읽어 직접 그림)
 *  2) 거리 d에 대한 공진 이득 G(d), 현재 d
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { drivenPairGain, resonanceCurve } from '../physics/resonance';

import type { Scene } from '../sim/scene';
import { SLIDERS } from '../state/sliders';

interface Props {
  scene: Scene | null;
  /** 공의 높이만 읽는다 (2D·3D 공 모두) */
  simRef: MutableRefObject<{ state: { z: number } } | null>;
}

const D_RANGE = (() => {
  const s = SLIDERS.find((v) => v.key === 'd')!;
  return { min: s.fromUi(s.min), max: s.fromUi(s.max) };
})();

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Colors {
  fg: string;
  muted: string;
  grid: string;
  u: string;
  f: string;
  g: string;
  ball: string;
  node: string;
}

export function readColors(el: Element): Colors {
  const c = getComputedStyle(el);
  const v = (n: string, d: string) => c.getPropertyValue(n).trim() || d;
  return {
    fg: v('--fg', '#111'),
    muted: v('--muted', '#666'),
    grid: v('--border', '#ddd'),
    u: v('--plot-u', '#2563eb'),
    f: v('--plot-f', '#ea580c'),
    g: v('--plot-g', '#7c3aed'),
    ball: v('--plot-ball', '#15803d'),
    node: v('--muted', '#888'),
  };
}

/** 캔버스 크기를 부모 폭에 맞추고 CSS 픽셀 단위 컨텍스트를 돌려준다 */
export function fit(canvas: HTMLCanvasElement, h: number): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement!.clientWidth;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** 유효숫자 2자리, 지수 표기 없이 */
export function nice(v: number): string {
  if (v >= 100) return Math.round(v).toString();
  if (v >= 10) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1);
  return v.toPrecision(2);
}

export function symRange(v: ArrayLike<number>, extra = 0): number {
  let m = Math.abs(extra);
  for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i]));
  return m > 0 ? m * 1.08 : 1;
}

export function curve(ctx: CanvasRenderingContext2D, xs: ArrayLike<number>, ys: ArrayLike<number>, X: (v: number) => number, Y: (v: number) => number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const px = X(xs[i]);
    const py = Y(ys[i]);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

export function hline(ctx: CanvasRenderingContext2D, b: Box, y: number, color: string, dash: number[] = []) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(b.x, y);
  ctx.lineTo(b.x + b.w, y);
  ctx.stroke();
  ctx.restore();
}

export function vline(ctx: CanvasRenderingContext2D, b: Box, x: number, color: string, dash: number[] = [], width = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x, b.y);
  ctx.lineTo(x, b.y + b.h);
  ctx.stroke();
  ctx.restore();
}

export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left', base: CanvasTextBaseline = 'alphabetic') {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillText(text, x, y);
}

function drawAxisGraph(canvas: HTMLCanvasElement, sc: Scene, ballZ: number | null, col: Colors) {
  const { ctx, w, h } = fit(canvas, 230);
  ctx.font = '11px system-ui, sans-serif';
  const L = 8;
  const R = 8;
  const gap = 22;
  const top = 18;
  const bottom = 20;
  const ph = (h - top - bottom - gap) / 2;
  const bu: Box = { x: L, y: top, w: w - L - R, h: ph };
  const bf: Box = { x: L, y: top + ph + gap, w: w - L - R, h: ph };
  const d = sc.params.d;
  const X = (z: number) => bu.x + (z / d) * bu.w;

  const zs = sc.axis.z;
  const U = sc.axisU;
  const F = sc.axisFz; // Gor'kov + 밀림 (밀림이 꺼져 있으면 axisF와 같음)
  const uMax = symRange(U);
  const fMax = symRange(F, sc.weight);
  const Yu = (v: number) => bu.y + bu.h / 2 - (v / uMax) * (bu.h / 2);
  const Yf = (v: number) => bf.y + bf.h / 2 - (v / fMax) * (bf.h / 2);

  for (const b of [bu, bf]) {
    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    hline(ctx, b, b.y + b.h / 2, col.grid);
    // 계산 제외 구간
    ctx.fillStyle = col.grid;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(X(0), b.y, X(sc.domain.zMin) - X(0), b.h);
    ctx.fillRect(X(sc.domain.zMax), b.y, X(d) - X(sc.domain.zMax), b.h);
    ctx.globalAlpha = 1;
    for (const zn of sc.nodesB) vline(ctx, b, X(zn), col.node, [3, 3]);
  }

  // F = mg 기준선: 공이 뜨려면 F_z가 이 선에 닿아야 함
  hline(ctx, bf, Yf(sc.weight), col.ball, [6, 3]);
  label(ctx, 'mg', bf.x + bf.w - 2, Yf(sc.weight) - 3, col.ball, 'right');

  curve(ctx, zs, U, X, Yu, col.u);
  curve(ctx, zs, F, X, Yf, col.f);

  label(ctx, '퍼텐셜 U(z)', bu.x, bu.y - 5, col.u);
  label(ctx, `세로 범위 ±${nice(uMax * 1e9)} nJ`, bu.x + bu.w, bu.y - 5, col.muted, 'right');
  label(ctx, '축 방향 힘 F_z(z)  (위쪽 +)', bf.x, bf.y - 5, col.f);
  label(ctx, `세로 범위 ±${nice(fMax * 1e6)} µN`, bf.x + bf.w, bf.y - 5, col.muted, 'right');

  // z 눈금 (5 mm 간격), 단위는 오른쪽 끝
  for (let t = 0; t <= d * 1e3 - 2; t += 5) {
    const px = X(t / 1e3);
    label(ctx, `${t}`, px, h - 6, col.muted, t === 0 ? 'left' : 'center');
  }
  label(ctx, 'z [mm]', bf.x + bf.w, h - 6, col.muted, 'right');

  if (ballZ !== null && ballZ >= 0 && ballZ <= d) {
    for (const b of [bu, bf]) vline(ctx, b, X(ballZ), col.ball, [], 2);
    ctx.fillStyle = col.ball;
    ctx.beginPath();
    ctx.arc(X(ballZ), bu.y + 6, 4, 0, 2 * Math.PI);
    ctx.fill();
    label(ctx, '공', X(ballZ) + 7, bu.y + 7, col.ball, 'left', 'middle');
  }
}

let gCache: { key: string; d: Float64Array; G: Float64Array } | null = null;

function drawGainGraph(canvas: HTMLCanvasElement, sc: Scene, col: Colors) {
  const { ctx, w, h } = fit(canvas, 150);
  ctx.font = '11px system-ui, sans-serif';
  const b: Box = { x: 30, y: 20, w: w - 38, h: h - 20 - 20 };
  const { med, params } = sc;
  const pair = params.reflections; // 반사파 직접 계산(3D): 두 발생기 구동 공진 이득
  const key = `${med.k}|${params.R}|${pair ? params.phi : 'spec'}`;
  if (!gCache || gCache.key !== key) {
    const c = resonanceCurve(D_RANGE.min, D_RANGE.max, 600, med.k, params.R);
    if (pair) for (let i = 0; i < c.d.length; i++) c.G[i] = drivenPairGain(c.d[i], med.k, params.R, params.phi);
    gCache = { key, ...c };
  }
  const gTop = Math.max(2, (1 / (1 - Math.min(params.R, 0.95))) * 1.1);
  const X = (d: number) => b.x + ((d - D_RANGE.min) / (D_RANGE.max - D_RANGE.min)) * b.w;
  const Y = (g: number) => b.y + b.h - (g / gTop) * b.h;

  ctx.strokeStyle = col.grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  hline(ctx, b, Y(1), col.grid, [2, 3]);
  label(ctx, '1', b.x - 4, Y(1) + 4, col.muted, 'right');
  label(ctx, gTop.toFixed(1), b.x - 4, b.y + 10, col.muted, 'right');

  // λ/2 정수배 (공진 거리)
  const half = med.lambda / 2;
  for (let n = Math.ceil(D_RANGE.min / half); n * half <= D_RANGE.max; n++) vline(ctx, b, X(n * half), col.grid, [2, 3]);

  curve(ctx, gCache.d, gCache.G, X, Y, col.g);
  label(ctx, pair ? '공진 이득 G(d) — 두 발생기 구동' : '공진 이득 G(d)', b.x, b.y - 6, col.g);
  label(ctx, `R = ${params.R.toFixed(2)} (가정값)`, b.x + b.w, b.y - 6, col.muted, 'right');

  for (let t = 10; t <= 40; t += 10) label(ctx, `${t}`, X(t / 1e3), h - 6, col.muted, t === 10 ? 'left' : 'center');
  label(ctx, 'd [mm]', b.x + b.w, h - 6, col.muted, 'right');

  const px = X(params.d);
  vline(ctx, b, px, col.ball, [], 2);
  ctx.fillStyle = col.ball;
  ctx.beginPath();
  ctx.arc(px, Y(sc.gain), 4, 0, 2 * Math.PI);
  ctx.fill();
  const right = px > b.x + b.w - 70;
  label(ctx, `G = ${sc.gain.toFixed(2)}`, px + (right ? -7 : 7), Math.max(b.y + 24, Y(sc.gain) - 6), col.ball, right ? 'right' : 'left');
}

export default function SideGraphs({ scene, simRef }: Props) {
  const axisRef = useRef<HTMLCanvasElement>(null);
  const gainRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useEffect(() => {
    let raf = 0;
    let lastZ = NaN;
    let lastScene: Scene | null = null;
    let lastW = -1;
    let col = readColors(document.body);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      col = readColors(document.body);
      lastScene = null;
    };
    mq.addEventListener('change', onScheme);

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const sc = sceneRef.current;
      const ac = axisRef.current;
      const gc = gainRef.current;
      if (!sc || !ac || !gc) return;
      const z = simRef.current?.state.z ?? NaN;
      const w = ac.parentElement!.clientWidth;
      const sceneChanged = sc !== lastScene || w !== lastW;
      // 공이 1 µm 이상 움직였거나 장이 바뀌었을 때만 다시 그린다
      if (sceneChanged || !(Math.abs(z - lastZ) < 1e-6)) {
        drawAxisGraph(ac, sc, Number.isFinite(z) ? z : null, col);
        lastZ = z;
      }
      if (sceneChanged) drawGainGraph(gc, sc, col);
      lastScene = sc;
      lastW = w;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener('change', onScheme);
    };
  }, [simRef]);

  return (
    <div className="graphs">
      <div className="graph">
        <div className="graph-title">축 위 퍼텐셜과 힘</div>
        <div className="graph-canvas">
          <canvas ref={axisRef} aria-label="축 위 U(z)와 F_z(z) 그래프, 공의 현재 위치" />
        </div>
        <small>공은 U가 낮은 곳(점선 마디 바로 아래)에 머뭅니다. F_z 곡선이 mg 선을 넘는 곳이 있어야 뜰 수 있습니다.</small>
      </div>
      <div className="graph">
        <div className="graph-title">발생기 간격과 공진</div>
        <div className="graph-canvas">
          <canvas ref={gainRef} aria-label="발생기 간격 d에 대한 공진 이득 G(d) 그래프" />
        </div>
        <small>
          {scene?.params.reflections
            ? '두 발생기를 같은 위상으로 구동하면 d가 λ의 정수배(세로 점선 하나 걸러)일 때 커지고, 그 사이 홀수배에서는 상대 발생기의 파와 반사파가 상쇄돼 약해집니다. 위상차 φ를 바꾸면 공진 위치도 움직입니다. 1차원 평면파 공식이며, 음향장은 반사파를 직접 계산합니다.'
            : 'd가 λ/2의 정수배(세로 점선)일 때 반사파가 겹쳐 음압이 커집니다. 경향만 보여주는 단순 모델입니다.'}
        </small>
      </div>
    </div>
  );
}
