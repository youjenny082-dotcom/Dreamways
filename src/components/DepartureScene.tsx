import { useEffect, useRef, useState } from 'react';
import { DirectionalLight, Group, HemisphereLight, NoToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, Vector2, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWoodland, disposeScene } from './departureWorld';
import { clampProgress, createBirdJourney, journeyAt } from './departureJourney';
import './DepartureScene.css';

const STOPS = [{ name: '停栖', progress: 0 }, { name: '展翅', progress: .3 }, { name: '离枝', progress: .7 }];

export default function DepartureScene() {
  const storyRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef({ wind: true, close: false });
  const [wind, setWind] = useState(true);
  const [close, setClose] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState(0);
  const beat = journeyAt(progress);

  useEffect(() => { motionRef.current = { wind, close }; }, [wind, close]);

  const goTo = (value: number) => {
    const story = storyRef.current, host = mountRef.current;
    if (!story || !host) return;
    const start = story.getBoundingClientRect().top + window.scrollY;
    const distance = story.offsetHeight - host.clientHeight;
    window.scrollTo({ top: start + Math.max(0, distance) * value,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };

  useEffect(() => {
    const host = mountRef.current, story = storyRef.current;
    if (!host || !story) return;
    const controller = new AbortController();
    const scene = new Scene();
    const pointer = new Vector2();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let renderer: WebGLRenderer | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let birdJourney: ReturnType<typeof createBirdJourney> | undefined;
    let previous = performance.now();
    let elapsed = 0, targetProgress = 0, currentProgress = 0, reportedProgress = -1;
    const originalTitle = document.title;
    document.title = '离枝之前 · 柳莺的迁徙';
    const onScroll = () => {
      const distance = story.offsetHeight - host.clientHeight;
      targetProgress = clampProgress(-story.getBoundingClientRect().top / Math.max(1, distance));
    };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointer.set(event.clientX / window.innerWidth * 2 - 1, event.clientY / window.innerHeight * 2 - 1);
    };
    const onLeave = () => pointer.set(0, 0);
    const onVisibility = () => { previous = performance.now(); onScroll(); };
    const onContextLost = (event: Event) => {
      event.preventDefault(); renderer?.setAnimationLoop(null);
      setReady(false); setError('画面暂时中断了，再让小鸟回来一次。');
    };

    async function initialize() {
      try {
        renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = NoToneMapping;
        renderer.domElement.setAttribute('aria-label', '随滚动从枝头展翅起飞的柳莺三维场景');
        renderer.domElement.setAttribute('role', 'img');
        renderer.domElement.addEventListener('webglcontextlost', onContextLost);
        host!.appendChild(renderer.domElement);
        const camera = new PerspectiveCamera(38, 1, .1, 70);
        const woodland = createWoodland(); scene.add(woodland.root);
        scene.add(new HemisphereLight(0xfff8e7, 0x8c9684, 2.5));
        const key = new DirectionalLight(0xffe6b9, 2.2); key.position.set(-4, 6, 6); scene.add(key);
        const fill = new DirectionalLight(0xf5f4e9, .7); fill.position.set(4, 2, -2); scene.add(fill);
        let compact = false;
        const resize = () => {
          const width = Math.max(host!.clientWidth, 1), height = Math.max(host!.clientHeight, 1);
          compact = width / height < 1.2; woodland.setCompact(compact);
          camera.aspect = width / height; camera.updateProjectionMatrix(); renderer!.setSize(width, height);
          onScroll();
        };
        resize(); resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host!);
        window.addEventListener('scroll', onScroll, { passive: true });
        camera.position.set(compact ? 1.45 : 0, compact ? 1.05 : 0, compact ? 11.6 : 9.4);
        camera.lookAt(compact ? 1.45 : 0, compact ? 1.05 : 0, 0); renderer.render(scene, camera);

        const response = await fetch(`${import.meta.env.BASE_URL}models/warbler-takeoff.glb`, { signal: controller.signal });
        if (!response.ok) throw new Error(`小鸟暂时没能到达（${response.status}）`);
        const bytes = await response.arrayBuffer(); if (disposed) return;
        const gltf = await new GLTFLoader().parseAsync(bytes, '');
        if (disposed) { disposeScene(gltf.scene); return; }
        const model = gltf.scene;
        const birdPlacement = new Group(); scene.add(birdPlacement); birdPlacement.add(model);
        birdJourney = createBirdJourney(model, gltf.animations);
        // Blender owns the complete body trajectory, including foot contact and pitch.
        // Keep this placement fixed so no second path or rotation distorts that motion.
        birdPlacement.position.set(2.02, -.61, .02);
        birdPlacement.rotation.set(0, -1.28, 0);
        birdPlacement.scale.setScalar(2.8);
        setReady(true);
        window.addEventListener('pointermove', onPointer, { passive: true });
        document.addEventListener('pointerleave', onLeave); document.addEventListener('visibilitychange', onVisibility);
        onScroll(); currentProgress = targetProgress; previous = performance.now();
        renderer.setAnimationLoop(now => {
          const delta = Math.min((now - previous) / 1000, .05); previous = now;
          if (disposed || document.hidden) return;
          elapsed += delta;
          const state = motionRef.current;
          const animated = state.wind && !reducedMotion.matches;
          const easing = reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 10);
          currentProgress += (targetProgress - currentProgress) * easing;
          if (Math.abs(targetProgress - currentProgress) < .0001) currentProgress = targetProgress;
          const journey = journeyAt(currentProgress);
          birdJourney!.update(currentProgress);
          woodland.update(elapsed, animated);
          const originX = (compact ? 1.45 : 0) - journey.flight * .65;
          const originY = (compact ? 1.05 : 0) + journey.flight * .4;
          const zoom = state.close ? .9 : 1;
          const targetZ = ((compact ? 11.6 : 9.4) + journey.flight * .8) * zoom;
          // Camera follows the same timeline as the bird, including when scrolling backwards.
          camera.position.set(originX + (animated ? pointer.x * .10 : 0),
            originY + (animated ? -pointer.y * .06 : 0), targetZ);
          camera.lookAt(originX, originY, 0);
          renderer!.render(scene, camera);
          const rounded = Math.round(currentProgress * 200) / 200;
          if (rounded !== reportedProgress) { reportedProgress = rounded; setProgress(rounded); }
        });
      } catch (reason) {
        if (!disposed) { setError(reason instanceof Error ? reason.message : '场景暂时未能载入。'); setReady(false); }
      }
    }
    void initialize();
    return () => {
      disposed = true; controller.abort(); renderer?.setAnimationLoop(null);
      resizeObserver?.disconnect(); window.removeEventListener('scroll', onScroll); window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerleave', onLeave); document.removeEventListener('visibilitychange', onVisibility);
      renderer?.domElement.removeEventListener('webglcontextlost', onContextLost);
      birdJourney?.dispose(); disposeScene(scene); renderer?.dispose(); renderer?.domElement.remove();
      document.title = originalTitle;
    };
  }, [attempt]);

  return (
    <main className="departure-story" ref={storyRef}>
    <div className={`departure ${ready ? 'departure--ready' : ''}`} data-phase={STOPS[beat.phase].name}>
      <div className="departure__sky" aria-hidden="true" />
      <div className="departure__sun" aria-hidden="true" />
      <div className="departure__canvas" ref={mountRef} />
      <div className="departure__paper" aria-hidden="true" />
      <header className="departure__header">
        <a className="departure__brand" href={import.meta.env.BASE_URL} aria-label="柳莺的迁徙，回到开篇"><span className="departure__seal">迁</span><span>一只柳莺的远方<small>A LITTLE LIFE, A LONG JOURNEY</small></span></a>
        <a className="departure__model-link" href={`${import.meta.env.BASE_URL}?preview=bird`}>认识这只小鸟 <span>↗</span></a>
      </header>
      <section className="departure__intro" aria-labelledby="departure-title" aria-hidden={beat.introOpacity < .05}
        style={{ opacity: beat.introOpacity, transform: `translateY(${-24 * (1 - beat.introOpacity)}px)` }}>
        <p className="departure__chapter"><span />第一章 · 林缘</p>
        <h1 id="departure-title">离枝<span>之前</span></h1>
        <p className="departure__english">BEFORE THE FIRST FLIGHT</p>
        <p className="departure__words">风穿过枝叶。<br />一场漫长的迁徙，<br />从这根细枝开始。</p>
        <button className="departure__begin" disabled={!ready} tabIndex={beat.introOpacity < .05 ? -1 : 0}
          style={{ pointerEvents: beat.introOpacity < .05 ? 'none' : 'auto' }} onClick={() => goTo(.3)}>向下滚动，跟它出发 <span>↓</span></button>
      </section>
      <section className="departure__narration departure__narration--middle" aria-hidden={beat.middleOpacity < .05}
        style={{ opacity: beat.middleOpacity, transform: `translateY(${18 * (1 - beat.middleOpacity)}px)` }}>
        <p className="departure__chapter"><span />风起 · 展翅</p>
        <h2>风在催促。</h2>
        <p className="departure__words">张开翅膀，<br />把熟悉的枝头，留在身后。</p>
      </section>
      <section className="departure__narration departure__narration--ending" aria-hidden={beat.endingOpacity < .05}
        style={{ opacity: beat.endingOpacity, transform: `translateY(${18 * (1 - beat.endingOpacity)}px)` }}>
        <p className="departure__chapter"><span />离枝 · 第一阵风</p>
        <h2>向着远方。</h2>
        <p className="departure__words">脚下的树林渐渐变小，<br />旅程，从这一刻开始。</p>
        <button className="departure__begin" tabIndex={beat.endingOpacity < .05 ? -1 : 0}
          style={{ pointerEvents: beat.endingOpacity < .05 ? 'none' : 'auto' }} onClick={() => goTo(0)}>再看一次离枝 <span>↺</span></button>
      </section>
      {!ready && <div className={`departure__notice ${error ? 'departure__notice--error' : ''}`} role="status">
        <span>{error || '等一只小鸟，落在枝头…'}</span>
        {error && <button onClick={() => { setError(''); setReady(false); setAttempt(value => value + 1); }}>重新载入</button>}
      </div>}
      <footer className="departure__footer">
        <div className="departure__folio"><strong>01</strong><span>{STOPS[beat.phase].name} · 离枝之前</span></div>
        <nav className="departure__steps" aria-label="离枝过程">
          {STOPS.map((stop, index) => <button key={stop.name} disabled={!ready} aria-current={beat.phase === index ? 'step' : undefined}
            onClick={() => goTo(stop.progress)}><span />{stop.name}</button>)}
        </nav>
        <div className="departure__controls">
          <button aria-pressed={close} disabled={!ready} onClick={() => setClose(!close)}>{close ? '看向远方 ↗' : '靠近一点 ↗'}</button>
          <button aria-pressed={wind} disabled={!ready} onClick={() => setWind(!wind)}><span className="departure__wind">≈</span>{wind ? '让风停一会' : '让风吹起来'}</button>
        </div>
      </footer>
      <div className="departure__progress" role="progressbar" aria-label="离枝故事进度" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)} aria-valuetext={`${STOPS[beat.phase].name}，${Math.round(progress * 100)}%`}>
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
    </main>
  );
}
