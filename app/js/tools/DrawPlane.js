/* global THREE */
// DrawPlane — a glowing, semi-transparent "canvas" that visualizes where
// the Magic Pen will draw in 3D space (its depth). It's camera-facing and
// sits at the pen's current draw depth: the orbit pivot shifted along the
// view direction by an adjustable offset.
//
// It renders ONLY in the preview minimap, not the main view — so the main
// viewport stays clean while the minimap shows the plane edge-on against
// your objects, making the depth readable. This is done with a dedicated
// THREE layer (MINIMAP_LAYER): the plane is assigned to it, the main
// camera is told to ignore that layer, and the minimap camera to include
// it.
//
// Depth offset is in world units: 0 = at the pivot, + = farther from the
// camera, - = nearer. Persisted per-project.

export const MINIMAP_LAYER = 2;   // objects on this layer show only in the minimap

export default class DrawPlane {
  constructor(scene){
    this.scene = scene;
    this.offset = 0;          // world-units along view dir from the pivot
    this.visible = false;

    const geo = new THREE.PlaneGeometry(1, 1);
    // glowing semi-transparent fill
    const fill = new THREE.MeshBasicMaterial({
      color: 0xFF9838, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false, depthTest: false
    });
    this.mesh = new THREE.Mesh(geo, fill);
    // a brighter border frame so the plane edge reads clearly
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineBasicMaterial({ color: 0xFF9838, transparent: true, opacity: 0.85 });
    this.frame = new THREE.LineSegments(edges, line);
    this.mesh.add(this.frame);

    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.visible = false;
    // assign the whole group to the minimap-only layer
    this.group.traverse(o => o.layers.set(MINIMAP_LAYER));
    scene.add(this.group);
  }

  show(){ this.visible = true; this.group.visible = true; }
  hide(){ this.visible = false; this.group.visible = false; }

  setOffset(v){ this.offset = v; }
  nudge(delta){ this.offset += delta; return this.offset; }

  // Position + orient the plane at the current draw depth. Called each
  // frame while the pen is active. `camera` is the MAIN view camera;
  // `pivot` is the orbit target.
  update(camera, pivot){
    if (!this.visible) return;
    const viewDir = camera.getWorldDirection(new THREE.Vector3());   // points into scene
    // draw depth = pivot shifted along the view direction by offset
    const center = pivot.clone().add(viewDir.clone().multiplyScalar(this.offset));
    this.group.position.copy(center);
    // face the camera: orient the plane's normal to -viewDir
    const look = center.clone().sub(viewDir);   // a point toward the camera
    this.group.lookAt(look);
    // scale the plane to a sensible size relative to camera distance
    const dist = camera.position.distanceTo(center);
    const s = Math.max(1.5, dist * 0.6);
    this.group.scale.set(s, s, 1);
  }

  // The actual world-space draw plane the pen should use, matching what
  // the visual shows: camera-facing, through the offset center.
  computePlane(camera, pivot){
    const n = camera.getWorldDirection(new THREE.Vector3()).negate();
    const viewDir = n.clone().negate();
    const center = pivot.clone().add(viewDir.multiplyScalar(this.offset));
    return new THREE.Plane().setFromNormalAndCoplanarPoint(n, center);
  }
}
