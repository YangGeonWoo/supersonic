/**
 * 메인 뷰: x-z 단면 히트맵, 발생기, 마디 보조선, 공.
 * 공의 위치/속도는 React 상태가 아니라 simRef에 있고, requestAnimationFrame 루프에서 직접 그린다.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { sampleForce } from '../physics/field2d';
import { energyCoeff } from '../physics/gorkov';
import type { BallSim, BallStatus } from '../sim/ballSim';
import type { Scene } from '../sim/scene';
import { LUT_DIV, LUT_SEQ } from './colormap';

export type DisplayMode = 'amp' | 'potential' | 'instant';

/** 고정 색 범위 (구동 세기 변화가 화면 밝기로 보이도록) */
export const P_SCALE = 2000; // Pa
export function potentialScale(scene: Scene): number {
  // 기준 P0 = 1500 Pa일 때 A층 마디의 |U| 크기
  return scene.particle.V * energyCoeff(1500, scene.med) * 1.5 * Math.max(scene.particle.f2, 0.1);
}

interface Props {
  scene: Scene | null;
  simRef: MutableRefObject<BallSim | null>;
  mode: DisplayMode;
  animate: boolean;
  /** 힘 화살표 (음향 방사력 + 중력) */
  showForces: boolean;
  timeScale: number;
  onStatus: (s: BallStatus) => void;
}

const VIEW_HALF_WIDTH = 13e-3; // m
const BODY = 3e-3; // 발생기 몸체 두께 (그림용) [m]
const ARROW_DX = 1.5e-3; // 화살표 격자 x 간격 [m]
const ARROW_MAX_PX = 16; // 화살표 최대 길이 [px]

interface ArrowField {
  x: Float64Array;
  z: Float64Array;
  fx: Float64Array;
  fz: Float64Array;
  /** 길이 기준 힘 [N] */
  fRef: number;
}

/** 장 위의 화살표: 기본 공(scene.particle)에 작용하는 음향 방사력 + 중력 */
function buildArrows(sc: Scene): ArrowField {
  const xs: number[] = [];
  const zs: number[] = [];
  const dz = sc.med.lambda / 8;
  const nzs = Math.max(1, Math.floor((sc.domain.zMax - sc.domain.zMin) / dz));
  const z0 = (sc.domain.zMin + sc.domain.zMax - nzs * dz) / 2;
  for (let j = 0; j <= nzs; j++) {
    for (let x = -10.5e-3; x <= 10.5e-3 + 1e-9; x += ARROW_DX) {
      xs.push(x);
      zs.push(z0 + j * dz);
    }
  }
  const n = xs.length;
  const a: ArrowField = { x: Float64Array.from(xs), z: Float64Array.from(zs), fx: new Float64Array(n), fz: new Float64Array(n), fRef: Math.max(sc.Fmax, sc.weight, 1e-12) };
  const out = { fx: 0, fz: 0 };
  const s2 = sc.s * sc.s;
  for (let i = 0; i < n; i++) {
    sampleForce(sc.potential, s2, a.x[i], a.z[i], out);
    a.fx[i] = out.fx;
    a.fz[i] = out.fz - sc.weight;
  }
  return a;
}

/** 화면 좌표 화살표 (dx, dy: 화면 방향, 길이 len px) */
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number, len: number, head: number) {
  if (len < 1.5) return;
  const ex = x + ux * len;
  const ey = y + uy * len;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  const h = Math.min(head, len * 0.6);
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ux * h - uy * h * 0.55, ey - uy * h + ux * h * 0.55);
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ux * h + uy * h * 0.55, ey - uy * h - ux * h * 0.55);
  ctx.stroke();
}

/** 길이는 √(|F|/F_ref)로 압축 (작은 힘도 보이도록) */
function arrowLen(f: number, fRef: number, maxPx: number): number {
  return maxPx * Math.min(1.4, Math.sqrt(f / fRef));
}

