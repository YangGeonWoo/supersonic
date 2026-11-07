/**
 * GPU 3D 격자 모드의 표시 (GLSL):
 *  - 3D 텍스처 (P/P_SCALE 실수·허수, U/U_SCALE, 계산 영역 표시)
 *  - 단면 3장 (x-z, y-z, x-y): 셰이더가 3D 텍스처를 직접 샘플, 위치 조절
 *  - 볼륨 렌더링: 레이 마칭으로 |P| 반투명 누적, 또는 덫(U 저점) 등치면
 *  - 덫 표시 (작은 고리)
 *
 * 좌표: Three (X, Y, Z) [mm] = 물리 (x, z, −y) [mm]  (물리 z가 화면 위, 오른손 좌표 유지)
 */
import * as THREE from 'three';
import { LUT_DIV, LUT_SEQ } from '../components/colormap';
import { P_SCALE, type DisplayMode } from '../components/heatmap';
import { energyCoeff } from '../physics/gorkov';
import { potentialGrid } from '../physics/force3';
import type { Scene3 } from '../sim/scene3';

const MM = 1e3;

export type VolumeMode = 'off' | 'amp' | 'traps';

export interface GpuViewOptions {
  /** 단면 표시 */
  sliceXZ: boolean;
  sliceYZ: boolean;
  sliceXY: boolean;
  /** x-y 단면 높이 [m] (null이면 가운데 덫 높이) */
  sliceZ: number | null;
  opacity: number;
  volume: VolumeMode;
  /** 덫 등치면 기준 (U/U_SCALE이 −iso보다 낮은 곳) */
  iso: number;
  traps: boolean;
}

/** 퍼텐셜 색 범위 (2D potentialScale과 같은 규칙) */
export function potentialScale3(sc: Scene3): number {
  return sc.particle.V * energyCoeff(1500, sc.med) * 1.5 * Math.max(sc.particle.f2, 0.1);
}

function lutTexture(lut: Uint8ClampedArray): THREE.DataTexture {
  const d = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    d[i * 4] = lut[i * 3];
    d[i * 4 + 1] = lut[i * 3 + 1];
    d[i * 4 + 2] = lut[i * 3 + 2];
    d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, 256, 1, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const COMMON = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler3D uTex;
uniform sampler2D uLut;
uniform vec3 uMin;     // 물리 영역 최소 [mm]
uniform vec3 uSize;    // 물리 영역 크기 [mm]
uniform int uMode;     // 0 |P|, 1 U, 2 Re P(t)
uniform vec2 uPhase;   // (cos, sin)
vec3 physOf(vec3 w) { return vec3(w.x, -w.z, w.y); }
vec3 uvwOf(vec3 phys) { return (phys - uMin) / uSize; }
bool inside(vec3 uvw) { return all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0))); }
float valueOf(vec4 t) {
  if (uMode == 0) return length(t.rg);
  if (uMode == 1) return 0.5 + 0.5 * t.b;
  return 0.5 + 0.5 * (t.r * uPhase.x + t.g * uPhase.y);
}
`;

const SLICE_VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SLICE_FRAG = /* glsl */ `
${COMMON}
uniform float uOpacity;
in vec3 vWorld;
out vec4 outColor;
void main() {
  vec3 uvw = uvwOf(physOf(vWorld));
  if (!inside(uvw)) discard;
  vec4 t = texture(uTex, uvw);
  if (t.a < 0.5) discard;
  float v = clamp(valueOf(t), 0.0, 1.0);
  outColor = vec4(texture(uLut, vec2(v, 0.5)).rgb, uOpacity);
}
`;

const VOL_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uBoxMin;  // Three 좌표 상자 [mm]
uniform vec3 uBoxMax;
uniform int uVol;      // 1 = |P| 누적, 2 = 덫 등치면
uniform float uIso;
uniform vec3 uVoxel;   // 복셀 크기 (uvw 단위)
in vec3 vWorld;
out vec4 outColor;

vec2 hitBox(vec3 o, vec3 d) {
  vec3 inv = 1.0 / d;
  vec3 t0 = (uBoxMin - o) * inv;
  vec3 t1 = (uBoxMax - o) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

void main() {
  vec3 o = cameraPosition;
  vec3 d = normalize(vWorld - o);
  vec2 th = hitBox(o, d);
  float t0 = max(th.x, 0.0);
  float t1 = th.y;
  if (t1 <= t0) discard;
  const int STEPS = 128;
  float dt = (t1 - t0) / float(STEPS);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < STEPS; i++) {
    vec3 w = o + d * (t0 + (float(i) + 0.5) * dt);
    vec3 uvw = uvwOf(physOf(w));
    if (!inside(uvw)) continue;
    vec4 s = texture(uTex, uvw);
    if (s.a < 0.5) continue;
    if (uVol == 1) {
      float a = clamp(length(s.rg), 0.0, 1.0);
      vec3 c = texture(uLut, vec2(a, 0.5)).rgb;
      float alpha = clamp(a * a * dt * 0.08, 0.0, 1.0);
      acc.rgb += (1.0 - acc.a) * c * alpha;
      acc.a += (1.0 - acc.a) * alpha;
      if (acc.a > 0.97) break;
    } else {
      if (s.b < -uIso) {
        // 등치면: U 기울기로 법선, 간단한 조명
        vec3 g = vec3(
          texture(uTex, uvw + vec3(uVoxel.x, 0.0, 0.0)).b - texture(uTex, uvw - vec3(uVoxel.x, 0.0, 0.0)).b,
          texture(uTex, uvw + vec3(0.0, uVoxel.y, 0.0)).b - texture(uTex, uvw - vec3(0.0, uVoxel.y, 0.0)).b,
          texture(uTex, uvw + vec3(0.0, 0.0, uVoxel.z)).b - texture(uTex, uvw - vec3(0.0, 0.0, uVoxel.z)).b);
        vec3 nPhys = normalize(-g + 1e-6);
        vec3 nW = vec3(nPhys.x, nPhys.z, -nPhys.y);
        float lam = 0.35 + 0.65 * abs(dot(nW, normalize(vec3(0.4, 0.8, 0.5))));
        acc = vec4(vec3(0.18, 0.85, 0.75) * lam, 0.85);
        break;
      }
    }
  }
  if (acc.a <= 0.0) discard;
  outColor = acc;
}
`;

