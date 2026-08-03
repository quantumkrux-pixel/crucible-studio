/* global THREE */
import toast from '../ui/toast.js';

// Slice tool: with an object selected, drag a line across the screen
// and the object is cut by the plane through that line (perpendicular
// to the view). Both halves become separate objects with the cut
// capped, nudged slightly apart so the slice reads immediately.
// Smooth shading survives — normals are interpolated at the cut edge
// rather than recomputed. Halves become 'custom' objects that
// serialize their full vertex data.

function lerpVert(a, b, t){
  return {
    p: a.p.clone().lerp(b.p, t),
    n: a.n.clone().lerp(b.n, t).normalize()
  };
}
const keyOf = v => `${Math.round(v.x*1e4)},${Math.round(v.y*1e4)},${Math.round(v.z*1e4)}`;

// Clip every triangle against the plane (Sutherland–Hodgman per side),
// producing interleaved [px,py,pz,nx,ny,nz] arrays for each half plus
// the cut-edge segments for capping.
function clipGeometry(geom, plane){
  const pos = geom.attributes.position, nor = geom.attributes.normal, idx = geom.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const vAt = i => ({
    p: new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)),
    n: new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i))
  });
  const front = [], back = [], capSegs = [];
  const pushPoly = (poly, out) => {
    for (let k = 1; k < poly.length - 1; k++)
      for (const v of [poly[0], poly[k], poly[k+1]])
        out.push(v.p.x, v.p.y, v.p.z, v.n.x, v.n.y, v.n.z);
  };
  const eps = 1e-6;
  for (let t = 0; t < triCount; t++){
    const ids = idx
      ? [idx.getX(t*3), idx.getX(t*3+1), idx.getX(t*3+2)]
      : [t*3, t*3+1, t*3+2];
    const vs = ids.map(vAt);
    const d = vs.map(v => plane.distanceToPoint(v.p));
    if (d.every(x => x >= -eps)){ pushPoly(vs, front); continue; }
    if (d.every(x => x <= eps)){ pushPoly(vs, back); continue; }
    const cut = [];
    const side = keepPos => {
      const poly = [];
      for (let i = 0; i < 3; i++){
        const j = (i+1) % 3;
        const da = keepPos ? d[i] : -d[i];
        const db = keepPos ? d[j] : -d[j];
        if (da >= 0) poly.push(vs[i]);
        if ((da >= 0) !== (db >= 0)){
          const v = lerpVert(vs[i], vs[j], da / (da - db));
          poly.push(v);
          if (keepPos) cut.push(v.p);
        }
      }
      return poly;
    };
    const f = side(true), b = side(false);
    if (f.length >= 3) pushPoly(f, front);
    if (b.length >= 3) pushPoly(b, back);
    if (cut.length === 2) capSegs.push(cut);
  }
  return { front, back, capSegs };
}

// Chain cut-edge segments into closed loops (handles multi-loop cuts,
// e.g. slicing through both sides of a torus).
function chainLoops(segs){
  const map = new Map();
  const add = (k, i) => (map.get(k) ?? map.set(k, []).get(k)).push(i);
  segs.forEach((s, i) => { add(keyOf(s[0]), i); add(keyOf(s[1]), i); });
  const used = new Set(), loops = [];
  segs.forEach((s, i) => {
    if (used.has(i)) return;
    used.add(i);
    const loop = [s[0], s[1]];
    let guard = segs.length * 2;
    while (guard-- > 0){
      const endKey = keyOf(loop[loop.length - 1]);
      const next = (map.get(endKey) ?? []).find(j => !used.has(j));
      if (next === undefined) break;
      used.add(next);
      const [a, b] = segs[next];
      loop.push(keyOf(a) === endKey ? b : a);
      if (keyOf(loop[loop.length - 1]) === keyOf(loop[0])){ loop.pop(); break; }
    }
    if (loop.length >= 3) loops.push(loop);
  });
  return loops;
}