export default function FieldView({ scene, simRef, mode, animate, showForces, timeScale, onStatus }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const props = useRef({ scene, mode, animate, showForces, timeScale, onStatus });
  props.current = { scene, mode, animate, showForces, timeScale, onStatus };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const off = document.createElement('canvas');
    const offCtx = off.getContext('2d')!;
    let img: ImageData | null = null;
    let cachedScene: Scene | null = null;
    let cachedMode: DisplayMode | null = null;
    let lastStatus: BallStatus | null = null;
    let arrows: { scene: Scene; a: ArrowField } | null = null;
    const ballF = { fx: 0, fz: 0 };
    let last = performance.now();
    let raf = 0;
    let cssW = 0;
    let cssH = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cssW = wrap.clientWidth;
      cssH = Math.round(Math.min(620, Math.max(360, cssW * 1.05)));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const paintHeatmap = (sc: Scene, m: DisplayMode, phase: number) => {
      const g = sc.field;
      if (!img || img.width !== g.nx || img.height !== g.nz) {
        off.width = g.nx;
        off.height = g.nz;
        img = offCtx.createImageData(g.nx, g.nz);
      }
      const data = img.data;
      const s = sc.s;
      const s2 = s * s;
      const uScale = potentialScale(sc);
      const lut = m === 'amp' ? LUT_SEQ : LUT_DIV;
      const c = Math.cos(phase);
      const sn = Math.sin(phase);
      for (let iz = 0; iz < g.nz; iz++) {
        const row = g.nz - 1 - iz; // z 위쪽이 화면 위
        for (let ix = 0; ix < g.nx; ix++) {
          const i = iz * g.nx + ix;
          let t: number;
          if (m === 'amp') t = (s * Math.sqrt(g.p2[i])) / P_SCALE;
          else if (m === 'potential') t = 0.5 + (0.5 * s2 * sc.potential.U[i]) / uScale;
          else t = 0.5 + (0.5 * s * (g.pRe[i] * c + g.pIm[i] * sn)) / P_SCALE;
          const li = Math.max(0, Math.min(255, (t * 255) | 0)) * 3;
          const o = (row * g.nx + ix) * 4;
          data[o] = lut[li];
          data[o + 1] = lut[li + 1];
          data[o + 2] = lut[li + 2];
          data[o + 3] = 255;
        }
      }
      offCtx.putImageData(img, 0, 0);
    };

    const frame = (tNow: number) => {
      raf = requestAnimationFrame(frame);
      const realDt = Math.min(0.1, (tNow - last) / 1000);
      last = tNow;
      const { scene: sc, mode: m, animate: anim, showForces: forces, timeScale: ts, onStatus: report } = props.current;
      const sim = simRef.current;
      if (sim) {
        sim.advanceFrame(realDt, ts, sc ?? undefined);
        if (sim.status !== lastStatus) {
          lastStatus = sim.status;
          report(sim.status);
        }
      }

      const css = getComputedStyle(canvas);
      ctx.fillStyle = css.getPropertyValue('--canvas-bg') || '#111';
      ctx.fillRect(0, 0, cssW, cssH);
      if (!sc) return;

      const d = sc.params.d;
      const pad = 8;
      const scale = Math.min((cssW - 2 * pad) / (2 * VIEW_HALF_WIDTH), (cssH - 2 * pad) / (d + 2 * BODY));
      const cx = cssW / 2;
      const cy = cssH / 2 + (d / 2) * scale; // z = 0 의 화면 y
      const X = (x: number) => cx + x * scale;
      const Y = (z: number) => cy - z * scale;

      // 히트맵
      const instant = m === 'instant';
      if (sc !== cachedScene || m !== cachedMode || instant) {
        const phase = instant && anim ? 2 * Math.PI * 1 * (tNow / 1000) : 0; // 시각화용 1 Hz
        paintHeatmap(sc, m, phase);
        cachedScene = sc;
        cachedMode = m;
      }
      const g = sc.field;
      ctx.imageSmoothingEnabled = true;
      const gx0 = X(g.x0 - g.hx / 2);
      const gy0 = Y(g.z0 + (g.nz - 0.5) * g.hz);
      ctx.drawImage(off, gx0, gy0, g.nx * g.hx * scale, g.nz * g.hz * scale);

      // 계산 제외 구간 (면에서 λ/8)
      ctx.fillStyle = css.getPropertyValue('--excluded') || 'rgba(128,128,128,0.25)';
      ctx.fillRect(X(-12e-3), Y(sc.domain.zMin), 24e-3 * scale, sc.domain.zMin * scale);
      ctx.fillRect(X(-12e-3), Y(d), 24e-3 * scale, (d - sc.domain.zMax) * scale);

      // 발생기
      const at = sc.params.at;
      ctx.fillStyle = css.getPropertyValue('--transducer') || '#888';
      ctx.fillRect(X(-at), Y(0), 2 * at * scale, BODY * scale);
      ctx.fillRect(X(-at), Y(d + BODY), 2 * at * scale, BODY * scale);
      ctx.fillStyle = css.getPropertyValue('--transducer-face') || '#ccc';
      ctx.fillRect(X(-at), Y(0) - 1, 2 * at * scale, 2);
      ctx.fillRect(X(-at), Y(d) - 1, 2 * at * scale, 2);

      // 축 방향 마디 보조선
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      for (const zn of sc.nodesB) {
        ctx.beginPath();
        ctx.moveTo(X(-12e-3), Y(zn));
        ctx.lineTo(X(12e-3), Y(zn));
        ctx.stroke();
      }
      ctx.restore();

      // 축
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      ctx.lineTo(X(0), Y(d));
      ctx.stroke();

      // 힘 화살표 (장 전체: 기본 공 기준)
      if (forces) {
        if (!arrows || arrows.scene !== sc) arrows = { scene: sc, a: buildArrows(sc) };
        const a = arrows.a;
        const maxPx = Math.min(ARROW_MAX_PX, ARROW_DX * scale * 0.9);
        ctx.save();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        for (let i = 0; i < a.x.length; i++) {
          const f = Math.hypot(a.fx[i], a.fz[i]);
          if (f === 0) continue;
          arrow(ctx, X(a.x[i]), Y(a.z[i]), a.fx[i] / f, -a.fz[i] / f, arrowLen(f, a.fRef, maxPx), 4);
        }
        ctx.restore();
      }

      // 공
      if (sim) {
        const st = sim.state;
        const r = Math.max(2, sc.particle.a * scale);
        ctx.beginPath();
        ctx.arc(X(st.x), Y(st.z), r, 0, 2 * Math.PI);
        // 무게 테스트 중에는 무거워질수록 흰색 → 주황
        const t = sim.test;
        const heat = t ? Math.min(1, Math.log(sim.density / t.rhoStart) / Math.log(Math.max(1.05, t.rhoLimit / t.rhoStart))) : 0;
        ctx.fillStyle = `rgb(255, ${Math.round(255 - 120 * heat)}, ${Math.round(255 - 230 * heat)})`;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#222';
        ctx.stroke();

        // 공에 작용하는 알짜힘 (음향 방사력 + 중력, 현재 무게 기준)
        if (forces && sim.status !== 'escaped') {
          sim.dyn.force(st.x, st.z, ballF);
          const fx = ballF.fx;
          const fz = ballF.fz - sim.dyn.m * sim.dyn.g;
          const f = Math.hypot(fx, fz);
          const fRef = arrows ? arrows.a.fRef : Math.max(sc.Fmax, sc.weight);
          const len = f > 0 ? arrowLen(f, fRef, 3 * ARROW_MAX_PX) : 0;
          if (len >= 2) {
            // 공 중심에서 시작해 공 밖으로 len만큼 (평형이면 거의 0이라 안 보임)
            ctx.save();
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = '#fde047';
            arrow(ctx, X(st.x), Y(st.z), fx / f, -fz / f, r + len, 7);
            ctx.restore();
          }
        }
      }

      // 축척 막대 5 mm
      const bar = 5e-3 * scale;
      ctx.fillStyle = css.getPropertyValue('--canvas-fg') || '#eee';
      ctx.fillRect(pad + 4, cssH - pad - 6, bar, 3);
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('5 mm', pad + 4, cssH - pad - 10);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [simRef]);

  return (
    <div ref={wrapRef} className="field-wrap">
      <canvas ref={canvasRef} className="field-canvas" aria-label="x-z 단면 음향장과 공" />
    </div>
  );
}
