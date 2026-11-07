import { useEffect, useState, type MutableRefObject } from 'react';
import { ASSUMED_P0_REF } from '../physics/constants';
import { marginAt, STATUS_LABEL, theoreticalLimitDensity, type BallSim, type BallStatus } from '../sim/ballSim';
import type { Scene } from '../sim/scene';

interface Props {
  scene: Scene | null;
  status: BallStatus;
  busy: boolean;
  simRef: MutableRefObject<BallSim | null>;
}

const mgOf = (kg: number) => `${(kg * 1e6).toFixed(2)} mg`;

function Row({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="stat">
      <dt>{k}</dt>
      <dd>
        {v}
        {hint && <small>{hint}</small>}
      </dd>
    </div>
  );
}

/** 공 무게와 무게 테스트 진행 (10 Hz로 simRef를 읽는다 — 매 프레임 React 상태를 바꾸지 않음) */
function useBallSnapshot(simRef: MutableRefObject<BallSim | null>) {
  const [snap, setSnap] = useState({ rho: NaN, mass: NaN, active: false, elapsed: 0, rhoFall: null as number | null, rhoStart: NaN, started: false, speed: 1 });
  useEffect(() => {
    const id = setInterval(() => {
      const sim = simRef.current;
      if (!sim) return;
      const t = sim.test;
      setSnap({
        rho: sim.density,
        mass: sim.mass,
        active: !!t?.active,
        elapsed: t?.elapsedFall ?? t?.elapsed ?? 0,
        speed: t?.speed ?? 1,
        rhoFall: t?.rhoFall ?? null,
        rhoStart: t?.rhoStart ?? NaN,
        started: !!t,
      });
    }, 100);
    return () => clearInterval(id);
  }, [simRef]);
  return snap;
}

export default function StatsPanel({ scene, status, busy, simRef }: Props) {
  const snap = useBallSnapshot(simRef);
  if (!scene) return <div className="panel stats">음향장 계산 중…</div>;
  const { med, params, particle } = scene;

  const rho = Number.isFinite(snap.rho) ? snap.rho : particle.rhoP;
  const mass = Number.isFinite(snap.mass) ? snap.mass : particle.m;
  const margin = marginAt(scene, rho);
  const rhoLimit = theoreticalLimitDensity(scene);
  const massLimit = rhoLimit * particle.V;
  const frac = Math.min(1, mass / massLimit);

  return (
    <div className="panel stats">
      <div className={`status status-${status}`}>
        <span>상태</span>
        <strong>{STATUS_LABEL[status]}</strong>
        {busy && <em className="busy">계산 중…</em>}
      </div>

      <div className="card weight">
        <div className="card-title">얼마나 무거워질 때까지 버틸까?</div>
        <div className="big-row">
          <div>
            <div className="big">{mgOf(mass)}</div>
            <small>지금 공 무게 (밀도 {rho.toFixed(0)} kg/m³)</small>
          </div>
          <div className="right">
            <div className="big">{mgOf(massLimit)}</div>
            <small>이론 한계 (F_max = mg)</small>
          </div>
        </div>
        <div className="meter" aria-label="이론 한계 대비 현재 무게">
          <div className={`meter-fill ${frac > 0.8 ? 'hot' : ''}`} style={{ width: `${frac * 100}%` }} />
        </div>
        <small>
          지금 무게의 <b>{(massLimit / mass).toFixed(1)}배</b>까지 버틸 수 있음 (힘 여유 F_max/mg = {margin.toFixed(2)})
        </small>

        {snap.started && (
          <div className="result">
            {snap.rhoFall !== null ? (
              <>
                <b>{mgOf(snap.rhoFall * particle.V)}</b>에서 떨어짐 — 처음의 {(snap.rhoFall / snap.rhoStart).toFixed(1)}배,{' '}
                {snap.elapsed.toFixed(1)}초 버팀{snap.speed !== 1 && ` (${snap.speed}× 속도)`}
                <br />
                <small>
                  이론 한계 대비 {((snap.rhoFall / rhoLimit) * 100).toFixed(0)}% (2차원 장·진동 때문에 조금 일찍 떨어질 수 있음)
                </small>
              </>
            ) : snap.active ? (
              <>무게 늘리는 중{snap.speed !== 1 && ` (${snap.speed}×)`}… {snap.elapsed.toFixed(1)}초 (처음의 {(rho / snap.rhoStart).toFixed(1)}배)</>
            ) : (
              <>멈춤 — {snap.elapsed.toFixed(1)}초, 처음의 {(rho / snap.rhoStart).toFixed(1)}배</>
            )}
          </div>
        )}
      </div>

      <dl>
        <Row k="음압 P0" v={`${scene.P0.toFixed(0)} Pa`} hint={`${scene.spl.toFixed(0)} dB`} />
        <Row k="마디 개수" v={`${scene.nodesB.length}`} hint={`간격 λ/2 = ${((med.lambda / 2) * 1e3).toFixed(2)} mm`} />
      </dl>

      <details className="advanced">
        <summary>자세한 수치</summary>
        <dl>
          <Row k="파장 λ" v={`${(med.lambda * 1e3).toFixed(3)} mm`} hint={`c = ${med.c.toFixed(1)} m/s`} />
          <Row k="d / (λ/2)" v={(params.d / (med.lambda / 2)).toFixed(3)} hint={`공진 이득 G = ${scene.gain.toFixed(2)}`} />
          <Row k="F_max (기본 무게)" v={`${(scene.Fmax * 1e6).toFixed(1)} µN`} hint={`mg = ${(scene.weight * 1e6).toFixed(2)} µN`} />
          <Row k="진동 주기 T_osc" v={Number.isFinite(scene.Tosc) ? `${(scene.Tosc * 1e3).toFixed(2)} ms` : '—'} />
          <Row k="음향장 계산 시간" v={`${scene.computeMs.toFixed(0)} ms`} hint={`${scene.field.nx}×${scene.field.nz} 격자, 점음원 ${scene.sources.n}개`} />
        </dl>
        <div className="assumed">
          <strong>가정값</strong>
          <ul>
            <li>반사계수 R = {params.R.toFixed(2)}, 감쇠비 ζ = {params.zeta.toFixed(2)}</li>
            <li>Kp = {params.Kp.toExponential(0)} Pa, 기준 압력 {ASSUMED_P0_REF} Pa</li>
          </ul>
        </div>
      </details>
    </div>
  );
}
