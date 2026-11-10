import {
  Bone, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3,
  Color, DoubleSide, Group, Line, LineBasicMaterial, Material, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, Quaternion, RepeatWrapping,
  Shape, ShapeGeometry, SkinnedMesh, SRGBColorSpace, Texture, TubeGeometry, Vector3,
} from 'three';

// Geometry and brush marks are deterministic, so the woodland does not change on reload.
function random(seed: number) {
  let value = seed;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) | 0; return (value >>> 0) / 4294967296; };
}

function brushTexture(kind: 'bark' | 'leaf') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rand = random(kind === 'bark' ? 91 : 42);
  ctx.fillStyle = kind === 'bark' ? '#a8a090' : '#c3c0aa';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1100; i++) {
    const x = rand() * 256, y = rand() * 256;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(247,242,224,.38)' : 'rgba(43,42,34,.20)';
    ctx.lineWidth = .3 + rand() * 1.9;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - .5) * 6, y + rand() * 29 + 1); ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

function leafGeometry() {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const width = Math.pow(Math.sin(Math.PI * t), .85) * .26 * (i % 2 ? .86 : 1);
    for (const side of [-1, 0, 1]) {
      positions.push(width * side, t, Math.sin(t * Math.PI) * (side === 0 ? .09 : -.018));
      uvs.push((side + 1) / 2, t);
    }
    if (i < steps) {
      const a = i * 3;
      indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices); geo.computeVertexNormals();
  return geo;
}

type BranchPoint = [number, number, number];
export type Woodland = { root: Group; setCompact: (compact: boolean) => void; update: (seconds: number, wind: boolean) => void };

export function createWoodland(): Woodland {
  const root = new Group();
  root.name = '手绘林缘';
  const barkMap = brushTexture('bark');
  barkMap.repeat.set(2, 3);
  const bark = new MeshStandardMaterial({ color: '#817261', map: barkMap, roughness: 1, flatShading: true });
  const leafMap = brushTexture('leaf');
  const leafShape = leafGeometry();
  const leafMaterials = ['#858672', '#a19b7c', '#b6ad8d', '#70796e', '#979785'].map(color =>
    new MeshStandardMaterial({ color, map: leafMap, side: DoubleSide, roughness: 1, flatShading: true }));
  const ink = new LineBasicMaterial({ color: '#393c32', transparent: true, opacity: .48 });
  const leaves: { object: Group; rotation: number; phase: number }[] = [];
  const rand = random(2083);

  function branch(points: BranchPoint[], radius: number, parent: Group = root) {
    const curve = new CatmullRomCurve3(points.map(p => new Vector3(...p)));
    const geometry = new TubeGeometry(curve, 22, radius, 7, false);
    // Taper each ring towards the tip, while retaining the irregular bark cross-section.
    const position = geometry.getAttribute('position');
    for (let i = 0; i <= 22; i++) {
      const center = curve.getPointAt(i / 22);
      const taper = 1 - i / 22 * .78;
      for (let j = 0; j <= 7; j++) {
        const index = i * 8 + j;
        position.setXYZ(index, center.x + (position.getX(index) - center.x) * taper,
          center.y + (position.getY(index) - center.y) * taper,
          center.z + (position.getZ(index) - center.z) * taper);
      }
    }
    geometry.computeVertexNormals();
    parent.add(new Mesh(geometry, bark));
    return curve;
  }

  function leaf(parent: Group, point: Vector3, angle: number, size: number, phase: number) {
    const group = new Group();
    group.position.copy(point);
    group.rotation.set((rand() - .5) * .65, (rand() - .5) * .7, angle);
    group.scale.setScalar(size);
    group.add(new Mesh(leafShape, leafMaterials[Math.floor(rand() * leafMaterials.length)]));
    const midrib = new BufferGeometry().setFromPoints([new Vector3(0, .02, .02), new Vector3(0, .45, .105), new Vector3(0, .98, .02)]);
    group.add(new Line(midrib, ink));
    for (let j = 1; j < 5; j++) {
      const t = j / 6;
      for (const side of [-1, 1]) {
        const vein = new BufferGeometry().setFromPoints([
          new Vector3(0, t, Math.sin(t * Math.PI) * .09 + .008),
          new Vector3(side * Math.sin((t + .13) * Math.PI) * .19, t + .14, .008),
        ]);
        group.add(new Line(vein, ink));
      }
    }
    leaves.push({ object: group, rotation: angle, phase });
    parent.add(group);
  }

  function sprig(points: BranchPoint[], radius: number, count: number, size: number, parent = root) {
    const curve = branch(points, radius, parent);
    for (let i = 0; i < count; i++) {
      const t = .22 + i / count * .74;
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t);
      const side = i % 2 ? 1 : -1;
      const angle = Math.atan2(-tangent.x, tangent.y) + side * (.52 + rand() * .5);
      leaf(parent, point, angle, size * (.7 + rand() * .45), rand() * 8);
    }
    leaf(parent, curve.getPoint(.98), -.5, size * .8, rand() * 8);
  }

  // The perch crosses the feet horizontally; its far ends describe the reference's diagonal.
  branch([[6.8, -3.6, -.15], [4.8, -2.25, .05], [3.05, -1.05, .03], [1.95, -.64, .03], [.55, -.48, -.04], [-.65, -.18, -.12]], .145);
  const upperTwig = new Group(); upperTwig.position.set(.9, -.5, -.05); root.add(upperTwig);
  sprig([[0, 0, 0], [-.7, .73, -.05], [-1.05, 1.53, -.07], [-1.7, 2.1, -.13]], .034, 6, .58, upperTwig);
  sprig([[.35, -.42, -.04], [-.5, -.65, .05], [-1.15, -.52, .12]], .024, 4, .43);
  sprig([[3.85, -1.65, .03], [3.3, -.62, -.25], [3.7, .3, -.35]], .038, 5, .55);
  // Cropped, airy canopy. The bird's head stays clear of all of these branches.
  sprig([[7, 3.7, -.7], [4.8, 2.6, -.65], [3.6, 2.72, -.6], [2.45, 2.3, -.5]], .09, 8, .78);
  sprig([[5.45, 2.8, -.7], [5, 1.6, -.5], [4.15, 1.3, -.4]], .04, 5, .55);
  const foreground = new Group();
  foreground.position.set(0, 0, 2.2);
  root.add(foreground);
  sprig([[6.6, -4.5, 0], [4.9, -2.1, .1], [5.05, -.9, .15]], .12, 7, .95, foreground);
  sprig([[5.2, -2.65, 0], [3.65, -2.2, .12], [3.15, -1.8, .2]], .055, 5, .82, foreground);
  sprig([[-6.4, -3.9, .1], [-5.35, -2.8, .12], [-5.7, -1.95, .05]], .055, 5, .65, foreground);

  // Flat silhouettes sit at different world depths, making them move differently with the camera.
  for (let layer = 0; layer < 4; layer++) {
    const shape = new Shape();
    const depth = -5 - layer * 3;
    const yBase = -2.5 + layer * .16;
    shape.moveTo(-30, -12); shape.lineTo(-30, yBase);
    for (let i = 0; i <= 120; i++) {
      const x = -30 + i * .5;
      const y = yBase + Math.sin(x * .43 + layer) * .45 + Math.sin(x * .87 - layer * 2) * .17;
      shape.lineTo(x, y);
    }
    shape.lineTo(30, -12); shape.closePath();
    const mesh = new Mesh(new ShapeGeometry(shape), new MeshBasicMaterial({
      color: ['#b6b9ad', '#c5c6bb', '#d3d1c4', '#dfdbce'][layer], side: DoubleSide,
    }));
    mesh.position.z = depth; root.add(mesh);
    const forest = new Group(); forest.position.z = depth + .1;
    const forestInk = new LineBasicMaterial({ color: new Color(['#a7ad9f', '#b6bcaf', '#c7c9bd', '#d4d2c6'][layer]) });
    for (let t = 0; t < 28; t++) {
      const x = -18 + rand() * 36;
      const y = yBase + Math.sin(x * .43 + layer) * .45 + Math.sin(x * .87 - layer * 2) * .17;
      const height = .2 + rand() * .65;
      const points = [new Vector3(x, y - .1, 0), new Vector3(x, y + height, 0)];
      for (let k = 1; k <= 4; k++) {
        const h = height * k / 5;
        points.push(new Vector3(x, y + h, 0), new Vector3(x - (height - h) * .37, y + h - .12, 0),
          new Vector3(x, y + h, 0), new Vector3(x + (height - h) * .37, y + h - .1, 0), new Vector3(x, y + h, 0));
      }
      forest.add(new Line(new BufferGeometry().setFromPoints(points), forestInk));
    }
    root.add(forest);
  }
  return { root, setCompact(compact) { upperTwig.scale.y = compact ? .36 : 1; }, update(seconds, wind) {
    for (const leaf of leaves) leaf.object.rotation.z = leaf.rotation + (wind ? Math.sin(seconds * .7 + leaf.phase) * .025 : 0);
  } };
}

