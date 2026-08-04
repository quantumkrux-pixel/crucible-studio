/* global THREE */
// AnchorManager — binds an object (A) to a point on another object (B).
//
// The anchor is the nearest point on A to B at bind time. Two behaviors,
// enforced together every frame:
//   • PINNED  — A's anchor point can't drift away from the bound spot.
//   • FOLLOWS — when B moves/rotates/scales, the bound spot moves with it
//               (it's stored in B's LOCAL space), and A is carried along.
//
// Manipulation of A stays possible (rotate + scale), but those happen
// about the anchor point, so the pin never separates. If A is moved, the
// enforcement snaps its anchor point back onto the bound spot afterward,
// so it can reorient but not detach.
//
// A binding: {
//   aUid, bUid,
//   localToB  — anchor point in B's local space (Vector3)
//   localToA  — anchor point in A's local space (Vector3), so we know which
//               point of A must stay pinned as A rotates/scales
// }
//
// Bindings persist with the project (toJSON / fromJSON).

export default class AnchorManager {
  constructor(bus, objectManager){
    this.bus = bus; this.om = objectManager;
    this.bindings = [];          // active anchor bindings
    this.markers = new Map();    // aUid → marker mesh
    this._markerGeo = null;
    // enforce every frame (registered from main via addRenderHook)
    this._enforce = () => this.enforce();
  }

  #scene(){ return this.om.scene; }

