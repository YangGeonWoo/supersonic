/** 히트맵 색상표 (0..1 → RGB). 순차형(|P|)과 발산형(U, Re P). */

type Stop = [number, number, number, number];

// 순차형: 짙은 남색 → 청록 → 노랑 (viridis 계열 근사)
const SEQ: Stop[] = [
  [0.0, 13, 8, 60],
  [0.25, 59, 82, 139],
  [0.5, 33, 145, 140],
  [0.75, 94, 201, 98],
  [1.0, 253, 231, 37],
];

// 발산형: 파랑 → 흰색에 가까운 회색 → 빨강
const DIV: Stop[] = [
  [0.0, 33, 102, 172],
  [0.25, 103, 169, 207],
  [0.5, 240, 240, 240],
  [0.75, 239, 138, 98],
  [1.0, 178, 24, 43],
];

function buildLut(stops: Stop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const [t0, r0, g0, b0] = stops[j];
    const [t1, r1, g1, b1] = stops[j + 1];
    const u = (t - t0) / (t1 - t0);
    lut[i * 3] = r0 + (r1 - r0) * u;
    lut[i * 3 + 1] = g0 + (g1 - g0) * u;
    lut[i * 3 + 2] = b0 + (b1 - b0) * u;
  }
  return lut;
}

export const LUT_SEQ = buildLut(SEQ);
export const LUT_DIV = buildLut(DIV);

export function lutCss(lut: Uint8ClampedArray, t: number): string {
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
  return `rgb(${lut[i]},${lut[i + 1]},${lut[i + 2]})`;
}
