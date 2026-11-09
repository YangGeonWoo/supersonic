/**
 * GPU 3D 격자 모드의 3D 장 표시 (GLSL 레이 마칭):
 *  - 3D 텍스처 (P/P_SCALE 실수·허수, U/U_SCALE, 계산 영역 표시)
 *  - 볼륨: 표시 모드(|P| / U / Re P(t))의 값이 큰 곳을 반투명하게 누적
 *  - 등치면: 같은 값을 기준값에서 불투명한 면으로 (|P| 배 덩어리, U 덫, ±Re P 껍질)
 *  - 절반 자르기: 가운데 덫을 지나는 x-z 면에서 카메라 쪽 절반을 잘라 속을 본다
 *  - 공 가림: 광선이 공에 닿으면 거기서 멈춘다 (공 뒤의 장이 공 위에 덧그려지지 않게)
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

export type FieldStyle = 'volume' | 'iso';

export interface GpuViewOptions {
  /** 볼륨(반투명 누적) 또는 등치면 */
  style: FieldStyle;
  /** 기준값 0~1: 볼륨은 이보다 큰 곳이 진하게, 등치면은 이 값의 면 */
  level: number;
  /** 볼륨 진하기 배수 */
  density: number;
  /** 가운데 덫을 지나는 x-z 면에서 카메라 쪽 절반을 자름 */
  cut: boolean;
  traps: boolean;
}

/** 공 (Three 좌표 [mm]) — 광선을 공에서 멈추게 함 */
export interface BallMark {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** 퍼텐셜 색 범위 (2D potentialScale과 같은 규칙) */
export function potentialScale3(sc: Scene3): number {
  return sc.particle.V * energyCoeff(1500, sc.med) * 1.5 * Math.max(sc.particle.f2, 0.1);
}

/** 색상표 텍스처. sRGB 바이트를 그대로 쓰고 그대로 내보낸다 (2D 히트맵과 같은 색) */
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
  t.needsUpdate = true;
  return t;
}

const VOL_VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const VOL_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler3D uTex;
uniform sampler2D uLut;
uniform vec3 uMin;     // 물리 영역 최소 [mm]
uniform vec3 uSize;    // 물리 영역 크기 [mm]
uniform int uMode;     // 0 |P|, 1 U, 2 Re P(t)
uniform vec2 uPhase;   // (cos, sin)
uniform vec3 uBoxMin;  // Three 좌표 상자 [mm]
uniform vec3 uBoxMax;
uniform int uStyle;    // 0 볼륨, 1 등치면
uniform float uLevel;
uniform float uDensity;
uniform vec3 uVoxel;   // 복셀 크기 (uvw 단위)
uniform float uStep;   // 레이 스텝 [mm]
uniform vec4 uBall;    // 공 중심(Three 좌표)과 반지름 [mm], 반지름 0이면 없음
uniform float uCut;    // 0 = 자르지 않음, ±1 = 남길 쪽 (Three Z 방향 부호)
uniform float uCutZ;   // 자르는 면 (Three Z) [mm]
in vec3 vWorld;
out vec4 outColor;

const int MAX_STEPS = 400;

vec3 physOf(vec3 w) { return vec3(w.x, -w.z, w.y); }
vec3 uvwOf(vec3 w) { return (physOf(w) - uMin) / uSize; }

/** 표시 모드 값: (색상표 위치 0~1, 세기 g ≥ 0). 등치면은 g = 기준값인 면 */
vec2 sampleField(vec3 uvw) {
  vec4 t = texture(uTex, uvw);
  if (t.a < 0.5) return vec2(0.5, -1.0); // 계산 안 한 영역
  if (uMode == 0) {
    float a = length(t.rg);
    return vec2(clamp(a, 0.0, 1.0), a);
  }
  if (uMode == 1) return vec2(clamp(0.5 + 0.5 * t.b, 0.0, 1.0), -t.b); // 덫 = U 저점
  float q = t.r * uPhase.x + t.g * uPhase.y;
  return vec2(clamp(0.5 + 0.5 * q, 0.0, 1.0), abs(q));
}

float strength(vec3 uvw) { return sampleField(uvw).y; }

