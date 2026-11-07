/**
 * 3D 뷰 (Three.js). 단위: 1 = 1 mm. 물리 z = 화면 위쪽.
 *
 * 두 가지 계산 방식을 그린다.
 *  - 축대칭 CPU: x-z 격자(= (ρ, z) 반평면 결과)를 x-z, y-z 두 단면에 같은 텍스처로 세운다.
 *  - GPU 3D 격자: 3D 텍스처를 단면 3장·볼륨·덫 등치면 셰이더로 (gpuVisuals.ts). 좌표 Three (X, Y, Z) = 물리 (x, z, −y).
 * 공의 위치/속도는 simRef(또는 sim3Ref)에 있고 rAF 루프에서 진행한다 (React 상태 아님).
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fieldToRGBA, type DisplayMode } from '../components/heatmap';
import { samplePush } from '../physics/field2d';
import { forceAt, makeForceModel } from '../physics/force3';
import type { BallSim3 } from '../sim/ballSim3';
import type { Scene3 } from '../sim/scene3';
import { GpuVisuals, type GpuViewOptions } from './gpuVisuals';
import type { BallSim, BallStatus } from '../sim/ballSim';
import type { Scene } from '../sim/scene';
import { stepBall } from '../state/useSimulation';

export interface View3DOptions {
  /** 단면 표시 */
  planes: boolean;
  /** 단면 불투명도 0~1 */
  opacity: number;
  /** 마디 면 표시 */
  nodes: boolean;
}

interface Props {
  scene: Scene | null;
  simRef: MutableRefObject<BallSim | null>;
  mode: DisplayMode;
  animate: boolean;
  showForces: boolean;
  timeScale: number;
  onStatus: (s: BallStatus) => void;
  options: View3DOptions;
  /** GPU 3D 격자 모드 (scene3가 있으면 이 경로로 그린다) */
  gpu?: {
    scene3: Scene3 | null;
    sim3Ref: MutableRefObject<BallSim3 | null>;
    onStatus3: (s: BallStatus) => void;
    options: GpuViewOptions;
  } | null;
}

const MM = 1e3;
const BODY = 3; // 발생기 몸체 두께 [mm] (그림용)
const ARROW_MAX = 7; // 화살표 최대 길이 [mm]

