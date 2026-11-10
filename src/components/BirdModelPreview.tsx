import { useEffect, useRef, useState } from 'react';
import {
  AnimationMixer, Box3, BufferGeometry, DirectionalLight, Group,
  HemisphereLight, LoopRepeat, Material, Mesh, NoToneMapping,
  PerspectiveCamera, Scene, SkinnedMesh, SRGBColorSpace, Texture,
  Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './BirdModelPreview.css';

type View = 'front' | 'left' | 'right' | 'three-quarter';
type ViewerControls = { view: (view: View) => void; seek: (seconds: number) => void };
type ModelInfo = { triangles: number; bones: number; clips: number; duration: number; loadTime: number };

function disposeModel(root: Group) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
    if (object instanceof SkinnedMesh) object.skeleton.dispose();
  });
  textures.forEach((texture) => {
    texture.dispose();
    const bitmap = texture.source.data;
    if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) bitmap.close();
  });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

export default function BirdModelPreview() {
  const mountRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<ViewerControls | null>(null);
  const playbackRef = useRef({ playing: true, speed: 1 });
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [background, setBackground] = useState<'paper' | 'dark'>('paper');
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [fps, setFps] = useState(0);

  useEffect(() => { playbackRef.current = { playing, speed }; }, [playing, speed]);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    const abort = new AbortController();
    let disposed = false;
    let renderer: WebGLRenderer | undefined;
    let orbit: OrbitControls | undefined;
    let model: Group | undefined;
    let mixer: AnimationMixer | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let previousTime = performance.now();
    const onVisibilityChange = () => { previousTime = performance.now(); };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      renderer?.setAnimationLoop(null);
      setError('浏览器暂停了三维画面，请点击重新载入。');
    };

    async function initialize() {
      try {
        const started = performance.now();
        const scene = new Scene();
        const camera = new PerspectiveCamera(34, 1, 0.01, 100);
        renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = SRGBColorSpace;
        // Preserve the exported unlit, hand-painted material without an extra cinematic color transform.
        renderer.toneMapping = NoToneMapping;
        renderer.domElement.setAttribute('aria-label', '可拖动旋转的柳莺三维模型');
        renderer.domElement.addEventListener('webglcontextlost', onContextLost);
        host!.appendChild(renderer.domElement);
        orbit = new OrbitControls(camera, renderer.domElement);
        orbit.enableDamping = true;
        orbit.enablePan = false;
        scene.add(new HemisphereLight(0xffffff, 0x7d7468, 2));
        const light = new DirectionalLight(0xffffff, 2);
        light.position.set(3, 5, 4);
        scene.add(light);

        const response = await fetch(`${import.meta.env.BASE_URL}models/warbler-flight.glb`, { signal: abort.signal });
        if (!response.ok) throw new Error(`模型文件读取失败（${response.status}）`);
        const bytes = await response.arrayBuffer();
        if (disposed) return;
        const gltf = await new GLTFLoader().parseAsync(bytes, '');
        if (disposed) { disposeModel(gltf.scene); return; }
        model = gltf.scene;
        const holder = new Group();
        holder.add(model);
        scene.add(holder);

        let triangles = 0;
        let bones = 0;
        model.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
          if (object instanceof SkinnedMesh) {
            bones += object.skeleton.bones.length;
            // Animated wings can extend outside the bind-pose bounds.
            object.frustumCulled = false;
          }
        });

        mixer = new AnimationMixer(model);
        const sourceClip = gltf.animations.find((clip) => clip.name === 'Warbler_Wingbeat_Loop') ?? gltf.animations[0];
        const clip = sourceClip?.clone();
        if (clip) {
          // Blender exported frame 1 at 1/24 s. Shift the shared start to zero so the loop has no extra held frame.
          const start = Math.min(...clip.tracks.map((track) => track.times[0] ?? 0));
          clip.tracks.forEach((track) => track.shift(-start));
          clip.resetDuration();
        }
        const action = clip ? mixer.clipAction(clip) : undefined;
        action?.setLoop(LoopRepeat, Infinity).play();
        mixer.update(0);

        // Fit every phase of the wings, not only the export's current pose.
        const bounds = new Box3();
        for (let sample = 0; sample < 8; sample++) {
          mixer.setTime(clip ? clip.duration * sample / 8 : 0);
          model.updateMatrixWorld(true);
          bounds.union(new Box3().setFromObject(model, true));
        }
        mixer.setTime(0);
        const center = bounds.getCenter(new Vector3());
        const size = bounds.getSize(new Vector3());
        holder.position.copy(center).negate();
        const radius = Math.max(size.x, size.y, size.z) * 0.6;
        const viewDirection = new Vector3(0.7, 0.23, 1.8).normalize();
        let defaultDistance = 2;
        const fit = () => {
          if (!renderer || !orbit) return;
          const width = host!.clientWidth;
          const height = Math.max(host!.clientHeight, 1);
          camera.aspect = Math.max(width, 1) / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
          const vertical = camera.fov * Math.PI / 360;
          const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
          defaultDistance = radius / Math.sin(Math.min(vertical, horizontal));
          camera.position.copy(viewDirection).multiplyScalar(defaultDistance);
          orbit.target.set(0, 0, 0);
          orbit.minDistance = radius * 0.65;
          orbit.maxDistance = defaultDistance * 3;
          orbit.update();
        };
        fit();
        resizeObserver = new ResizeObserver(fit);
        resizeObserver.observe(host!);
        controlsRef.current = {
          view(view) {
            const direction = { front: [0, 0.12, 1], left: [-1, 0.12, 0], right: [1, 0.12, 0], 'three-quarter': [0.7, 0.23, 1.8] }[view];
            viewDirection.set(direction[0], direction[1], direction[2]).normalize();
            camera.position.copy(viewDirection).multiplyScalar(defaultDistance);
            orbit!.target.set(0, 0, 0);
            orbit!.update();
          },
          seek(seconds) { mixer!.setTime(seconds); setTime(seconds); },
        };
        setInfo({ triangles, bones, clips: gltf.animations.length, duration: clip?.duration ?? 0, loadTime: (performance.now() - started) / 1000 });
        if (!clip) setPlaying(false);
        document.addEventListener('visibilitychange', onVisibilityChange);
        let frames = 0;
        let reportTime = performance.now();
        previousTime = reportTime;
        renderer.setAnimationLoop((now) => {
          const delta = Math.min((now - previousTime) / 1000, 0.1);
          previousTime = now;
          if (document.hidden || disposed) return;
          const state = playbackRef.current;
          if (state.playing && action) mixer!.update(delta * state.speed);
          orbit!.update();
          renderer!.render(scene, camera);
          frames++;
          if (now - reportTime > 300) {
            setTime(action?.time ?? 0);
            setFps(Math.round(frames * 1000 / (now - reportTime)));
            reportTime = now;
            frames = 0;
          }
        });
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : '模型加载失败，请重新载入。');
      }
    }
    void initialize();
    return () => {
      disposed = true;
      abort.abort();
      renderer?.setAnimationLoop(null);
      resizeObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      orbit?.dispose();
      if (model) { mixer?.stopAllAction(); mixer?.uncacheRoot(model); disposeModel(model); }
      renderer?.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer?.dispose();
      renderer?.domElement.remove();
      controlsRef.current = null;
    };
  }, []);

  const ready = Boolean(info) && !error;
  return (
    <main className={`bird-preview bird-preview--${background}`}>
      <header className="bird-preview__header">
        <a href={import.meta.env.BASE_URL} className="bird-preview__brand">夜迁<span>NIGHT MIGRATION</span></a>
        <span className="bird-preview__edition">柳莺 · 三维预览 / 01</span>
        <a className="bird-preview__back" href={import.meta.env.BASE_URL}>返回故事 ↗</a>
      </header>
      <div className="bird-preview__layout">
        <section className="bird-preview__stage" aria-label="小鸟预览">
          <div className="bird-preview__caption"><span className="bird-preview__eyebrow">A LITTLE LIFE, A LONG JOURNEY</span><h1>先让它飞起来。</h1><p>一只柳莺，和即将启程的故事。</p></div>
          <div className="bird-preview__canvas" ref={mountRef} />
          {!ready && <div className="bird-preview__notice" role="status">{error || '正在载入小鸟、贴图与飞行动画…'}{error && <button onClick={() => window.location.reload()}>重新载入</button>}</div>}
          <div className="bird-preview__stage-footer"><span>拖动旋转 · 滚轮缩放 · 双指缩放</span><span>{ready ? `${fps} FPS` : 'LOADING'}</span></div>
        </section>
        <aside className="bird-preview__panel">
          <div className="bird-preview__status"><span className={ready ? 'is-ready' : ''} />{error ? '需要重新载入' : ready ? '小鸟已就绪' : '等待小鸟到来'}</div>
          <h2>观察一次振翅</h2><p className="bird-preview__description">看看羽毛的边缘，再转到另一侧。暂停时，也可以拖动下方时间轴检查腹部。</p>
          <div className="bird-preview__playback">
            <button className="bird-preview__play" disabled={!ready || !info?.duration} onClick={() => setPlaying(!playing)}>{playing ? 'Ⅱ 暂停振翅' : '▶ 播放振翅'}</button>
            <label>速度<select aria-label="播放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value="0.5">0.5 ×</option><option value="1">1 ×</option><option value="1.5">1.5 ×</option></select></label>
          </div>
          <div className="bird-preview__timeline"><div><label htmlFor="bird-time">飞行时间轴</label><output>{time.toFixed(2)} / {(info?.duration ?? 0).toFixed(2)} s</output></div><input id="bird-time" type="range" min="0" max={info?.duration || 1} step="0.01" value={time} disabled={!ready || !info?.duration} onChange={(event) => { setPlaying(false); playbackRef.current.playing = false; controlsRef.current?.seek(Number(event.target.value)); }} /></div>
          <div className="bird-preview__control-group"><h3>换个角度</h3><div className="bird-preview__views">{([['front', '正面'], ['left', '左侧'], ['right', '右侧']] as const).map(([view, label]) => <button key={view} disabled={!ready} onClick={() => controlsRef.current?.view(view)}>{label}</button>)}</div><button className="bird-preview__reset" disabled={!ready} onClick={() => controlsRef.current?.view('three-quarter')}>↺ 回到初始视角</button></div>
          <div className="bird-preview__control-group"><h3>衬底颜色</h3><div className="bird-preview__swatches"><button aria-pressed={background === 'paper'} onClick={() => setBackground('paper')}><i className="is-paper" />暖纸</button><button aria-pressed={background === 'dark'} onClick={() => setBackground('dark')}><i className="is-dark" />深灰</button></div></div>
          <dl className="bird-preview__details"><div><dt>模型</dt><dd>鸟2.glb</dd></div><div><dt>骨骼</dt><dd>{info ? `${info.bones} 根` : '—'}</dd></div><div><dt>动画</dt><dd>{info ? `${info.clips} 段 · ${info.duration.toFixed(2)} 秒` : '—'}</dd></div><div><dt>三角面</dt><dd>{info?.triangles.toLocaleString() ?? '—'}</dd></div><div><dt>载入用时</dt><dd>{info ? `${info.loadTime.toFixed(2)} 秒` : '—'}</dd></div></dl>
          <p className="bird-preview__footnote">保留原始贴图与手绘边缘。<br />这是模型接入测试，故事从下一幕开始。</p>
        </aside>
      </div>
    </main>
  );
}
