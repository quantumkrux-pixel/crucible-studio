/* global THREE */
// Rotation gizmo: three axis rings (X red, Y green, Z blue) drawn around
// the selected object while the Rotate tool is active. Grabbing a ring
// constrains rotation to that world axis; grabbing empty space on the
// object falls back to free trackball-style rotation.
//
// The gizmo is a THREE.Group added to the scene, shown/hidden by the
// RotateTool. Its rings are raycast targets tagged with userData.axis.

const AXIS_COLORS = { x:0xFF5A5A, y:0x5AE07B, z:0x5AA6FF };
const AXIS_HILITE = { x:0xFF9838, y:0xFF9838, z:0xFF9838 };

export default class RotationGizmo {
  constructor(scene){
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.renderOrder = 5;
    this.rings = {};
    for (const axis of ['x','y','z']){
      // torus lies in the XY plane by default; orient per axis
      const geo = new THREE.TorusGeometry(1, 0.018, 12, 96);
      const mat = new THREE.MeshBasicMaterial({ color:AXIS_COLORS[axis], transparent:true, opacity:0.9,
        depthTest:false });
      const ring = new THREE.Mesh(geo, mat);
      ring.userData.axis = axis;
      ring.renderOrder = 5;
      if (axis === 'x') ring.rotation.y = Math.PI / 2;   // ring around X → face along X
      if (axis === 'y') ring.rotation.x = Math.PI / 2;   // ring around Y
      // z: default orientation already circles the Z axis
      this.rings[axis] = ring;
      this.group.add(ring);
    }
    // a faint sphere shell to read as a 3D guide
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0.04, depthWrite:false }));
    shell.renderOrder = 4;
    this.shell = shell;
    this.group.add(shell);
    scene.add(this.group);
  }

  show(obj){ this.target = obj; this.group.visible = true; this.update(); }
  hide(){ this.group.visible = false; this.target = null; this.#clearHilite(); }

  // keep the gizmo centered on and sized to the object each frame
  update(){
    if (!this.group.visible || !this.target) return;
    const box = new THREE.Box3().setFromObject(this.target);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius * 1.25, 0.4);
    this.group.position.copy(sphere.center);
    this.group.scale.setScalar(r);
  }

  // Raycast the rings; return the axis under the pointer or null.
  pick(raycaster){
    if (!this.group.visible) return null;
    const hits = raycaster.intersectObjects([this.rings.x, this.rings.y, this.rings.z], false);
    return hits.length ? hits[0].object.userData.axis : null;
  }

  // Highlight the active axis ring (on hover or during a drag).
  highlight(axis){
    this.#clearHilite();
    if (axis && this.rings[axis]){
      this.rings[axis].material.color.setHex(AXIS_HILITE[axis]);
      this.rings[axis].material.opacity = 1;
    }
  }
  #clearHilite(){
    for (const axis of ['x','y','z']){
      this.rings[axis].material.color.setHex(AXIS_COLORS[axis]);
      this.rings[axis].material.opacity = 0.9;
    }
  }
}
