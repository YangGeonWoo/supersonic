/**
 * 3D 격자에서 힘·퍼텐셜·덫·강성 (축대칭 가정 없음).
 *
 *   U = s²·V·(f1·α − f2·β),  α = |P|²/(4ρ0c²),  β = (3/8)|∇P|²/(ω²ρ0)
 *   F = −∇U  (삼선형 보간한 α, β를 격자 간격으로 중앙 차분 — 2D 격자의 중앙 차분 + 보간과 같은 정확도)
 *     + 진행파 복사압 pushK·I  (pushK = s²·Y_p·πa²/c, 0이면 없음)
 * 계산 영역 밖(격자 밖, 면 근처)은 음향 방사력 0 (SPEC 2.4 규칙).
 */
import type { Medium } from './acoustics';
import { interp, newTrilinear, trilinearAt, type Grid3 } from './grid3';

export interface ForceModel3 {
  grid: Grid3;
  /** 실제 세기의 제곱 s² */
  s2: number;
  V: number;
  f1: number;
  f2: number;
  /** 1/(4ρ0c²), (3/8)/(ω²ρ0) */
  ca: number;
  cb: number;
  /** 진행파 복사압 계수 (s² 포함) */
  pushK: number;
}

export function makeForceModel(grid: Grid3, med: Medium, s2: number, V: number, f1: number, f2: number, pushCoeff: number): ForceModel3 {
  return {
    grid,
    s2,
    V,
    f1,
    f2,
    ca: 1 / (4 * med.rho0 * med.c * med.c),
    cb: 0.375 / (med.omega * med.omega * med.rho0),
    pushK: pushCoeff * s2,
  };
}

const tl = newTrilinear();

/** 점의 퍼텐셜 U (계산 영역 밖이면 NaN) */
export function potentialAt(m: ForceModel3, x: number, y: number, z: number): number {
  if (!trilinearAt(m.grid, x, y, z, tl)) return NaN;
  return m.s2 * m.V * (m.f1 * m.ca * interp(m.grid.p2, tl) - m.f2 * m.cb * interp(m.grid.g2, tl));
}

export interface Vec3 {
  fx: number;
  fy: number;
  fz: number;
}

/** 점의 힘 [N]. 계산 영역 밖이 섞이면 0을 쓰고 false */
export function forceAt(m: ForceModel3, x: number, y: number, z: number, out: Vec3): boolean {
  const g = m.grid;
  const u = (dx: number, dy: number, dz: number) => potentialAt(m, x + dx, y + dy, z + dz);
  const ux1 = u(g.hx, 0, 0);
  const ux0 = u(-g.hx, 0, 0);
  const uy1 = u(0, g.hy, 0);
  const uy0 = u(0, -g.hy, 0);
  const uz1 = u(0, 0, g.hz);
  const uz0 = u(0, 0, -g.hz);
  if (!(ux1 === ux1 && ux0 === ux0 && uy1 === uy1 && uy0 === uy0 && uz1 === uz1 && uz0 === uz0)) {
    out.fx = 0;
    out.fy = 0;
    out.fz = 0;
    return false;
  }
  out.fx = -(ux1 - ux0) / (2 * g.hx);
  out.fy = -(uy1 - uy0) / (2 * g.hy);
  out.fz = -(uz1 - uz0) / (2 * g.hz);
  if (m.pushK !== 0 && trilinearAt(g, x, y, z, tl)) {
    out.fx += m.pushK * interp(g.Ix, tl);
    out.fy += m.pushK * interp(g.Iy, tl);
    out.fz += m.pushK * interp(g.Iz, tl);
  }
  return true;
}

/** 표시용 퍼텐셜 격자 (영역 밖은 0) */
export function potentialGrid(m: ForceModel3): Float32Array {
  const g = m.grid;
  const N = g.nx * g.ny * g.nz;
  const U = new Float32Array(N);
  const k1 = m.s2 * m.V * m.f1 * m.ca;
  const k2 = m.s2 * m.V * m.f2 * m.cb;
  for (let i = 0; i < N; i++) U[i] = g.mask[i] ? k1 * g.p2[i] - k2 * g.g2[i] : 0;
  return U;
}