export class GpuVisuals {
  readonly group = new THREE.Group();
  private tex: THREE.Data3DTexture | null = null;
  private texDims = [0, 0, 0];
  private lutSeq = lutTexture(LUT_SEQ);
  private lutDiv = lutTexture(LUT_DIV);
  private sliceMat: THREE.ShaderMaterial;
  private volMat: THREE.ShaderMaterial;
  private sliceXZ: THREE.Mesh;
  private sliceYZ: THREE.Mesh;
  private sliceXY: THREE.Mesh;
  private volume: THREE.Mesh;
  private trapGroup = new THREE.Group();
  private ring: THREE.BufferGeometry;
  private ringMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
  private built: Scene3 | null = null;
  private floatLinear: boolean;

  constructor(renderer: THREE.WebGLRenderer) {
    this.floatLinear = renderer.extensions.has('OES_texture_float_linear');
    const uniforms = () => ({
      uTex: { value: null as THREE.Data3DTexture | null },
      uLut: { value: this.lutSeq as THREE.Texture },
      uMin: { value: new THREE.Vector3() },
      uSize: { value: new THREE.Vector3(1, 1, 1) },
      uMode: { value: 0 },
      uPhase: { value: new THREE.Vector2(1, 0) },
    });
    this.sliceMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SLICE_VERT,
      fragmentShader: SLICE_FRAG,
      uniforms: { ...uniforms(), uOpacity: { value: 0.85 } },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    this.volMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SLICE_VERT,
      fragmentShader: VOL_FRAG,
      uniforms: {
        ...uniforms(),
        uBoxMin: { value: new THREE.Vector3() },
        uBoxMax: { value: new THREE.Vector3() },
        uVol: { value: 1 },
        uIso: { value: 0.6 },
        uVoxel: { value: new THREE.Vector3() },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    const plane = new THREE.PlaneGeometry(1, 1);
    this.sliceXZ = new THREE.Mesh(plane, this.sliceMat); // 물리 y = const → Three Z = const
    this.sliceYZ = new THREE.Mesh(plane, this.sliceMat);
    this.sliceYZ.rotation.y = Math.PI / 2; // 물리 x = const
    this.sliceXY = new THREE.Mesh(plane, this.sliceMat);
    this.sliceXY.rotation.x = -Math.PI / 2; // 물리 z = const (수평)
    this.volume = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.volMat);
    this.volume.renderOrder = 5;
    this.ring = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 49 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * 2 * Math.PI), 0, Math.sin((i / 48) * 2 * Math.PI))),
    );
    this.trapGroup.renderOrder = 9;
    this.group.add(this.sliceXZ, this.sliceYZ, this.sliceXY, this.volume, this.trapGroup);
  }

  /** 장면이 바뀌면 3D 텍스처를 다시 올린다 (U는 공 물성에 따라 달라지므로 장면마다) */
  private upload(sc: Scene3): void {
    const g = sc.grid;
    const N = g.nx * g.ny * g.nz;
    const U = potentialGrid(sc.model);
    const uScale = potentialScale3(sc);
    const s = sc.s / P_SCALE;
    const f32 = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      f32[i * 4] = g.pRe[i] * s;
      f32[i * 4 + 1] = g.pIm[i] * s;
      f32[i * 4 + 2] = U[i] / uScale;
      f32[i * 4 + 3] = g.mask[i];
    }
    let data: Float32Array | Uint16Array = f32;
    let type: THREE.TextureDataType = THREE.FloatType;
    if (!this.floatLinear) {
      // 선형 보간이 되는 half float으로 (값을 정규화해 두었으므로 정밀도 충분)
      const h = new Uint16Array(N * 4);
      for (let i = 0; i < N * 4; i++) h[i] = THREE.DataUtils.toHalfFloat(f32[i]);
      data = h;
      type = THREE.HalfFloatType;
    }
    if (!this.tex || this.texDims[0] !== g.nx || this.texDims[1] !== g.ny || this.texDims[2] !== g.nz || this.tex.type !== type) {
      this.tex?.dispose();
      this.tex = new THREE.Data3DTexture(data, g.nx, g.ny, g.nz);
      this.tex.type = type;
      this.tex.format = THREE.RGBAFormat;
      this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
      this.tex.wrapS = this.tex.wrapT = this.tex.wrapR = THREE.ClampToEdgeWrapping;
      this.tex.unpackAlignment = 1;
      this.texDims = [g.nx, g.ny, g.nz];
    } else {
      this.tex.image.data = data;
    }
    this.tex.needsUpdate = true;

    const min = new THREE.Vector3(g.x0 * MM, g.y0 * MM, g.z0 * MM);
    const size = new THREE.Vector3((g.nx - 1) * g.hx * MM, (g.ny - 1) * g.hy * MM, (g.nz - 1) * g.hz * MM);
    for (const m of [this.sliceMat, this.volMat]) {
      m.uniforms.uTex.value = this.tex;
      m.uniforms.uMin.value.copy(min);
      m.uniforms.uSize.value.copy(size);
    }
    // Three 좌표 상자: X = x, Y = z, Z = −y
    const bmin = new THREE.Vector3(min.x, min.z, -(min.y + size.y));
    const bmax = new THREE.Vector3(min.x + size.x, min.z + size.z, -min.y);
    this.volMat.uniforms.uBoxMin.value.copy(bmin);
    this.volMat.uniforms.uBoxMax.value.copy(bmax);
    this.volMat.uniforms.uVoxel.value.set(1 / (g.nx - 1), 1 / (g.ny - 1), 1 / (g.nz - 1));
    this.volume.scale.set(bmax.x - bmin.x, bmax.y - bmin.y, bmax.z - bmin.z);
    this.volume.position.set((bmin.x + bmax.x) / 2, (bmin.y + bmax.y) / 2, (bmin.z + bmax.z) / 2);

    // 단면 크기 (영역 전체를 덮게; 영역 밖은 셰이더가 버림)
    this.sliceXZ.scale.set(size.x, size.z, 1);
    this.sliceYZ.scale.set(size.y, size.z, 1);
    this.sliceXY.scale.set(size.x, size.y, 1);

    // 덫 고리
    this.trapGroup.clear();
    const r = Math.max(0.8, sc.particle.a * MM * 0.8);
    for (const t of sc.traps) {
      const l = new THREE.Line(this.ring, this.ringMat);
      l.scale.set(r, 1, r);
      l.position.set(t.x * MM, t.z * MM, -t.y * MM);
      l.renderOrder = 9;
      this.trapGroup.add(l);
    }
  }

  update(sc: Scene3, mode: DisplayMode, phase: number, opt: GpuViewOptions): void {
    if (sc !== this.built) {
      this.upload(sc);
      this.built = sc;
    }
    const g = sc.grid;
    const modeI = mode === 'amp' ? 0 : mode === 'potential' ? 1 : 2;
    const lut = mode === 'amp' ? this.lutSeq : this.lutDiv;
    for (const m of [this.sliceMat, this.volMat]) {
      m.uniforms.uMode.value = modeI;
      m.uniforms.uLut.value = m === this.volMat && opt.volume === 'amp' ? this.lutSeq : lut;
      m.uniforms.uPhase.value.set(Math.cos(phase), Math.sin(phase));
    }
    this.sliceMat.uniforms.uOpacity.value = opt.opacity;
    const cx = (g.x0 + ((g.nx - 1) * g.hx) / 2) * MM;
    const cy = (g.y0 + ((g.ny - 1) * g.hy) / 2) * MM;
    const cz = (g.z0 + ((g.nz - 1) * g.hz) / 2) * MM;
    const trap = sc.centralTrap;
    // x-z 단면: 가운데 덫의 y를 지남, y-z 단면: 가운데 덫의 x를 지남
    this.sliceXZ.position.set(cx, cz, -(trap ? trap.y : 0) * MM);
    this.sliceYZ.position.set((trap ? trap.x : 0) * MM, cz, -cy);
    const zSlice = opt.sliceZ ?? (trap ? trap.z : sc.params.d / 2);
    this.sliceXY.position.set(cx, zSlice * MM, -cy);
    this.sliceXZ.visible = opt.sliceXZ;
    this.sliceYZ.visible = opt.sliceYZ;
    this.sliceXY.visible = opt.sliceXY;
    this.volume.visible = opt.volume !== 'off';
    this.volMat.uniforms.uVol.value = opt.volume === 'traps' ? 2 : 1;
    this.volMat.uniforms.uIso.value = opt.iso;
    this.trapGroup.visible = opt.traps;
  }

  dispose(): void {
    this.tex?.dispose();
    this.lutSeq.dispose();
    this.lutDiv.dispose();
    this.sliceMat.dispose();
    this.volMat.dispose();
    this.ring.dispose();
    this.ringMat.dispose();
  }
}
