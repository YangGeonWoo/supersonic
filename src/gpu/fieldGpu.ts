/**
 * GPU(WebGL2, GLSL) 3D 격자 음향장 계산.
 *
 * 복셀 하나 = 프래그먼트 하나. 점음원 전체(거울상 포함)를 반복해 P와 ∇P를 해석식으로 합산하고
 * (CPU evalField와 같은 식), 결과를 MRT 텍스처 2장에 쓴다:
 *   A = (Re P, Im P, |∇P|², 0),  B = (I_x, I_y, I_z, 0)   (s = 1 기준, I = Im(P*∇P)/(2ωρ0))
 * 3D 격자는 2D 텍스처 한 장에 z층을 타일로 늘어놓는다(아틀라스). 층마다 따로 그려 한 번의 draw가
 * 너무 길어지지 않게 한다(GPU 시간 제한). 끝나면 CPU로 한 번 읽어 Grid3로 만든다.
 *
 * 무거운 합산(복셀 × 점음원)만 GPU가 하고, 힘·덫·공 운동은 CPU(force3.ts)가 같은 Grid3로 계산한다.
 */
import * as THREE from 'three';
import type { Medium } from '../physics/acoustics';
import { allocGrid3, type Grid3, type GridDims } from '../physics/grid3';
import type { SourceSet } from '../physics/sourceSampling';

const VERT = /* glsl */ `
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uSrc;   // 너비 = 점음원 수, 높이 2: (x, y, z, cRe), (cIm, nx, ny, nz)
uniform int uN;
uniform float uK;
uniform int uDir;         // 지향성 (1 + n·r̂)/2 사용 여부
uniform ivec2 uTile;      // 이 z층 타일의 왼쪽 아래 픽셀
uniform ivec2 uDimXY;     // nx, ny
uniform vec3 uOrigin;     // 이 z층의 (x0, y0, z) [m]
uniform vec2 uH;          // hx, hy [m]
uniform float uIc;        // 1/(2ωρ0)

layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) - uTile;
  if (p.x < 0 || p.y < 0 || p.x >= uDimXY.x || p.y >= uDimXY.y) discard;
  vec3 r = uOrigin + vec3(float(p.x) * uH.x, float(p.y) * uH.y, 0.0);

  vec2 P = vec2(0.0);
  vec2 gx = vec2(0.0);
  vec2 gy = vec2(0.0);
  vec2 gz = vec2(0.0);
  for (int j = 0; j < uN; j++) {
    vec4 a = texelFetch(uSrc, ivec2(j, 0), 0);
    vec4 b = texelFetch(uSrc, ivec2(j, 1), 0);
    vec3 d = r - a.xyz;
    float R = length(d);
    float invR = 1.0 / R;
    float kR = uK * R;
    float c = cos(kR) * invR;
    float s = sin(kR) * invR;
    vec2 Pj = vec2(a.w * c - b.x * s, a.w * s + b.x * c);
    // ∇P_j = P_j·(ik − 1/R)·d/R
    vec2 q = vec2(-Pj.x * invR * invR - Pj.y * uK * invR, Pj.x * uK * invR - Pj.y * invR * invR);
    vec2 ax = q * d.x;
    vec2 ay = q * d.y;
    vec2 az = q * d.z;
    if (uDir == 1) {
      vec3 n = b.yzw;
      float nd = dot(n, d);
      float D = 0.5 * (1.0 + nd * invR);
      float invR3 = invR * invR * invR;
      vec3 h = 0.5 * (n * invR - nd * d * invR3);
      ax = D * ax + Pj * h.x;
      ay = D * ay + Pj * h.y;
      az = D * az + Pj * h.z;
      Pj *= D;
    }
    P += Pj;
    gx += ax;
    gy += ay;
    gz += az;
  }
  float g2 = dot(gx, gx) + dot(gy, gy) + dot(gz, gz);
  // I = Im(P*·∇P)/(2ωρ0)
  vec3 I = vec3(P.x * gx.y - P.y * gx.x, P.x * gy.y - P.y * gy.x, P.x * gz.y - P.y * gz.x) * uIc;
  oA = vec4(P, g2, 0.0);
  oB = vec4(I, 0.0);
}
`;

export interface GpuResult {
  grid: Grid3;
  /** 그리기 + 읽기 시간 [ms] */
  ms: number;
}

/** 점음원 좌표를 GPU에 넘길 때 단위를 mm로 (float32 정밀도에 유리: 값이 1 근처) */
const UNIT = 1e3;

export class GpuField {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.RawShaderMaterial;
  private target: THREE.WebGLRenderTarget | null = null;
  private srcTex: THREE.DataTexture | null = null;
  readonly maxTex: number;