// Fan-triangulate each loop from its centroid, wound to face `normal`.
function capFans(loops, normal, out){
  loops.forEach(loop => {
    const c = loop.reduce((a, p) => a.clone().add(p), new THREE.Vector3()).divideScalar(loop.length);
    const e1 = loop[0].clone().sub(c), e2 = loop[1].clone().sub(c);
    const flip = e1.cross(e2).dot(normal) < 0;
    for (let i = 0; i < loop.length; i++){
      const a = loop[i], b = loop[(i+1) % loop.length];
      const tri = flip ? [c, b, a] : [c, a, b];
      for (const p of tri) out.push(p.x, p.y, p.z, normal.x, normal.y, normal.z);
    }
  });
}

function buildGeometry(arr){
  const count = arr.length / 6;
  const p = new Float32Array(count*3), n = new Float32Array(count*3);
  for (let i = 0; i < count; i++){
    p[i*3] = arr[i*6];   p[i*3+1] = arr[i*6+1]; p[i*3+2] = arr[i*6+2];
    n[i*3] = arr[i*6+3]; n[i*3+1] = arr[i*6+4]; n[i*3+2] = arr[i*6+5];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export default function makeSliceTool(om){
  let overlay = null, line = null, vpRect = null;
  const ensure = () => {
    overlay ??= document.getElementById('slice-overlay');
    line ??= document.getElementById('slice-line');
  };
  const draw = (x1, y1, x2, y2) => {
    line.setAttribute('x1', x1 - vpRect.left);
    line.setAttribute('y1', y1 - vpRect.top);
    line.setAttribute('x2', x2 - vpRect.left);
    line.setAttribute('y2', y2 - vpRect.top);
  };
  return {
    label:'Slice', key:'k',
    icon:'<path d="M3 20L17 6"/><path d="M15.5 3.5l5 5-4 1.5L14 7.5z"/>',
    hint: () => 'drag a line across the object to slice it in two',
    claim(){ return true; },   // any drag draws a slice line; taps still select
    begin(x, y, ctx){
      ensure();
      vpRect = overlay.getBoundingClientRect();
      const r = ctx.raycasterAt(x, y);
      ctx.o1 = r.ray.origin.clone();
      ctx.d1 = r.ray.direction.clone();
      ctx.sx = x; ctx.sy = y; ctx.lx = x; ctx.ly = y;
      overlay.classList.add('active');
      draw(x, y, x, y);
    },
    update(x, y, sx, sy, ctx){
      ctx.lx = x; ctx.ly = y;
      draw(sx, sy, x, y);
    },
    end(ctx){
      overlay?.classList.remove('active');
      const mesh = ctx.object;
      if (Math.hypot(ctx.lx - ctx.sx, ctx.ly - ctx.sy) < 15) return;

      // cutting plane: through the drawn line, perpendicular to the view
      const r2 = ctx.raycasterAt(ctx.lx, ctx.ly);
      const P0 = ctx.o1;
      const P1 = ctx.o1.clone().add(ctx.d1);
      const P2 = r2.ray.origin.clone().add(r2.ray.direction);
      const nWorld = new THREE.Vector3().subVectors(P1, P0)
        .cross(new THREE.Vector3().subVectors(P2, P0));
      if (nWorld.lengthSq() < 1e-12) return;
      nWorld.normalize();
      const planeWorld = new THREE.Plane().setFromNormalAndCoplanarPoint(nWorld, P0);
      mesh.updateMatrixWorld(true);
      const planeLocal = planeWorld.clone()
        .applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert());

      const { front, back, capSegs } = clipGeometry(mesh.geometry, planeLocal);
      if (!front.length || !back.length){
        toast('Draw the line across the object');
        return;
      }
      const loops = chainLoops(capSegs);
      const nLocal = planeLocal.normal;
      capFans(loops, nLocal.clone().negate(), front);
      capFans(loops, nLocal.clone(), back);

      const src = {
        color: '#' + mesh.material.color.getHexString(),
        position: mesh.position.clone(),
        rotation: mesh.rotation.clone(),
        scale: mesh.scale.clone()
      };
      const baseName = mesh.userData.name;
      om.remove(mesh);
      const half = (arr, suffix, sign) => {
        const m = om.addMesh(buildGeometry(arr), { ...src, name: baseName + suffix });
        m.position.addScaledVector(nWorld, sign * 0.12);
        return m;
      };
      half(front, ' a', 1);
      om.select(half(back, ' b', -1));
      toast('Sliced into two objects');
    }
  };
}
