/* global THREE */
// Face-level editing support for the Face tool.
//
// pickFace() turns a raycast hit into a "logical face": the hit
// triangle plus every connected coplanar triangle with the same facing
// (a cube side = 2 triangles, a cylinder cap = a full fan), expanded to
// all welded duplicate vertices so adjacent faces stretch with the drag
// instead of tearing.
//
// During a drag the face slides along its own normal — push/pull, like
// stretching a cube into a beam. Visuals: an orange overlay on the
// grabbed face and an arrow showing the drag axis.
export default class FaceEditor {
  constructor(bus, sceneManager, objectManager, toolManager){
    this.scene = sceneManager.scene;
    this.om = objectManager; this.tm = toolManager;
    this.session = null;          // active drag state
    this.overlay = null; this.overlayMap = null; this.arrow = null;
    bus.on('tool:changed', () => this.cancel());
    bus.on('selection:changed', () => this.cancel());
  }

  // ---- picking ----
  pickFace(raycaster, mesh){
    const hits = raycaster.intersectObject(mesh, false);
    if (!hits.length) return null;
    mesh.updateMatrixWorld(true);
    const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const getTri = t => idx
      ? [idx.getX(t*3), idx.getX(t*3+1), idx.getX(t*3+2)]
      : [t*3, t*3+1, t*3+2];
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const triNormal = (t, out) => {
      const [a,b,c] = getTri(t);
      vA.fromBufferAttribute(pos, a);
      vB.fromBufferAttribute(pos, b);
      vC.fromBufferAttribute(pos, c);
      e1.subVectors(vB, vA); e2.subVectors(vC, vA);
      return out.crossVectors(e1, e2).normalize();
    };

    // reference normal + anchor point of the hit triangle
    const n0 = triNormal(hits[0].faceIndex, new THREE.Vector3());
    const anchor = vA.clone();

    // collect same-facing, coplanar triangles
    const n = new THREE.Vector3(), toAnchor = new THREE.Vector3();
    const tris = [];
    for (let t = 0; t < triCount; t++){
      triNormal(t, n);                       // also loads vA with this tri's first vert
      if (n.dot(n0) < 0.999) continue;
      toAnchor.subVectors(vA, anchor);
      if (Math.abs(toAnchor.dot(n0)) > 1e-3) continue;
      tris.push(t);
    }

    // unique corner positions of the face
    const faceIdx = new Set();
    tris.forEach(t => getTri(t).forEach(i => faceIdx.add(i)));
    const uniq = [], seen = new Set();
    const centroid = new THREE.Vector3();
    for (const i of faceIdx){
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = `${Math.round(x*1e4)},${Math.round(y*1e4)},${Math.round(z*1e4)}`;
      if (!seen.has(k)){ seen.add(k); uniq.push([x, y, z]); centroid.add(new THREE.Vector3(x, y, z)); }
    }
    centroid.divideScalar(uniq.length || 1);

    // weld: expand to every coincident vertex in the whole geometry
    const eps = 1e-4, indices = [];
    for (let i = 0; i < pos.count; i++){
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      for (const [ux, uy, uz] of uniq)
        if (Math.abs(x-ux) < eps && Math.abs(y-uy) < eps && Math.abs(z-uz) < eps){ indices.push(i); break; }
    }

    return {
      tris, indices, getTri,
      centroidWorld: mesh.localToWorld(centroid.clone()),
      normalWorld: n0.clone().transformDirection(mesh.matrixWorld)
    };
  }

  // ---- drag session ----
  beginDrag(mesh, hit, raycaster){
    this.cancel();
    this.session = {
      mesh, hit,
      start: mesh.geometry.attributes.position.array.slice(),
      axisOrigin: hit.centroidWorld.clone(),
      axisDir: hit.normalWorld.clone(),
      s0: 0
    };
    this.session.s0 = this.axisParam(raycaster) ?? 0;
    this.#showVisuals(mesh, hit);
  }
  // Parameter along the face-normal axis closest to the pointer ray.
  axisParam(raycaster){
    if (!this.session) return null;
    const O = raycaster.ray.origin, r = raycaster.ray.direction;
    const w = new THREE.Vector3().subVectors(this.session.axisOrigin, O);
    const b = this.session.axisDir.dot(r);
    const denom = 1 - b*b;
    if (Math.abs(denom) < 1e-6) return null;   // axis parallel to view ray
    return (b * r.dot(w) - this.session.axisDir.dot(w)) / denom;
  }
  dragTo(offset){
    const s = this.session; if (!s) return;
    const worldDelta = s.axisDir.clone().multiplyScalar(offset);
    // world displacement → local displacement (correct under any transform)
    const L1 = s.mesh.worldToLocal(s.axisOrigin.clone());
    const L2 = s.mesh.worldToLocal(s.axisOrigin.clone().add(worldDelta));
    const d = L2.sub(L1);
    const pos = s.mesh.geometry.attributes.position;
    for (const i of s.hit.indices)
      pos.setXYZ(i, s.start[i*3] + d.x, s.start[i*3+1] + d.y, s.start[i*3+2] + d.z);
    pos.needsUpdate = true;
    const g = s.mesh.geometry;
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    s.mesh.userData.deformed = true;
    this.#syncOverlay();
    if (this.arrow) this.arrow.position.copy(s.axisOrigin).add(worldDelta);
  }
  endDrag(){ this.cancel(); }
  cancel(){
    if (this.overlay){
      this.overlay.parent?.remove(this.overlay);
      this.overlay.geometry.dispose();
      this.overlay.material.dispose();
      this.overlay = null; this.overlayMap = null;
    }
    if (this.arrow){
      this.scene.remove(this.arrow);
      this.arrow.line.geometry.dispose(); this.arrow.line.material.dispose();
      this.arrow.cone.geometry.dispose(); this.arrow.cone.material.dispose();
      this.arrow = null;
    }
    this.session = null;
  }

  // ---- visuals ----
  #showVisuals(mesh, hit){
    const pos = mesh.geometry.attributes.position;
    this.overlayMap = [];
    hit.tris.forEach(t => hit.getTri(t).forEach(i => this.overlayMap.push(i)));
    const arr = new Float32Array(this.overlayMap.length * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.overlay = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color:0xFF9838, transparent:true, opacity:0.35, side:THREE.DoubleSide, depthTest:false }));
    this.overlay.renderOrder = 998;
    mesh.add(this.overlay);
    this.#syncOverlay();

    this.arrow = new THREE.ArrowHelper(hit.normalWorld, hit.centroidWorld, 1.1, 0xFF9838, 0.22, 0.11);
    this.arrow.line.material.depthTest = false;
    this.arrow.cone.material.depthTest = false;
    this.arrow.renderOrder = 999;
    this.scene.add(this.arrow);
  }
  #syncOverlay(){
    if (!this.overlay || !this.session) return;
    const src = this.session.mesh.geometry.attributes.position;
    const dst = this.overlay.geometry.attributes.position;
    this.overlayMap.forEach((hostIdx, j) =>
      dst.setXYZ(j, src.getX(hostIdx), src.getY(hostIdx), src.getZ(hostIdx)));
    dst.needsUpdate = true;
    this.overlay.geometry.computeBoundingSphere();
  }
}
