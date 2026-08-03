/* global THREE */
import toast from '../ui/toast.js';
import DrawPlane from './DrawPlane.js';

// Magic Pen: press-drag to draw a freehand 3D tube tracing the pointer
// path. Points land on a plane through the camera's orbit pivot,
// perpendicular to the view — so the stroke sits right under the
// finger. To draw at a different depth or on another plane, orbit the
// camera first: the drawing plane always faces you through the pivot.
//
// The tube previews live as you draw (rebuilt from the growing
// polyline), then becomes a normal 'custom' scene object on release —
// movable, sliceable, deformable, and exportable like anything else.

const MIN_STEP = 0.04;   // min world-distance between captured points
const RADIUS   = 0.06;   // tube thickness
const SEGMENTS = 8;      // radial segments

// Build a tube geometry (positions + normals) around a polyline using
// parallel-transport frames, so it stays smooth without twisting.
function buildTube(points, radius, radial){
  if (points.length < 2) return null;
  // tangents
  const tangents = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    return b.clone().sub(a).normalize();
  });
  // initial normal perpendicular to the first tangent
  let normal = new THREE.Vector3(0, 1, 0);
  if (Math.abs(tangents[0].dot(normal)) > 0.9) normal.set(1, 0, 0);
  normal.crossVectors(tangents[0], normal).normalize();
  const frames = [];
  for (let i = 0; i < points.length; i++){
    if (i > 0){
      // parallel-transport the normal along the curve
      const prev = tangents[i - 1], cur = tangents[i];
      const axis = prev.clone().cross(cur);
      const len = axis.length();
      if (len > 1e-6){
        axis.divideScalar(len);
        const angle = Math.acos(Math.min(1, Math.max(-1, prev.dot(cur))));
        normal.applyAxisAngle(axis, angle);
      }
    }
    // keep the frame orthonormal: remove any tangent component, renormalize
    normal.sub(tangents[i].clone().multiplyScalar(normal.dot(tangents[i])));
    if (normal.lengthSq() < 1e-8){          // degenerate — pick any perpendicular
      normal.set(0, 1, 0);
      if (Math.abs(tangents[i].dot(normal)) > 0.9) normal.set(1, 0, 0);
      normal.sub(tangents[i].clone().multiplyScalar(normal.dot(tangents[i])));
    }
    normal.normalize();
    const binormal = tangents[i].clone().cross(normal).normalize();
    frames.push({ normal: normal.clone(), binormal });
  }

  const pos = [], nor = [];
  const ring = (i) => {
    const p = points[i], f = frames[i];
    const out = [];
    for (let s = 0; s < radial; s++){
      const a = (s / radial) * Math.PI * 2;
      const dir = f.normal.clone().multiplyScalar(Math.cos(a))
        .add(f.binormal.clone().multiplyScalar(Math.sin(a)));
      out.push({ p: p.clone().add(dir.clone().multiplyScalar(radius)), n: dir });
    }
    return out;
  };
  let prevRing = ring(0);
  for (let i = 1; i < points.length; i++){
    const curRing = ring(i);
    for (let s = 0; s < radial; s++){
      const s2 = (s + 1) % radial;
      const a = prevRing[s], b = prevRing[s2], c = curRing[s2], d = curRing[s];
      for (const v of [a, b, c, a, c, d]){ pos.push(v.p.x, v.p.y, v.p.z); nor.push(v.n.x, v.n.y, v.n.z); }
    }
    prevRing = curRing;
  }
  // rounded caps
  const capCenter = (i, dir) => {
    const c = points[i];
    const r = ring(i);
    for (let s = 0; s < radial; s++){
      const s2 = (s + 1) % radial;
      const tri = dir > 0 ? [c, r[s2].p, r[s].p] : [c, r[s].p, r[s2].p];
      const nrm = tangents[i].clone().multiplyScalar(dir);
      for (const p of tri){ pos.push(p.x, p.y, p.z); nor.push(nrm.x, nrm.y, nrm.z); }
    }
  };
  capCenter(0, -1);
  capCenter(points.length - 1, 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export default function makePenTool(bus, sceneManager, om, cameraControls){
  let preview = null;
  const drawPlane = new DrawPlane(sceneManager.scene);
  let toolActive = false;

  const clearPreview = () => {
    if (preview){
      sceneManager.scene.remove(preview);
      preview.geometry.dispose(); preview.material.dispose();
      preview = null;
    }
  };

  const pivot = () => (cameraControls?.target) ?? new THREE.Vector3(0, 0.8, 0);

  // show/hide the draw plane as the pen tool becomes active
  bus.on('tool:changed', id => {
    toolActive = (id === 'pen');
    if (toolActive){ drawPlane.show(); bus.emit('pen:depth', drawPlane.offset); }
    else drawPlane.hide();
  });
  // keep the plane glued to the current view each frame while active
  sceneManager.addRenderHook(() => {
    if (!toolActive) return;
    drawPlane.update(sceneManager.camera, pivot());
  });
  // depth adjustment (from Ctrl+arrows or the panel slider)
  bus.on('pen:setDepth', v => { drawPlane.setOffset(v); bus.emit('pen:depth', drawPlane.offset); });
  bus.on('pen:nudgeDepth', d => { drawPlane.nudge(d); bus.emit('pen:depth', drawPlane.offset); });
  bus.on('pen:getDepth', cb => { if (typeof cb === 'function') cb(drawPlane.offset); });

  return {
    label:'Pen', key:'p', needsSelection:false,
    _drawPlane: drawPlane,
    icon:'<path d="M4 20s1-4 3-6l9-9 3 3-9 9c-2 2-6 3-6 3z"/><path d="M14 4l3 3"/>',
    hint: () => 'draw to trace a 3D tube · Ctrl+↑/↓ or the slider sets depth',
    claim(x, y, ctx){
      // draw on the SAME plane the minimap shows: camera-facing, at the
      // adjustable draw depth (pivot shifted along the view by offset).
      const pv = ctx.cameraControls?.target ?? pivot();
      ctx.plane = drawPlane.computePlane(ctx.camera, pv);
      const p = ctx.pointOnPlane(x, y, ctx.plane);
      if (!p) return false;
      ctx.points = [p];
      return true;
    },
    begin(x, y, ctx){ /* first point captured in claim() */ },
    update(x, y, sx, sy, ctx){
      const p = ctx.pointOnPlane(x, y, ctx.plane);
      if (!p) return;
      const last = ctx.points[ctx.points.length - 1];
      if (p.distanceTo(last) < MIN_STEP) return;
      ctx.points.push(p);
      const geom = buildTube(ctx.points, RADIUS, SEGMENTS);
      if (!geom) return;
      clearPreview();
      preview = new THREE.Mesh(geom,
        new THREE.MeshStandardMaterial({ color:new THREE.Color('#FF9838'), roughness:0.5, metalness:0.1 }));
      preview.castShadow = true;
      sceneManager.scene.add(preview);
    },
    end(ctx){
      clearPreview();
      if (!ctx.points || ctx.points.length < 2){ return; }
      const geom = buildTube(ctx.points, RADIUS, SEGMENTS);
      if (!geom){ return; }
      const mesh = om.addMesh(geom, { name:'Stroke', color:'#C9CFD8' });
      mesh.userData.deformed = true;   // arbitrary geom; keep exact verts on save
      om.select(mesh);
      bus.emit('history:commit');
      toast('Stroke added');
    }
  };
}
