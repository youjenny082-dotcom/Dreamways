import { AnimationClip, AnimationMixer, Group, LoopOnce, SkinnedMesh } from 'three';

export const clampProgress = (value: number) => Math.max(0, Math.min(1, value));
export function transition(start: number, end: number, progress: number) {
  const t = clampProgress((progress - start) / (end - start));
  return t * t * (3 - 2 * t);
}

export function journeyAt(progress: number) {
  const p = clampProgress(progress);
  // Keep the opening still, then play the approved Blender frames 1–84 once.
  // Frame 36 (push-off) is exactly at 48% of the story.
  const frame = p <= .48
    ? 1 + clampProgress((p - .14) / .34) * 35
    : 36 + clampProgress((p - .48) / .48) * 48;
  return {
    frame,
    animationProgress: (frame - 1) / 83,
    flight: transition(.48, .96, p),
    introOpacity: 1 - transition(.08, .23, p),
    middleOpacity: transition(.23, .32, p) * (1 - transition(.55, .68, p)),
    endingOpacity: transition(.76, .9, p),
    phase: p < .14 ? 0 : p < .48 ? 1 : 2,
  };
}

export function createBirdJourney(model: Group, animations: AnimationClip[]) {
  const source = animations.find(clip => clip.name === 'Warbler_Takeoff_Full');
  if (!source?.tracks.length) throw new Error('小鸟的起飞动作没有载入，请重新尝试。');
  // Clone before shifting: GLTFLoader can share the same time array between tracks.
  const clip = source.clone();
  const start = Math.min(...clip.tracks.map(track => track.times[0] ?? 0));
  clip.tracks.forEach(track => track.shift(-start)); clip.resetDuration();
  if (clip.duration <= 0) throw new Error('起飞动作时间不完整，请重新载入。');
  const mixer = new AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play(); action.paused = true;
  model.traverse(object => {
    if (object instanceof SkinnedMesh) object.frustumCulled = false;
  });
  const update = (progress: number) => {
    // Sample an absolute time; neither idle time nor reverse scrolling changes the pose.
    action.time = journeyAt(progress).animationProgress * clip.duration;
    mixer.update(0);
  };
  update(0);
  return { update, dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); } };
}