// Fold this model's existing symmetrical wing chains, without modifying its GLB or weights.
export function posePerchedBird(model: Group) {
  model.updateMatrixWorld(true);
  // Keep the exported root transforms: skeleton.pose() would also rotate this
  // Tripo rig's parent, changing the model's forward axis by ninety degrees.
  function rotateInWorld(name: string, delta: Quaternion) {
    const bone = model.getObjectByName(name);
    if (!(bone instanceof Bone) || !bone.parent) throw new Error(`模型缺少停栖骨骼：${name}`);
    const world = bone.getWorldQuaternion(new Quaternion());
    const parent = bone.parent.getWorldQuaternion(new Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(delta).multiply(world));
    model.updateMatrixWorld(true);
  }
  for (const [name, side] of [['bone_7', 1], ['bone_15', -1]] as const) {
    // This export weights most of the feather fan to the shoulder. Orient both
    // the span and feather surface, otherwise a single direction rotation fans
    // the feathers sideways. Preserve the wrist chain to avoid a sharp crease.
    const span = new Vector3(.12, -side * .78, -side * .614).normalize();
    const feather = new Vector3(0, .619, -.786);
    feather.addScaledVector(span, -feather.dot(span)).normalize();
    const normal = new Vector3().crossVectors(span, feather).normalize();
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(span, feather, normal));
    rotateInWorld(name, rotation);
    const bone = model.getObjectByName(name)!;
    // A reversible pose compression closes this flight-only model's feather fan.
    // The source mesh, weights and flight asset remain unchanged.
    bone.scale.multiplyScalar(.7);
    const position = bone.getWorldPosition(new Vector3()); position.x += side * .055;
    bone.position.copy(bone.parent!.worldToLocal(position));
    model.updateMatrixWorld(true);
  }
  model.traverse(object => {
    if (object instanceof SkinnedMesh) { object.frustumCulled = false; object.skeleton.update(); }
  });
}

export function disposeScene(root: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const skeletons = new Set<SkinnedMesh['skeleton']>();
  root.traverse(object => {
    if (object instanceof Mesh || object instanceof Line) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      }
    }
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
  });
  textures.forEach(texture => {
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) texture.source.data.close();
  });
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
  skeletons.forEach(skeleton => skeleton.dispose());
}
