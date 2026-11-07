import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { ASSUMED_P0_REF } from '../physics/constants';
import { marginAt, STATUS_LABEL, theoreticalLimitDensity, type BallSim, type BallStatus } from '../sim/ballSim';
import { fieldLimitDensity, fieldMargin, trapNear } from '../sim/limits';
import type { Scene } from '../sim/scene';

interface Props {
  scene: Scene | null;
  status: BallStatus;
  busy: boolean;
  simRef: MutableRefObject<BallSim | null>;
  /** 3D 페이지: 공이 있는 덫의 횡방향 판정 (κ_ρ ≤ 0이면 true). 2D는 생략 */
  lateralUnstable?: boolean;
}

/** 축에서 이만큼 넘게 떨어져 부양하면 '축 밖'으로 표시 [m] */
const OFF_AXIS = 0.5e-3;

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
  const [snap, setSnap] = useState({ rho: NaN, mass: NaN, active: false, elapsed: 0, rhoFall: null as number | null, rhoStart: NaN, started: false, speed: 1, x: 0, z: NaN, rhoLimitTest: NaN });
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
        x: sim.state.x,
        z: sim.state.z,
        // 무게 늘리기를 시작할 때 공이 있던 덫의 한계 (떨어진 뒤 공 위치로 다시 구하면 다른 덫이 됨)
        rhoLimitTest: t?.rhoLimit ?? NaN,
        rhoFall: t?.rhoFall ?? null,
        rhoStart: t?.rhoStart ?? NaN,
        started: !!t,
      });
    }, 100);
    return () => clearInterval(id);
  }, [simRef]);
  return snap;
}

export default function StatsPanel({ scene, status, busy, simRef, lateralUnstable }: Props) {
  const snap = useBallSnapshot(simRef);
  // 공이 있는 덫 (없으면 가운데 쪽). 한계는 2D 장 기준 — 덫·장면이 바뀔 때만 다시 계산
  const zTrap = scene ? trapNear(scene, Number.isFinite(snap.z) ? snap.z : scene.params.d / 2) : null;
  const rhoField = useMemo(() => (scene && zTrap !== null ? fieldLimitDensity(scene, zTrap) : NaN), [scene, zTrap]);
  if (!scene) return <div className="panel stats">음향장 계산 중…</div>;
  const { med, params, particle } = scene;

  const rho = Number.isFinite(snap.rho) ? snap.rho : particle.rhoP;
  const mass = Number.isFinite(snap.mass) ? snap.mass : particle.m;
  const margin = zTrap !== null ? fieldMargin(scene, zTrap, rho) : marginAt(scene, rho);
  const rhoAnalytic = theoreticalLimitDensity(scene);
  const rhoLimit = Number.isFinite(rhoField) ? rhoField : rhoAnalytic;
  const massLimit = rhoLimit * particle.V;
  const frac = Math.min(1, mass / massLimit);

  return (
    <div className="panel stats">
      {(() => {
        // 부양 중이라도 축 밖에 있거나 횡방향이 불안정하면 한 칸에서 같이 알린다
        const offAxis = status === 'levitating' && Math.abs(snap.x) > OFF_AXIS;
        const lateral = status === 'levitating' && !!lateralUnstable;
        const caution = offAxis || lateral;
        const label = !caution ? STATUS_LABEL[status] : offAxis ? '부양 (축 밖)' : '부양 (옆으로 불안정)';
        return (
          <div className={`status ${caution ? 'status-moving' : `status-${status}`}`} role="status" aria-live="polite">
            <span>상태</span>
            <strong>{label}</strong>
            {busy && <em className="busy">계산 중…</em>}
            {caution && (
              <small className="status-note">
                {offAxis
                  ? `위아래로는 붙잡혀 있지만 축에서 ${(Math.abs(snap.x) * 1e3).toFixed(1)} mm 벗어난 곳에 머물러 있습니다. 축 위에서는 옆으로 밀어내는 힘이 작용하는 상태입니다.`
                  : '위아래로는 붙잡혀 있지만, 축에서 조금만 밀려도 옆으로 밀려나는 상태입니다.'}
              </small>
            )}
          </div>
        );
      })()}

      <div className="card weight">
        <div className="card-title">얼마나 무거워질 때까지 버틸까?</div>
        <div className="big-row">
          <div>
            <div className="big">{mgOf(mass)}</div>
            <small>지금 공 무게 (밀도 {rho.toFixed(0)} kg/m³)</small>
          </div>
          <div className="right">
            <div className="big">{mgOf(massLimit)}</div>
            <small>부양 한계 (2D 장 기준)</small>
          </div>
        </div>
        <div className="meter" aria-label="부양 한계 대비 현재 무게">
          <div className={`meter-fill ${frac > 0.8 ? 'hot' : ''}`} style={{ width: `${frac * 100}%` }} />
        </div>
        <small>
          지금 무게의 <b>{(massLimit / mass).toFixed(1)}배</b>까지 버틸 수 있음 (힘 여유 {margin.toFixed(2)}배)
          <br />
          1차원 해석식(F_max = mg)으로는 {mgOf(rhoAnalytic * particle.V)} — 발생기 근접장 때문에 실제 장의 힘이 그보다 약함
        </small>

        {snap.started && (
          <div className="result">
            {snap.rhoFall !== null ? (
              <>
                <b>{mgOf(snap.rhoFall * particle.V)}</b>에서 떨어짐 — 처음의 {(snap.rhoFall / snap.rhoStart).toFixed(1)}배,{' '}
                {snap.elapsed.toFixed(1)}초 버팀{snap.speed !== 1 && ` (${snap.speed}× 속도)`}
                <br />
                <small>
                  부양 한계(2D 장) 대비 {((snap.rhoFall / (Number.isFinite(snap.rhoLimitTest) ? snap.rhoLimitTest : rhoLimit)) * 100).toFixed(0)}%
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
