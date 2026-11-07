/**
 * GPU 3D 격자 모드의 오른쪽 패널: 계산 정보, 공이 있는 덫의 위치와 3×3 강성(옆 방향 고유값·주축), 밀림, 자체 검증.
 * 공의 위치는 0.25초마다 sim3Ref에서 읽어 덫이 바뀔 때만 다시 계산한다.
 */
import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import type { SelfTestResult } from '../gpu/selftest';
import { lateralStiffness3 } from '../physics/force3';
import type { BallSim3 } from '../sim/ballSim3';
import { nearestTrap3 } from '../sim/ballSim3';
import type { Scene3 } from '../sim/scene3';
import { GRID_LABEL, type GridRes } from '../state/useGpuSim';

interface Props {
  scene3: Scene3 | null;
  sim3Ref: MutableRefObject<BallSim3 | null>;
  busy: boolean;
  error: string | null;
  res: GridRes;
  selftest: SelfTestResult | null;
}

const mm = (v: number) => `${(v * 1e3).toFixed(2)}`;

export default function StiffnessPanel({ scene3: sc, sim3Ref, busy, error, res, selftest }: Props) {
  const [trapIdx, setTrapIdx] = useState(-1);
  useEffect(() => {
    const id = setInterval(() => {
      const sim = sim3Ref.current;
      if (!sc || !sim) return;
      const t = nearestTrap3(sc, sim.state);
      setTrapIdx(t ? sc.traps.indexOf(t) : -1);
    }, 250);
    return () => clearInterval(id);
  }, [sc, sim3Ref]);

  const trap = sc && trapIdx >= 0 ? sc.traps[trapIdx] : sc?.centralTrap ?? null;
  const L = useMemo(() => (sc && trap ? lateralStiffness3(sc.model, trap) : null), [sc, trap]);

  if (error) return <div className="panel lateral">GPU 계산 오류: {error}</div>;
  if (!sc) return <div className="panel lateral">GPU 3D 격자 계산 중…</div>;
  const g = sc.grid;
  const stable = !!L && L.kMin > 0;
  const split = L ? (L.kMax - L.kMin) / Math.max(Math.abs(L.kMax), 1e-30) : 0;

  return (
    <div className="panel lateral stiffness">
      <div className={`status ${stable ? 'status-levitating' : 'status-moving'}`}>
        <span>옆 방향</span>
        <strong>{L ? (stable ? '안정' : '불안정') : '—'}</strong>
        <small className="status-note">공이 있는 덫에서 옆(x, y) 어느 방향으로 밀려도 되돌아오는지 (3D 격자, 축대칭 가정 없음)</small>
      </div>
      <dl>
        <div className="stat">
          <dt>덫 위치</dt>
          <dd>
            {trap ? `(${mm(trap.x)}, ${mm(trap.y)}, ${mm(trap.z)}) mm` : '—'}
            <small>x, y, z — 축(0, 0)에서 {trap ? mm(Math.hypot(trap.x, trap.y)) : '—'} mm</small>
          </dd>
        </div>
        {L && (
          <>
            <div className="stat">
              <dt>옆 / 위아래 복원력</dt>
              <dd>
                {((L.kMin / L.kz) * 100).toFixed(1)}%
                <small>가장 약한 옆 방향 κ_min / κ_z</small>
              </dd>
            </div>
            <div className="stat">
              <dt>옆 강성 (두 주축)</dt>
              <dd>
                {(L.kMin * 1e3).toFixed(2)} / {(L.kMax * 1e3).toFixed(2)} mN/m
                <small>
                  방향 차이 {(split * 100).toFixed(1)}%, 약한 축 {((L.angleMin * 180) / Math.PI).toFixed(0)}° (x축 기준)
                </small>
              </dd>
            </div>
            <div className="stat">
              <dt>위아래 강성 κ_z</dt>
              <dd>{(L.kz * 1e3).toFixed(1)} mN/m</dd>
            </div>
          </>
        )}
        <div className="stat">
          <dt>덫 개수</dt>
          <dd>
            {sc.traps.length}
            <small>가운데 수직선에서 찾아 3D로 다듬은 힘 평형점</small>
          </dd>
        </div>
        <div className="stat">
          <dt>복사력 함수 Y_p</dt>
          <dd>
            {sc.Yp.toFixed(3)}
            <small>밀림 {sc.pushCoeff > 0 ? '켜짐' : '꺼짐'}, ka = {(sc.med.k * sc.particle.a).toFixed(2)}</small>
          </dd>
        </div>
        <div className="stat">
          <dt>GPU 계산</dt>
          <dd>
            {sc.computeMs.toFixed(0)} ms{busy ? ' (다시 계산 중…)' : ''}
            <small>
              {GRID_LABEL[res]}, {g.nx}×{g.ny}×{g.nz} = {(g.nx * g.ny * g.nz).toLocaleString()} 복셀
            </small>
          </dd>
        </div>
        {selftest && (
          <div className="stat selftest">
            <dt>자체 검증 (GPU vs CPU)</dt>
            <dd>
              P {selftest.relP.toExponential(1)}, |∇P|² {selftest.relG2.toExponential(1)}, I {selftest.relI.toExponential(1)}
              <small>{selftest.points}점 최대 상대오차</small>
            </dd>
          </div>
        )}
      </dl>
      <small className="note">
        x-y 단면과 '덫 등치면'으로 덫 모양을 볼 수 있습니다. 위 발생기를 기울이면 마디 면이 함께 기울어 덫이 옆으로 옮겨 가고(바깥 덫일수록
        크게), 옆 강성은 방향에 따라 조금 달라집니다.
      </small>
    </div>
  );
}