/** 3×3 강성 행렬 K_ij = −∂F_i/∂x_j (중앙 차분, 간격 δ) */
export function stiffnessMatrix(m: ForceModel3, x: number, y: number, z: number, delta: number): number[][] | null {
  const a: Vec3 = { fx: 0, fy: 0, fz: 0 };
  const b: Vec3 = { fx: 0, fy: 0, fz: 0 };
  const K = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const steps: [number, number, number][] = [
    [delta, 0, 0],
    [0, delta, 0],
    [0, 0, delta],
  ];
  for (let j = 0; j < 3; j++) {
    const [dx, dy, dz] = steps[j];
    if (!forceAt(m, x + dx, y + dy, z + dz, a) || !forceAt(m, x - dx, y - dy, z - dz, b)) return null;
    K[0][j] = -(a.fx - b.fx) / (2 * delta);
    K[1][j] = -(a.fy - b.fy) / (2 * delta);
    K[2][j] = -(a.fz - b.fz) / (2 * delta);
  }
  return K;
}

/** 3×3 일차연립 풀이 (가우스 소거) */
function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-30) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/**
 * 덫(힘 평형점) 찾기: 중력 없이 F = 0 (gravity를 주면 F = (0, 0, mg)), guess에서 뉴턴 반복.
 * 각 단계 이동은 격자 간격 2배로 제한.
 */
export function findTrap3(
  m: ForceModel3,
  guess: { x: number; y: number; z: number },
  weight = 0,
): { x: number; y: number; z: number } | null {
  const g = m.grid;
  const p = { ...guess };
  const F: Vec3 = { fx: 0, fy: 0, fz: 0 };
  const h = Math.min(g.hx, g.hy, g.hz);
  for (let it = 0; it < 30; it++) {
    if (!forceAt(m, p.x, p.y, p.z, F)) return null;
    const K = stiffnessMatrix(m, p.x, p.y, p.z, h * 0.5);
    if (!K) return null;
    const step = solve3(K, [F.fx, F.fy, F.fz - weight]);
    if (!step) return null;
    const len = Math.hypot(step[0], step[1], step[2]);
    const sc = len > 2 * h ? (2 * h) / len : 1;
    p.x += step[0] * sc;
    p.y += step[1] * sc;
    p.z += step[2] * sc;
    if (len < 1e-9) break;
  }
  return p;
}

export interface LateralStiffness {
  /** 옆 방향 2×2 강성의 대칭 부분 고유값 (작은 것, 큰 것) [N/m] */
  kMin: number;
  kMax: number;
  /** kMin 주축 방향 (x축에서 잰 각도) [rad] */
  angleMin: number;
  /** 위아래 강성 −∂F_z/∂z [N/m] */
  kz: number;
  /** 전체 3×3 행렬 */
  K: number[][];
}

/** 덫에서 옆 방향 강성 행렬의 고유값·주축 */
export function lateralStiffness3(m: ForceModel3, p: { x: number; y: number; z: number }): LateralStiffness | null {
  const g = m.grid;
  const K = stiffnessMatrix(m, p.x, p.y, p.z, Math.min(g.hx, g.hy, g.hz) * 0.5);
  if (!K) return null;
  const a = K[0][0];
  const d = K[1][1];
  const b = 0.5 * (K[0][1] + K[1][0]); // 대칭 부분 (밀림 항은 비보존이라 약간 비대칭일 수 있음)
  const tr = 0.5 * (a + d);
  const disc = Math.sqrt(0.25 * (a - d) * (a - d) + b * b);
  const kMin = tr - disc;
  const kMax = tr + disc;
  // kMin 고유벡터 각도
  const angleMin = Math.abs(b) < 1e-30 ? (a <= d ? 0 : Math.PI / 2) : Math.atan2(kMin - a, b);
  return { kMin, kMax, angleMin, kz: K[2][2], K };
}