/** 힘 화살표 길이: √(|F|/F_ref)로 압축 (2D와 같은 규칙) */
function arrowLen(f: number, fRef: number): number {
  return ARROW_MAX * Math.min(1.4, Math.sqrt(f / fRef));
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

export default function View3D(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const wrap = wrapRef.current!;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: !coarse });
    renderer.setPixelRatio(coarse ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    wrap.appendChild(renderer.domElement);
    renderer.domElement.className = 'view3d-canvas';
    renderer.domElement.setAttribute(
      'aria-label',
      '발생기, 음압 단면, 마디, 공의 3D 장면. 드래그 또는 방향키로 회전, 휠 또는 +/− 키로 확대, 0 키로 처음 시점',
    );
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.tabIndex = 0; // 키보드로 조작할 수 있게

    const world = new THREE.Scene();
    const setBg = () => (world.background = new THREE.Color(cssVar('--canvas-bg', '#0d1117')));
    setBg();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', setBg);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1000);
    camera.position.set(30, 20, 37);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 11, 0);

    world.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(30, 60, 40);
    world.add(sun);

    // 발생기 (단위 원기둥을 a_t로 키움)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.3, roughness: 0.6 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.2, roughness: 0.4 });
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 48);
    const lower = new THREE.Mesh(cyl, [bodyMat, faceMat, bodyMat]); // 옆, 윗면, 아랫면
    const upper = new THREE.Mesh(cyl, [bodyMat, bodyMat, faceMat]);
    world.add(lower, upper);

    // 축
    const axisGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
    const axis = new THREE.Line(axisGeom, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    world.add(axis);

    // 단면 2개 (같은 텍스처). 텍스처 행 0 = 위쪽이므로 v를 뒤집는다
    let tex: THREE.DataTexture | null = null;
    let texData: Uint8ClampedArray | null = null;
    const planeMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const planeGeom = new THREE.PlaneGeometry(1, 1);
    const planeXZ = new THREE.Mesh(planeGeom, planeMat);
    const planeYZ = new THREE.Mesh(planeGeom, planeMat);
    planeYZ.rotation.y = Math.PI / 2;
    world.add(planeXZ, planeYZ);

    // 마디 면 (반투명 원판)
    const nodeGroup = new THREE.Group();
    const nodeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    const nodeRing = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    const disc = new THREE.CircleGeometry(1, 64);
    const ring = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 65 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * 2 * Math.PI), 0, Math.sin((i / 64) * 2 * Math.PI))),
    );
    world.add(nodeGroup);

    // 공
    // 공과 화살표는 반투명 단면 뒤에 그려 단면에 가려지지 않게 한다
    // (단면이 공 중심을 지나서 공의 절반이 비쳐 보이면 달걀처럼 길쭉해 보였음)
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, transparent: true, opacity: 1 }),
    );
    ball.renderOrder = 10;
    world.add(ball);

    // 힘 화살표 (공에 작용): 음향 방사력, 중력
    const arrowAcoustic = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0x22d3ee, 1.6, 1);
    const arrowGravity = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 1, 0xf87171, 1.6, 1);
    const arrowPush = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0xfde047, 1.6, 1);
    world.add(arrowAcoustic, arrowGravity, arrowPush);
    for (const a of [arrowAcoustic, arrowGravity, arrowPush]) {
      a.renderOrder = 11;
      a.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) {
          m.transparent = true;
          m.depthTest = false; // 공 안에서 시작하는 화살표도 보이게
        }
        o.renderOrder = 11;
      });
    }

    // 키보드 조작: 방향키 회전, +/− 확대, 0 처음 시점
    const home = { pos: camera.position.clone(), target: controls.target.clone() };
    const sph = new THREE.Spherical();
    const off = new THREE.Vector3();
    const onKey = (e: KeyboardEvent) => {
      const step = THREE.MathUtils.degToRad(e.shiftKey ? 15 : 5);
      off.copy(camera.position).sub(controls.target);
      sph.setFromVector3(off);
      let handled = true;
      if (e.key === 'ArrowLeft') sph.theta -= step;
      else if (e.key === 'ArrowRight') sph.theta += step;
      else if (e.key === 'ArrowUp') sph.phi = Math.max(0.05, sph.phi - step);
      else if (e.key === 'ArrowDown') sph.phi = Math.min(Math.PI - 0.05, sph.phi + step);
      else if (e.key === '+' || e.key === '=') sph.radius = Math.max(controls.minDistance || 5, sph.radius * 0.9);
      else if (e.key === '-' || e.key === '_') sph.radius = Math.min(400, sph.radius / 0.9);
      else if (e.key === '0') {
        camera.position.copy(home.pos);
        controls.target.copy(home.target);
        controls.update();
        e.preventDefault();
        return;
      } else handled = false;
      if (!handled) return;
      e.preventDefault();
      off.setFromSpherical(sph);
      camera.position.copy(controls.target).add(off);
      controls.update();
    };
    renderer.domElement.addEventListener('keydown', onKey);

    // fps 표시 (0.5초마다 DOM 글자만 바꿈, React 상태 아님)
    let fpsFrames = 0;
    let fpsT0 = performance.now();
    const pushF = { fx: 0, fz: 0 };
    // GPU 3D 격자 표시
    const vis = new GpuVisuals(renderer);
    vis.group.visible = false;
    world.add(vis.group);
    const last3 = { status: null as BallStatus | null };
    const f3 = { fx: 0, fy: 0, fz: 0 };
    const p3 = { fx: 0, fy: 0, fz: 0 };
    let builtGpuD = -1;

    let built: Scene | null = null;
    let paintedMode: DisplayMode | null = null;
    const last = { status: null as BallStatus | null };
    const force = { fx: 0, fz: 0 };
    let lastT = performance.now();
    let raf = 0;

    const resize = () => {
      const w = wrap.clientWidth;
      const h = Math.round(Math.min(620, Math.max(360, w * 0.9)));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    /** 장면이 바뀌면 크기·위치·텍스처를 다시 맞춘다 */
    const rebuild = (sc: Scene) => {
      const d = sc.params.d * MM;
      const at = sc.params.at * MM;
      lower.scale.set(at, BODY, at);
      lower.position.set(0, -BODY / 2, 0);
      upper.scale.set(at, BODY, at);
      upper.position.set(0, d + BODY / 2, 0);
      axis.scale.set(1, d, 1);

      const g = sc.field;
      const w = (g.nx - 1) * g.hx * MM;
      const h = (g.nz - 1) * g.hz * MM;
      const cx = (g.x0 + ((g.nx - 1) * g.hx) / 2) * MM;
      const cz = (g.z0 + ((g.nz - 1) * g.hz) / 2) * MM;
      planeXZ.scale.set(w, h, 1);
      planeXZ.position.set(cx, cz, 0);
      planeYZ.scale.set(w, h, 1);
      planeYZ.position.set(0, cz, cx);

      if (!tex || tex.image.width !== g.nx || tex.image.height !== g.nz) {
        tex?.dispose();
        texData = new Uint8ClampedArray(g.nx * g.nz * 4);
        tex = new THREE.DataTexture(texData, g.nx, g.nz, THREE.RGBAFormat);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.repeat.set(1, -1);
        tex.offset.set(0, 1);
        planeMat.map = tex;
        planeMat.needsUpdate = true;
      }

      nodeGroup.clear();
      const r = Math.min(12, Math.max(at * 1.15, 4));
      for (const zn of sc.nodesB) {
        const m = new THREE.Mesh(disc, nodeMat);
        m.rotation.x = -Math.PI / 2;
        m.scale.set(r, r, 1);
        m.position.y = zn * MM;
        const l = new THREE.Line(ring, nodeRing);
        l.scale.set(r, 1, r);
        l.position.y = zn * MM;
        nodeGroup.add(m, l);
      }

      if (!built || Math.abs(built.params.d - sc.params.d) > 1e-6) controls.target.set(0, d / 2, 0);
      built = sc;
      paintedMode = null;
    };

    const frame = (tNow: number) => {
      raf = requestAnimationFrame(frame);
      fpsFrames++;
      if (tNow - fpsT0 >= 500) {
        const el = fpsRef.current;
        if (el) el.textContent = `${Math.round((fpsFrames * 1000) / (tNow - fpsT0))} fps`;
        fpsFrames = 0;
        fpsT0 = tNow;
      }
      const realDt = Math.min(0.1, (tNow - lastT) / 1000);
      lastT = tNow;
      const { scene: sc, simRef, mode, animate, showForces, timeScale, onStatus, options, gpu } = live.current;
      const sc3 = gpu?.scene3 ?? null;
      vis.group.visible = !!sc3;
      if (gpu && sc3) {
        drawGpu(sc3, gpu, mode, animate, showForces, timeScale, realDt, tNow);
        controls.update();
        renderer.render(world, camera);
        return;
      }
      upper.rotation.x = 0;
      axis.visible = true;
      stepBall(simRef, realDt, timeScale, sc, last, onStatus);

      if (sc) {
        if (sc !== built) rebuild(sc);
        const instant = mode === 'instant';
        if (tex && texData && (paintedMode !== mode || instant)) {
          const phase = instant && animate ? 2 * Math.PI * (tNow / 1000) : 0; // 시각화용 1 Hz
          fieldToRGBA(sc, mode, phase, texData);
          tex.needsUpdate = true;
          paintedMode = mode;
        }
        planeXZ.visible = planeYZ.visible = options.planes;
        planeMat.opacity = options.opacity;
        nodeGroup.visible = options.nodes;

        const sim = simRef.current;
        ball.visible = !!sim;
        arrowAcoustic.visible = arrowGravity.visible = arrowPush.visible = false;
        if (sim) {
          const st = sim.state;
          const a = sc.particle.a * MM;
          ball.scale.setScalar(a);
          ball.position.set(st.x * MM, st.z * MM, 0);
          if (showForces && sim.status !== 'escaped') {
            sim.dyn.force(st.x, st.z, force);
            const fRef = Math.max(sc.Fmax, sc.weight, 1e-12);
            const fa = Math.hypot(force.fx, force.fz);
            if (fa > 0) {
              arrowAcoustic.position.copy(ball.position);
              arrowAcoustic.setDirection(new THREE.Vector3(force.fx / fa, force.fz / fa, 0));
              const L = a + arrowLen(fa, fRef);
              arrowAcoustic.setLength(L, Math.min(1.6, L * 0.4), Math.min(1, L * 0.25));
              arrowAcoustic.visible = true;
            }
            // 밀림 성분 (음향 방사력 화살표에 이미 포함된 것을 따로 보여줌)
            if (sc.pushCoeff > 0) {
              samplePush(sc.field, sc.pushCoeff * sc.s * sc.s, st.x, st.z, pushF);
              const fp = Math.hypot(pushF.fx, pushF.fz);
              if (fp > 0) {
                arrowPush.position.copy(ball.position);
                arrowPush.setDirection(new THREE.Vector3(pushF.fx / fp, pushF.fz / fp, 0));
                const Lp = a + arrowLen(fp, fRef);
                arrowPush.setLength(Lp, Math.min(1.6, Lp * 0.4), Math.min(1, Lp * 0.25));
                arrowPush.visible = true;
              }
            }
            const fg = sim.dyn.m * sim.dyn.g;
            arrowGravity.position.copy(ball.position);
            const Lg = a + arrowLen(fg, fRef);
            arrowGravity.setLength(Lg, Math.min(1.6, Lg * 0.4), Math.min(1, Lg * 0.25));
            arrowGravity.visible = true;
          }
        }
      }
      controls.update();
      renderer.render(world, camera);
    };
    /** GPU 3D 격자 모드 한 프레임 */
    const drawGpu = (
      sc3: Scene3,
      gpu: NonNullable<Props['gpu']>,
      mode: DisplayMode,
      animate: boolean,
      showForces: boolean,
      timeScale: number,
      realDt: number,
      tNow: number,
    ) => {
      const sim = gpu.sim3Ref.current;
      if (sim) {
        sim.advanceFrame(realDt, timeScale, sc3);
        if (sim.status !== last3.status) {
          last3.status = sim.status;
          gpu.onStatus3(sim.status);
        }
      }
      // CPU 표시는 숨김
      planeXZ.visible = planeYZ.visible = false;
      nodeGroup.visible = false;
      axis.visible = false;

      // 발생기: 위 발생기는 기울기 θ(x축 둘레)와 x 어긋남
      const p = sc3.params;
      const d = p.d * MM;
      const at = p.at * MM;
      lower.scale.set(at, BODY, at);
      lower.position.set(0, -BODY / 2, 0);
      upper.scale.set(at, BODY, at);
      upper.rotation.x = p.tilt;
      upper.position.set(p.offset * MM, d + (BODY / 2) * Math.cos(p.tilt), (BODY / 2) * Math.sin(p.tilt));
      if (builtGpuD !== p.d) {
        controls.target.set(0, d / 2, 0);
        builtGpuD = p.d;
      }

      const phase = mode === 'instant' && animate ? 2 * Math.PI * (tNow / 1000) : 0;
      vis.update(sc3, mode, phase, gpu.options);

      ball.visible = !!sim;
      arrowAcoustic.visible = arrowGravity.visible = arrowPush.visible = false;
      if (!sim) return;
      const st = sim.state;
      const a = sc3.particle.a * MM;
      ball.scale.setScalar(a);
      ball.position.set(st.x * MM, st.z * MM, -st.y * MM);
      if (!showForces || sim.status === 'escaped') return;
      const fRef = Math.max(sc3.Fmax, sc3.weight, 1e-12);
      sim.dyn.force(st.x, st.y, st.z, f3);
      const fa = Math.hypot(f3.fx, f3.fy, f3.fz);
      if (fa > 0) {
        arrowAcoustic.position.copy(ball.position);
        arrowAcoustic.setDirection(new THREE.Vector3(f3.fx / fa, f3.fz / fa, -f3.fy / fa));
        const L = a + arrowLen(fa, fRef);
        arrowAcoustic.setLength(L, Math.min(1.6, L * 0.4), Math.min(1, L * 0.25));
        arrowAcoustic.visible = true;
      }
      if (sc3.pushCoeff > 0) {
        // 밀림 성분만: Gor'kov 항을 뺀 모델(V = 0)로 계산
        const pm = makeForceModel(sc3.grid, sc3.med, sc3.s * sc3.s, 0, 0, 0, sc3.pushCoeff);
        forceAt(pm, st.x, st.y, st.z, p3);
        const fp = Math.hypot(p3.fx, p3.fy, p3.fz);
        if (fp > 0) {
          arrowPush.position.copy(ball.position);
          arrowPush.setDirection(new THREE.Vector3(p3.fx / fp, p3.fz / fp, -p3.fy / fp));
          const Lp = a + arrowLen(fp, fRef);
          arrowPush.setLength(Lp, Math.min(1.6, Lp * 0.4), Math.min(1, Lp * 0.25));
          arrowPush.visible = true;
        }
      }
      const fg = sim.dyn.m * sim.dyn.g;
      arrowGravity.position.copy(ball.position);
      const Lg = a + arrowLen(fg, fRef);
      arrowGravity.setLength(Lg, Math.min(1.6, Lg * 0.4), Math.min(1, Lg * 0.25));
      arrowGravity.visible = true;
    };

    raf = requestAnimationFrame(frame);

    return () => {
      vis.dispose();
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener('change', setBg);
      renderer.domElement.removeEventListener('keydown', onKey);
      controls.dispose();
      renderer.dispose();
      tex?.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div ref={wrapRef} className="view3d-wrap">
      <span ref={fpsRef} className="fps" aria-hidden="true" title="화면 갱신 속도 (이 기기 기준)" />
    </div>
  );
}