  // A small glowing sphere shown at an anchor point.
  #makeMarker(){
    if (!this._markerGeo) this._markerGeo = new THREE.SphereGeometry(0.06, 16, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xFF6B2C, depthTest: false, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(this._markerGeo, mat);
    m.renderOrder = 999;         // draw on top
    // a faint outer ring for visibility against same-color objects
    const ringGeo = new THREE.RingGeometry(0.09, 0.12, 20);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xFF9838, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.7 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    m.add(ring);
    m._ring = ring;
    return m;
  }
  #syncMarkers(){
    const scene = this.#scene(); if (!scene) return;
    // remove markers for bindings that no longer exist
    for (const [uid, m] of this.markers){
      if (!this.bindings.some(x => x.aUid === uid)){
        scene.remove(m); m.geometry && (m._ring.geometry.dispose());
        m.material.dispose(); m._ring.material.dispose();
        this.markers.delete(uid);
      }
    }
    // add markers for new bindings
    for (const x of this.bindings){
      if (!this.markers.has(x.aUid)){
        const m = this.#makeMarker();
        scene.add(m);
        this.markers.set(x.aUid, m);
      }
    }
  }

  #byUid(uid){ return this.om.objects.find(o => o.userData.uid === uid) || null; }

  // Bind object A to target B. The anchor = nearest point on A's surface
  // to B's center (in world space at bind time).
  bind(a, b){
    if (!a || !b || a === b) return null;
    // remove any existing binding for A (one anchor per object)
    this.unbind(a.userData.uid, true);

    a.updateMatrixWorld(true); b.updateMatrixWorld(true);
    const bCenter = new THREE.Vector3();
    b.getWorldPosition(bCenter);

    // nearest vertex on A to B's center, in world space
    const pos = a.geometry.attributes.position;
    const v = new THREE.Vector3();
    let best = null, bestD = Infinity;
    for (let i = 0; i < pos.count; i++){
      v.fromBufferAttribute(pos, i).applyMatrix4(a.matrixWorld);
      const d = v.distanceToSquared(bCenter);
      if (d < bestD){ bestD = d; best = v.clone(); }
    }
    if (!best) best = a.getWorldPosition(new THREE.Vector3());

    // record the anchor point in BOTH objects' local spaces
    const localToA = best.clone().applyMatrix4(new THREE.Matrix4().copy(a.matrixWorld).invert());
    const localToB = best.clone().applyMatrix4(new THREE.Matrix4().copy(b.matrixWorld).invert());

    const binding = { aUid: a.userData.uid, bUid: b.userData.uid, localToA, localToB };
    this.bindings.push(binding);
    a.userData.anchoredTo = b.userData.uid;
    this.#syncMarkers();
    this.bus.emit('anchors:changed');
    return binding;
  }

  unbind(aUid, silent){
    const i = this.bindings.findIndex(x => x.aUid === aUid);
    if (i >= 0){
      const a = this.#byUid(aUid);
      if (a) delete a.userData.anchoredTo;
      this.bindings.splice(i, 1);
      if (!silent) this.bus.emit('anchors:changed');
      this.#syncMarkers();
      return true;
    }
    return false;
  }

  isAnchored(uid){ return this.bindings.some(x => x.aUid === uid); }
  bindingFor(uid){ return this.bindings.find(x => x.aUid === uid) || null; }

  // The world-space anchor point of A (where its pinned point currently is).
  anchorWorldOfA(binding){
    const a = this.#byUid(binding.aUid); if (!a) return null;
    a.updateMatrixWorld();
    return binding.localToA.clone().applyMatrix4(a.matrixWorld);
  }
  // The world-space target point on B (where A's anchor SHOULD be).
  targetWorldOnB(binding){
    const b = this.#byUid(binding.bUid); if (!b) return null;
    b.updateMatrixWorld();
    return binding.localToB.clone().applyMatrix4(b.matrixWorld);
  }

  // Every frame: for each binding, shift A so its anchor point coincides
  // with the target point on B. This delivers BOTH pinned + follows: the
  // target point is derived from B's live transform, and A is corrected to
  // meet it. Because this runs after the rotate/scale tools update A each
  // frame, A effectively rotates and scales ABOUT the anchor point — the
  // point is held fixed while the rest of A pivots around it.
  // Also positions the visual anchor markers. `camera` (optional) orients
  // the marker ring to face the viewer.
  enforce(camera){
    if (!this.bindings.length) return;
    for (const binding of this.bindings){
      const a = this.#byUid(binding.aUid), b = this.#byUid(binding.bUid);
      if (!a || !b){ continue; }
      a.updateMatrixWorld(); b.updateMatrixWorld();
      const target = binding.localToB.clone().applyMatrix4(b.matrixWorld);
      const current = binding.localToA.clone().applyMatrix4(a.matrixWorld);
      const delta = target.clone().sub(current);
      if (delta.lengthSq() > 1e-10){
        a.position.add(delta);
        a.updateMatrixWorld();
      }
      // place the marker at the (now-coincident) anchor point
      const m = this.markers.get(binding.aUid);
      if (m){
        m.position.copy(target);
        if (camera){
          m._ring.lookAt(camera.position);
          // scale with distance so the marker keeps a consistent on-screen
          // size regardless of zoom or object scale
          const dist = camera.position.distanceTo(target);
          const s = Math.max(0.4, dist * 0.06);
          m.scale.setScalar(s);
        }
      }
    }
  }

  // Drop bindings whose A or B object no longer exists in the scene
  // (after a delete or merge). Called on objects:changed.
  pruneMissing(){
    const alive = new Set(this.om.objects.map(o => o.userData.uid));
    const before = this.bindings.length;
    this.bindings = this.bindings.filter(x => {
      const ok = alive.has(x.aUid) && alive.has(x.bUid);
      if (!ok){ const a = this.#byUid(x.aUid); if (a) delete a.userData.anchoredTo; }
      return ok;
    });
    if (this.bindings.length !== before) this.bus.emit('anchors:changed');
    this.#syncMarkers();
  }

  toJSON(){
    if (!this.bindings.length) return undefined;
    return this.bindings.map(x => ({
      aUid: x.aUid, bUid: x.bUid,
      localToA: x.localToA.toArray(),
      localToB: x.localToB.toArray()
    }));
  }
  fromJSON(data){
    this.bindings = Array.isArray(data) ? data.map(x => ({
      aUid: x.aUid, bUid: x.bUid,
      localToA: new THREE.Vector3().fromArray(x.localToA),
      localToB: new THREE.Vector3().fromArray(x.localToB)
    })) : [];
    // re-tag objects
    for (const x of this.bindings){
      const a = this.#byUid(x.aUid);
      if (a) a.userData.anchoredTo = x.bUid;
    }
    this.bus.emit('anchors:changed');
    this.#syncMarkers();
  }
}