  private constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.maxTex = renderer.capabilities.maxTextureSize;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSrc: { value: null },
        uN: { value: 0 },
        uK: { value: 0 },
        uDir: { value: 0 },
        uTile: { value: new THREE.Vector2(0, 0) },
        uDimXY: { value: new THREE.Vector2(0, 0) },
        uOrigin: { value: new THREE.Vector3() },
        uH: { value: new THREE.Vector2() },
        uIc: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** WebGL2와 float 렌더 타깃(EXT_color_buffer_float)이 되면 만들고, 아니면 null (축대칭 CPU로 대체) */
  static create(): GpuField | null {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!renderer.extensions.has('EXT_color_buffer_float')) {
        renderer.dispose();
        return null;
      }
      renderer.autoClear = false;
      return new GpuField(renderer);
    } catch {
      return null;
    }
  }

  /**
   * 격자 g에서 음향장 계산. 단위: 셰이더 안은 mm (k도 1/mm), 결과는 SI로 되돌린다.
   *   P [s=1 기준, 계수 단위 m²/m] : 셰이더 계수를 mm²로 넣고 1/R을 1/mm로 계산 → P_SI = P_mm · (1e-6 / 1e-3) = P_mm·1e-3
   */
  async compute(src: SourceSet, med: Medium, g: GridDims, directivity: boolean): Promise<GpuResult> {
    const t0 = performance.now();
    const cols = Math.ceil(Math.sqrt(g.nz));
    const rows = Math.ceil(g.nz / cols);
    const W = g.nx * cols;
    const H = g.ny * rows;
    if (W > this.maxTex || H > this.maxTex) throw new Error(`격자가 GPU 텍스처 한계(${this.maxTex})보다 큼`);

    // 점음원 텍스처 (mm 단위, 면적 계수는 mm²)
    const n = src.n;
    const data = new Float32Array(n * 2 * 4);
    for (let j = 0; j < n; j++) {
      data[j * 4 + 0] = src.x[j] * UNIT;
      data[j * 4 + 1] = src.y[j] * UNIT;
      data[j * 4 + 2] = src.z[j] * UNIT;
      data[j * 4 + 3] = src.cRe[j] * UNIT * UNIT;
      const o = (n + j) * 4;
      data[o + 0] = src.cIm[j] * UNIT * UNIT;
      data[o + 1] = src.nx[j];
      data[o + 2] = src.ny[j];
      data[o + 3] = src.nz[j];
    }
    this.srcTex?.dispose();
    this.srcTex = new THREE.DataTexture(data, n, 2, THREE.RGBAFormat, THREE.FloatType);
    this.srcTex.minFilter = this.srcTex.magFilter = THREE.NearestFilter;
    this.srcTex.needsUpdate = true;

    if (!this.target || this.target.width !== W || this.target.height !== H) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(W, H, {
        count: 2,
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
      });
    }
    const u = this.material.uniforms;
    u.uSrc.value = this.srcTex;
    u.uN.value = n;
    u.uK.value = med.k / UNIT;
    u.uDir.value = directivity ? 1 : 0;
    u.uDimXY.value.set(g.nx, g.ny);
    u.uH.value.set(g.hx * UNIT, g.hy * UNIT);
    // I = Im(P*∇P)/(2ωρ0): P는 mm 기준 값, ∇는 1/mm → 아래에서 SI로 환산
    u.uIc.value = 1;

    const rt = this.target;
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    for (let iz = 0; iz < g.nz; iz++) {
      const tx = (iz % cols) * g.nx;
      const ty = Math.floor(iz / cols) * g.ny;
      u.uTile.value.set(tx, ty);
      u.uOrigin.value.set(g.x0 * UNIT, g.y0 * UNIT, (g.z0 + iz * g.hz) * UNIT);
      rt.viewport.set(tx, ty, g.nx, g.ny);
      rt.scissor.set(tx, ty, g.nx, g.ny);
      rt.scissorTest = true;
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.scene, this.camera);
    }
    rt.scissorTest = false;
    this.renderer.setRenderTarget(null);

    const bufA = new Float32Array(W * H * 4);
    const bufB = new Float32Array(W * H * 4);
    await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H, bufA, undefined, 0);
    await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H, bufB, undefined, 1);

    // 단위 환산: 셰이더의 P_mm = Σ (ΔA[mm²]) e^{ikR}/R[mm] → P_SI = P_mm · 1e-3
    //           ∇P_mm [1/mm] → ∇P_SI = ∇P_mm · 1e-3 · 1e3 = ∇P_mm
    const pS = 1 / UNIT;
    const gS = 1;
    const iS = (pS * gS) / (2 * med.omega * med.rho0);
    const grid = allocGrid3(g);
    for (let iz = 0; iz < g.nz; iz++) {
      const tx = (iz % cols) * g.nx;
      const ty = Math.floor(iz / cols) * g.ny;
      for (let iy = 0; iy < g.ny; iy++) {
        for (let ix = 0; ix < g.nx; ix++) {
          const o = ((ty + iy) * W + (tx + ix)) * 4;
          const i = (iz * g.ny + iy) * g.nx + ix;
          const pr = bufA[o] * pS;
          const pi = bufA[o + 1] * pS;
          grid.pRe[i] = pr;
          grid.pIm[i] = pi;
          grid.p2[i] = pr * pr + pi * pi;
          grid.g2[i] = bufA[o + 2] * gS * gS;
          grid.Ix[i] = bufB[o] * iS;
          grid.Iy[i] = bufB[o + 1] * iS;
          grid.Iz[i] = bufB[o + 2] * iS;
        }
      }
    }
    return { grid, ms: performance.now() - t0 };
  }

  dispose(): void {
    this.target?.dispose();
    this.srcTex?.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
