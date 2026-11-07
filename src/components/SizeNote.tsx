/** 공 크기에 따른 Gor'kov 근사 유효성 안내 (2D/3D 공용) */
import { makeMedium } from '../physics/acoustics';
import { GORKOV_KA_OK, gorkovValidity } from '../physics/gorkov';
import type { SimParams } from '../physics/params';

export default function SizeNote({ params }: { params: SimParams }) {
  const lambda = makeMedium(params.f, params.T).lambda;
  const { ka, level } = gorkovValidity(params.ballDiameter, lambda);
  if (level === 'ok') return null;
  const okDia = ((2 * GORKOV_KA_OK) / ((2 * Math.PI) / lambda)) * 1e3;
  return (
    <div className={level === 'invalid' ? 'warn' : 'size-note'}>
      {level === 'invalid' ? (
        <>
          공 지름({(params.ballDiameter * 1e3).toFixed(1)} mm)이 반파장 λ/2({((lambda / 2) * 1e3).toFixed(1)} mm) 이상입니다(ka = {ka.toFixed(2)}).
          Gor’kov 근사가 크게 어긋나는 영역이라 결과는 참고용입니다.
        </>
      ) : (
        <>
          공 크기 ka = {ka.toFixed(2)}: Gor’kov 근사는 ka ≪ 1(이 주파수에서 지름 약 {okDia.toFixed(1)} mm 이하)에서 맞습니다. 지금은 그 범위
          밖이라 수치보다 경향을 보세요.
        </>
      )}
    </div>
  );
}
