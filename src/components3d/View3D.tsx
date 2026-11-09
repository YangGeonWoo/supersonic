/**
 * 3D 뷰 (Three.js). 단위: 1 = 1 mm. 물리 z = 화면 위쪽.
 *
 * GPU 3D 격자 결과(3D 텍스처)를 볼륨 또는 등치면으로 그린다 (gpuVisuals.ts).
 * 좌표 Three (X, Y, Z) = 물리 (x, z, −y).
 * 공의 위치/속도는 sim3Ref에 있고 rAF 루프에서 진행한다 (React 상태 아님).
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DisplayMode } from '../components/heatmap';
import { forceAt, makeForceModel } from '../physics/force3';
import type { BallStatus } from '../sim/ballSim';
import type { BallSim3 } from '../sim/ballSim3';
import type { Scene3 } from '../sim/scene3';
import { GpuVisuals, type GpuViewOptions } from './gpuVisuals';

interface Props {
  /** GPU 3D 격자 결과 (계산 중이면 null: 발생기만 그림) */
  scene3: Scene3 | null;
  sim3Ref: MutableRefObject<BallSim3 | null>;
  onStatus: (s: BallStatus) => void;
  options: GpuViewOptions;
  mode: DisplayMode;
  animate: boolean;
  showForces: boolean;
  timeScale: number;
  /** 장면에 아직 장이 없을 때 위치를 잡을 발생기 간격 [m] */
  d: number;
  at: number;
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
      '발생기, 3D 음향장(볼륨 또는 등치면), 덫, 공의 3D 장면. 드래그 또는 방향키로 회전, 휠 또는 +/− 키로 확대, 0 키로 처음 시점',
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

    // 공 (불투명, 먼저 그림. 장 셰이더는 광선이 공에 닿으면 멈춘다)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
    world.add(ball);

    // 힘 화살표 (공에 작용): 음향 방사력, 중력, 밀림
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
    const vis = new GpuVisuals(renderer);
    world.add(vis.group);
    const last = { status: null as BallStatus | null };
    const f3 = { fx: 0, fy: 0, fz: 0 };
    const p3 = { fx: 0, fy: 0, fz: 0 };
    let builtD = -1;
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
      draw(realDt, tNow);
      controls.update();
      renderer.render(world, camera);
    };

    const draw = (realDt: number, tNow: number) => {
      const { scene3: sc3, sim3Ref, onStatus, options, mode, animate, showForces, timeScale } = live.current;

      // 발생기: 위 발생기는 기울기 θ(x축 둘레)와 x 어긋남 (장이 아직 없으면 기본 자세)
      const p = sc3?.params;
      const d = (p?.d ?? live.current.d) * MM;
      const at = (p?.at ?? live.current.at) * MM;
      const tilt = p?.tilt ?? 0;
      lower.scale.set(at, BODY, at);
      lower.position.set(0, -BODY / 2, 0);
      upper.scale.set(at, BODY, at);
      upper.rotation.x = tilt;
      upper.position.set((p?.offset ?? 0) * MM, d + (BODY / 2) * Math.cos(tilt), (BODY / 2) * Math.sin(tilt));
      if (builtD !== d) {
        controls.target.set(0, d / 2, 0);
        builtD = d;
      }

      vis.group.visible = !!sc3;
      arrowAcoustic.visible = arrowGravity.visible = arrowPush.visible = false;
      const sim = sc3 ? sim3Ref.current : null;
      ball.visible = !!sim;
      if (!sc3) return;
      if (sim) {
        sim.advanceFrame(realDt, timeScale, sc3);
        if (sim.status !== last.status) {
          last.status = sim.status;
          onStatus(sim.status);
        }
      }

      const a = sc3.particle.a * MM;
      if (sim) {
        const st = sim.state;
        ball.scale.setScalar(a);
        ball.position.set(st.x * MM, st.z * MM, -st.y * MM);
      }
      const phase = mode === 'instant' && animate ? 2 * Math.PI * (tNow / 1000) : 0;
      vis.update(sc3, mode, phase, options, camera, sim ? { x: ball.position.x, y: ball.position.y, z: ball.position.z, r: a } : null);

      if (!sim || !showForces || sim.status === 'escaped') return;
      const st = sim.state;
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
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div ref={wrapRef} className="view3d-wrap">
      <span ref={fpsRef} className="fps" aria-hidden="true" title="화면 갱신 속도 (이 기기 기준)" />
    </div>
  );
}
