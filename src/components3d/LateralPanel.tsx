/**
 * 횡방향(축에서 벗어나는 방향) 안정성 패널: 공이 있는 덫에서 U(ρ), F_ρ(ρ), κ_ρ/κ_z, 판정.
 * 공의 위치는 rAF에서 simRef로 읽고, 덫이 바뀔 때만 React 상태를 바꾼다.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { curve, fit, hline, label, nice, readColors, symRange, vline, type Box, type Colors } from '../components/SideGraphs';
import type { LateralResult } from '../physics/lateral';
import type { BallSim } from '../sim/ballSim';
import { lateralFor, trapsOf } from '../sim/lateralScene';
import type { Scene } from '../sim/scene';

interface Props {
  scene: Scene | null;
  simRef: MutableRefObject<BallSim | null>;
}

function nearest(list: number[], z: number): number | null {
  if (list.length === 0) return null;
  return list.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
}

function draw(canvas: HTMLCanvasElement, r: LateralResult, ballRho: number | null, col: Colors) {
  const { ctx, w, h } = fit(canvas, 200);
  ctx.font = '11px system-ui, sans-serif';
  const gap = 22;
  const top = 18;
  const bottom = 20;
  const ph = (h - top - bottom - gap) / 2;
  const bu: Box = { x: 8, y: top, w: w - 16, h: ph };
  const bf: Box = { x: 8, y: top + ph + gap, w: w - 16, h: ph };
  const { rho, U, Frho, FrhoPush } = r.profile;
  const rMax = rho[rho.length - 1];
  const X = (v: number) => bu.x + (v / rMax) * bu.w;
  let uLo = Infinity;
  let uHi = -Infinity;
  for (const v of U) {
    uLo = Math.min(uLo, v);
    uHi = Math.max(uHi, v);
  }
  const pad = (uHi - uLo) * 0.08 || 1e-12;
  const Yu = (v: number) => bu.y + bu.h - ((v - uLo + pad) / (uHi - uLo + 2 * pad)) * bu.h;
  const fMax = symRange(Frho);
  const Yf = (v: number) => bf.y + bf.h / 2 - (v / fMax) * (bf.h / 2);

  for (const b of [bu, bf]) {
    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  }
  hline(ctx, bf, bf.y + bf.h / 2, col.grid);
  curve(ctx, rho, U, X, Yu, col.u);
  curve(ctx, rho, Frho, X, Yf, col.f);
  let anyPush = false;
  for (const v of FrhoPush) if (v !== 0) anyPush = true;
  if (anyPush) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    curve(ctx, rho, FrhoPush, X, Yf, col.muted);
    ctx.restore();
  }
  if (r.ringRadius !== null) for (const b of [bu, bf]) vline(ctx, b, X(r.ringRadius), col.f, [3, 3]);

  label(ctx, `퍼텐셜 U(ρ)  (z = ${(r.zTrap * 1e3).toFixed(2)} mm 덫)`, bu.x, bu.y - 5, col.u);
  label(ctx, `범위 ${nice((uHi - uLo) * 1e9)} nJ`, bu.x + bu.w, bu.y - 5, col.muted, 'right');
  label(ctx, `반지름 방향 힘 F_ρ (바깥 +)${anyPush ? ', 점선 = 밀림' : ''}`, bf.x, bf.y - 5, col.f);
  label(ctx, `±${nice(fMax * 1e6)} µN`, bf.x + bf.w, bf.y - 5, col.muted, 'right');
  for (let t = 0; t <= rMax * 1e3 - 1; t += 2) label(ctx, `${t}`, X(t / 1e3), h - 6, col.muted, t === 0 ? 'left' : 'center');
  label(ctx, 'ρ [mm]', bf.x + bf.w, h - 6, col.muted, 'right');

  if (ballRho !== null && ballRho <= rMax) {
    for (const b of [bu, bf]) vline(ctx, b, X(ballRho), col.ball, [], 2);
    label(ctx, '공', X(ballRho) + 5, bu.y + 12, col.ball);
  }
}

export default function LateralPanel({ scene, simRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zTrap, setZTrap] = useState<number | null>(null);
  const traps = useMemo(() => (scene ? trapsOf(scene) : []), [scene]);
  const result = useMemo(() => (scene && zTrap !== null ? lateralFor(scene, zTrap) : null), [scene, zTrap]);
  const live = useRef({ traps, result });
  live.current = { traps, result };

  useEffect(() => {
    let raf = 0;
    let lastRho = NaN;
    let lastRes: LateralResult | null = null;
    let lastW = -1;
    let col = readColors(document.body);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      col = readColors(document.body);
      lastRes = null;
    };
    mq.addEventListener('change', onScheme);
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const sim = simRef.current;
      const { traps: ts, result: r } = live.current;
      if (sim && ts.length) {
        const zt = nearest(ts, sim.state.z);
        setZTrap((prev) => (prev === zt ? prev : zt));
      }
      const c = canvasRef.current;
      if (!c || !r) return;
      const rho = sim ? Math.abs(sim.state.x) : NaN;
      const w = c.parentElement!.clientWidth;
      if (r !== lastRes || w !== lastW || !(Math.abs(rho - lastRho) < 1e-6)) {
        draw(c, r, Number.isFinite(rho) ? rho : null, col);
        lastRes = r;
        lastRho = rho;
        lastW = w;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener('change', onScheme);
    };
  }, [simRef]);

  if (!result) return <div className="panel lateral">횡방향 계산 중…</div>;
  const ok = result.stable;
  return (
    <div className="panel lateral">
      <div className={`status ${ok ? 'status-levitating' : 'status-moving'}`}>
        <span>횡방향</span>
        <strong>{ok ? '안정' : '불안정'}</strong>
      </div>
      <dl>
        <div className="stat">
          <dt>횡방향 / 축 방향 복원력</dt>
          <dd>
            {(result.ratio * 100).toFixed(1)}%
            <small>κ_ρ/κ_z (공이 있는 덫)</small>
          </dd>
        </div>
        <div className="stat">
          <dt>횡방향 강성 κ_ρ</dt>
          <dd>
            {(result.kappaRho * 1e3).toFixed(2)} mN/m
            <small>축 방향 κ_z = {(result.kappaZ * 1e3).toFixed(1)} mN/m</small>
          </dd>
        </div>
      </dl>
      <div className="graph-canvas">
        <canvas ref={canvasRef} aria-label="덫 높이에서 반지름 방향 퍼텐셜 U(ρ)와 힘 F_ρ(ρ)" />
      </div>
      <small className="note">
        {ok
          ? '축에서 조금 밀려도 다시 축으로 돌아옵니다. 다만 축 방향보다 훨씬 약하게 붙잡혀 있어 옆으로 흔들리기 쉽습니다.'
          : `축 위에서는 공을 바깥으로 밉니다. 공은 축에서 약 ${result.ringRadius !== null ? (result.ringRadius * 1e3).toFixed(1) : '?'} mm 떨어진 곳(점선, 실제로는 고리 모양)에 머물거나 빠져나갈 수 있습니다.`}
      </small>
    </div>
  );
}