vec2 hitBox(vec3 o, vec3 d) {
  vec3 inv = 1.0 / d;
  vec3 t0 = (uBoxMin - o) * inv;
  vec3 t1 = (uBoxMax - o) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

/** 등치면 색: 모드별 */
vec3 isoColor(vec3 uvw, float lutPos) {
  if (uMode == 0) return texture(uLut, vec2(clamp(uLevel + 0.2, 0.0, 1.0), 0.5)).rgb;
  if (uMode == 1) return vec3(0.18, 0.85, 0.75);
  return texture(uLut, vec2(lutPos > 0.5 ? 0.92 : 0.08, 0.5)).rgb;
}

void main() {
  vec3 o = cameraPosition;
  vec3 d = normalize(vWorld - o);
  vec2 th = hitBox(o, d);
  float t0 = max(th.x, 0.0);
  float t1 = th.y;
  // 절반 자르기: Three Z가 (uCutZ 기준) uCut 쪽인 절반만 남긴다
  bool cutEntry = false;
  if (uCut != 0.0) {
    float dz = d.z * uCut;
    float tc = abs(d.z) > 1e-6 ? (uCutZ - o.z) / d.z : -1e30;
    if (abs(d.z) <= 1e-6) {
      if ((o.z - uCutZ) * uCut < 0.0) discard;
    } else if (dz > 0.0) {
      if (tc > t0) { t0 = tc; cutEntry = true; }
    } else {
      t1 = min(t1, tc);
    }
  }
  // 공에서 멈춤
  if (uBall.w > 0.0) {
    vec3 oc = o - uBall.xyz;
    float b = dot(oc, d);
    float c = dot(oc, oc) - uBall.w * uBall.w;
    float h = b * b - c;
    if (h > 0.0) {
      float tb = -b - sqrt(h);
      if (tb > 0.0) t1 = min(t1, tb);
    }
  }
  if (t1 <= t0) discard;

  // 등치면은 이분법으로 다듬으므로 스텝을 볼륨보다 크게 (복셀 약 1.1배)
  float stepLen = uStyle == 0 ? uStep : uStep * 1.6;
  int n = int(min(float(MAX_STEPS), ceil((t1 - t0) / stepLen)));
  float dt = (t1 - t0) / float(max(n, 1));
  float jitter = hash(gl_FragCoord.xy);

  if (uStyle == 0) {
    // 볼륨: 앞에서 뒤로 누적 (premultiplied)
    vec4 acc = vec4(0.0);
    float k = uDensity * 0.3 * dt / uStep;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= n) break;
      vec3 w = o + d * (t0 + (float(i) + jitter) * dt);
      vec2 s = sampleField(uvwOf(w));
      if (s.y < 0.0) continue;
      float wgt = smoothstep(uLevel - 0.25, uLevel + 0.25, s.y);
      if (wgt <= 0.0) continue;
      float alpha = 1.0 - exp(-k * wgt * (0.4 + s.y));
      vec3 c = texture(uLut, vec2(s.x, 0.5)).rgb;
      acc.rgb += (1.0 - acc.a) * c * alpha;
      acc.a += (1.0 - acc.a) * alpha;
      if (acc.a > 0.98) break;
    }
    if (acc.a <= 0.002) discard;
    outColor = acc;
    return;
  }

  // 등치면: 세기 g가 기준값을 넘는 첫 지점, 이분법으로 다듬기
  float tPrev = t0;
  for (int i = 0; i <= MAX_STEPS; i++) {
    if (i > n) break;
    float t = t0 + (i == 0 ? 0.0 : (float(i) - 1.0 + jitter) * dt);
    t = min(t, t1);
    vec3 uvw = uvwOf(o + d * t);
    float f = strength(uvw) - uLevel;
    if (f >= 0.0) {
      vec3 col;
      vec3 nW;
      if (i == 0) {
        // 상자/자르는 면에 들어서자마자 안쪽: 단면 뚜껑을 값 색으로 칠함
        vec2 s = sampleField(uvw);
        col = cutEntry ? texture(uLut, vec2(s.x, 0.5)).rgb : isoColor(uvw, s.x);
        nW = cutEntry ? vec3(0.0, 0.0, -uCut) : -d;
      } else {
        float a = tPrev, b = t;
        for (int j = 0; j < 5; j++) {
          float m = 0.5 * (a + b);
          if (strength(uvwOf(o + d * m)) - uLevel >= 0.0) b = m; else a = m;
        }
        uvw = uvwOf(o + d * b);
        vec3 g = vec3(
          strength(uvw + vec3(uVoxel.x, 0.0, 0.0)) - strength(uvw - vec3(uVoxel.x, 0.0, 0.0)),
          strength(uvw + vec3(0.0, uVoxel.y, 0.0)) - strength(uvw - vec3(0.0, uVoxel.y, 0.0)),
          strength(uvw + vec3(0.0, 0.0, uVoxel.z)) - strength(uvw - vec3(0.0, 0.0, uVoxel.z)));
        vec3 nPhys = normalize(-g + 1e-6);
        nW = vec3(nPhys.x, nPhys.z, -nPhys.y);
        col = isoColor(uvw, sampleField(uvw).x);
      }
      if (dot(nW, d) > 0.0) nW = -nW;
      float lam = 0.35 + 0.55 * max(dot(nW, normalize(vec3(0.4, 0.8, 0.5))), 0.0) + 0.25 * max(dot(nW, -d), 0.0);
      float rim = pow(1.0 - max(dot(nW, -d), 0.0), 3.0) * 0.25;
      outColor = vec4(min(col * lam + rim, vec3(1.0)), 1.0);
      return;
    }
    tPrev = t;
  }
  discard;
}
`;

export class GpuVisuals {
  readonly group = new THREE.Group();
  private tex: THREE.Data3DTexture | null = null;
  private texDims = [0, 0, 0];
  private lutSeq = lutTexture(LUT_SEQ);
  private lutDiv = lutTexture(LUT_DIV);
  private volMat: THREE.ShaderMaterial;
  private volume: THREE.Mesh;
  private trapGroup = new THREE.Group();
  private ring: THREE.BufferGeometry;
  private ringMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
  private built: Scene3 | null = null;
  private floatLinear: boolean;

  constructor(renderer: THREE.WebGLRenderer) {
    this.floatLinear = renderer.extensions.has('OES_texture_float_linear');
    this.volMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VOL_VERT,
      fragmentShader: VOL_FRAG,
      uniforms: {
        uTex: { value: null as THREE.Data3DTexture | null },
        uLut: { value: this.lutSeq as THREE.Texture },
        uMin: { value: new THREE.Vector3() },
        uSize: { value: new THREE.Vector3(1, 1, 1) },
        uMode: { value: 0 },
        uPhase: { value: new THREE.Vector2(1, 0) },
        uBoxMin: { value: new THREE.Vector3() },
        uBoxMax: { value: new THREE.Vector3() },
        uStyle: { value: 0 },
        uLevel: { value: 0.5 },
        uDensity: { value: 1 },
        uVoxel: { value: new THREE.Vector3() },
        uStep: { value: 0.3 },
        uBall: { value: new THREE.Vector4() },
        uCut: { value: 0 },
        uCutZ: { value: 0 },
      },
      side: THREE.BackSide, // 카메라가 상자 안에 들어가도 그려지게
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
    this.volume = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.volMat);
    this.volume.renderOrder = 5;
    this.ring = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 49 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * 2 * Math.PI), 0, Math.sin((i / 48) * 2 * Math.PI))),
    );
    this.trapGroup.renderOrder = 9;
    this.group.add(this.volume, this.trapGroup);
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

    const u = this.volMat.uniforms;
    const min = new THREE.Vector3(g.x0 * MM, g.y0 * MM, g.z0 * MM);
    const size = new THREE.Vector3((g.nx - 1) * g.hx * MM, (g.ny - 1) * g.hy * MM, (g.nz - 1) * g.hz * MM);
    u.uTex.value = this.tex;
    u.uMin.value.copy(min);
    u.uSize.value.copy(size);
    // Three 좌표 상자: X = x, Y = z, Z = −y
    const bmin = new THREE.Vector3(min.x, min.z, -(min.y + size.y));
    const bmax = new THREE.Vector3(min.x + size.x, min.z + size.z, -min.y);
    u.uBoxMin.value.copy(bmin);
    u.uBoxMax.value.copy(bmax);
    u.uVoxel.value.set(1 / (g.nx - 1), 1 / (g.ny - 1), 1 / (g.nz - 1));
    // 스텝: 가장 작은 복셀의 0.7배
    u.uStep.value = 0.7 * Math.min(g.hx, g.hy, g.hz) * MM;
    this.volume.scale.set(bmax.x - bmin.x, bmax.y - bmin.y, bmax.z - bmin.z);
    this.volume.position.set((bmin.x + bmax.x) / 2, (bmin.y + bmax.y) / 2, (bmin.z + bmax.z) / 2);

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

  update(sc: Scene3, mode: DisplayMode, phase: number, opt: GpuViewOptions, camera: THREE.Camera, ball: BallMark | null): void {
    if (sc !== this.built) {
      this.upload(sc);
      this.built = sc;
    }
    const u = this.volMat.uniforms;
    u.uMode.value = mode === 'amp' ? 0 : mode === 'potential' ? 1 : 2;
    u.uLut.value = mode === 'amp' ? this.lutSeq : this.lutDiv;
    u.uPhase.value.set(Math.cos(phase), Math.sin(phase));
    u.uStyle.value = opt.style === 'iso' ? 1 : 0;
    u.uLevel.value = opt.level;
    u.uDensity.value = opt.density;
    if (ball) u.uBall.value.set(ball.x, ball.y, ball.z, ball.r);
    else u.uBall.value.set(0, 0, 0, 0);
    // 자르기: 가운데 덫을 지나는 x-z 면(물리 y = 덫 y)에서 카메라 반대쪽 절반만 남긴다
    const trap = sc.centralTrap;
    const cutZ = -(trap ? trap.y : 0) * MM;
    u.uCutZ.value = cutZ;
    u.uCut.value = opt.cut ? (camera.position.z > cutZ ? -1 : 1) : 0;
    this.trapGroup.visible = opt.traps;
  }

  dispose(): void {
    this.tex?.dispose();
    this.lutSeq.dispose();
    this.lutDiv.dispose();
    this.volMat.dispose();
    this.ring.dispose();
    this.ringMat.dispose();
  }
}
