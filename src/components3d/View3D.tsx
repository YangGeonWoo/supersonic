/**
 * 3D 뷰 (Three.js). 단위: 1 = 1 mm. 좌표 대응: 물리 (x, y, z) → Three (x, z, y) (물리 z = 화면 위쪽)
 *
 * 장은 축대칭이라 x-z 격자(= (ρ, z) 반평면 결과)를 x-z, y-z 두 단면에 같은 텍스처로 세운다.
 * 공의 위치/속도는 simRef에 있고 rAF 루프에서 stepBall로 진행한다 (React 상태 아님).
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fieldToRGBA, type DisplayMode } from '../components/heatmap';
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
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const wrap = wrapRef.current!;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: !coarse });
    renderer.setPixelRatio(coarse ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    wrap.appendChild(renderer.domElement);
    renderer.domElement.className = 'view3d-canvas';
    renderer.domElement.setAttribute('aria-label', '발생기, 음압 단면, 마디, 공의 3D 장면 (드래그로 회전, 휠로 확대)');

    const scene3 = new THREE.Scene();
    const setBg = () => (scene3.background = new THREE.Color(cssVar('--canvas-bg', '#0d1117')));
    setBg();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', setBg);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1000);
    camera.position.set(30, 20, 37);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 11, 0);

    scene3.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(30, 60, 40);
    scene3.add(sun);

    // 발생기 (단위 원기둥을 a_t로 키움)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.3, roughness: 0.6 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.2, roughness: 0.4 });
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 48);
    const lower = new THREE.Mesh(cyl, [bodyMat, faceMat, bodyMat]); // 옆, 윗면, 아랫면
    const upper = new THREE.Mesh(cyl, [bodyMat, bodyMat, faceMat]);
    scene3.add(lower, upper);

    // 축
    const axisGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
    const axis = new THREE.Line(axisGeom, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    scene3.add(axis);

    // 단면 2개 (같은 텍스처). 텍스처 행 0 = 위쪽이므로 v를 뒤집는다
    let tex: THREE.DataTexture | null = null;
    let texData: Uint8ClampedArray | null = null;
    const planeMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const planeGeom = new THREE.PlaneGeometry(1, 1);
    const planeXZ = new THREE.Mesh(planeGeom, planeMat);
    const planeYZ = new THREE.Mesh(planeGeom, planeMat);
    planeYZ.rotation.y = Math.PI / 2;
    scene3.add(planeXZ, planeYZ);

    // 마디 면 (반투명 원판)
    const nodeGroup = new THREE.Group();
    const nodeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    const nodeRing = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    const disc = new THREE.CircleGeometry(1, 64);
    const ring = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 65 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * 2 * Math.PI), 0, Math.sin((i / 64) * 2 * Math.PI))),
    );
    scene3.add(nodeGroup);

    // 공
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
    scene3.add(ball);

    // 힘 화살표 (공에 작용): 음향 방사력, 중력
    const arrowAcoustic = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0x22d3ee, 1.6, 1);
    const arrowGravity = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 1, 0xf87171, 1.6, 1);
    scene3.add(arrowAcoustic, arrowGravity);

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
      const realDt = Math.min(0.1, (tNow - lastT) / 1000);
      lastT = tNow;
      const { scene: sc, simRef, mode, animate, showForces, timeScale, onStatus, options } = live.current;
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
        arrowAcoustic.visible = arrowGravity.visible = false;
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
            const fg = sim.dyn.m * sim.dyn.g;
            arrowGravity.position.copy(ball.position);
            const Lg = a + arrowLen(fg, fRef);
            arrowGravity.setLength(Lg, Math.min(1.6, Lg * 0.4), Math.min(1, Lg * 0.25));
            arrowGravity.visible = true;
          }
        }
      }
      controls.update();
      renderer.render(scene3, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener('change', setBg);
      controls.dispose();
      renderer.dispose();
      tex?.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={wrapRef} className="view3d-wrap" />;
}
