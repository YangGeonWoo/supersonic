/**
 * 주소로 시작값 지정 (발표용): ?dia=1.2 (공 지름 mm), ?drive=1.5 (구동 세기), ?rho=25 (공 밀도 kg/m³).
 * 슬라이더 범위로 자른다. "모두 기본값으로"도 이 값으로 돌아간다.
 */
import type { SimParams } from '../physics/params';
import { SLIDERS, type NumericKey } from './sliders';

const URL_KEYS: Record<string, NumericKey> = { dia: 'ballDiameter', drive: 'drive', rho: 'rhoP' };

export function applyUrlParams(p: SimParams, search = typeof location !== 'undefined' ? location.search : ''): SimParams {
  const q = new URLSearchParams(search);
  const out = { ...p };
  for (const [name, key] of Object.entries(URL_KEYS)) {
    const raw = q.get(name);
    if (raw === null || raw.trim() === '') continue;
    const ui = Number(raw);
    const s = SLIDERS.find((v) => v.key === key);
    if (!s || !Number.isFinite(ui)) continue;
    (out[key] as number) = s.fromUi(Math.min(s.max, Math.max(s.min, ui)));
  }
  return out;
}
