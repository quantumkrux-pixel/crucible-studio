/* global THREE */
// Shows draggable vertex handles on the selected object while the
// Deform tool is active. Coincident (welded) vertices move together so
// the surface pulls instead of tearing. Handles share the mesh's
// geometry, so they follow every edit automatically.
export default class VertexEditor {
  constructor(bus, sceneManager, objectManager, toolManager){
    this.bus = bus; this.om = objectManager; this.tm = toolManager;
    this.host = null; this.points = null;
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 10),
      new THREE.MeshBasicMaterial({ color:0xFF9838, depthTest:false }));
    this.marker.renderOrder = 1000;
    this.marker.visible = false;
    sceneManager.scene.add(this.marker);
    bus.on('tool:changed', () => this.sync());
    bus.on('selection:changed', () => this.sync());
  }
  sync(){
    const want = this.tm.active === 'deform' ? this.om.selected : null;
    if (want === this.host) return;
    this.detach();
    if (want) this.attach(want);
  }
  attach(mesh){
    this.host = mesh;
    this.points = new THREE.Points(mesh.geometry,
      new THREE.PointsMaterial({ color:0xFF9838, size:0.14, sizeAttenuation:true, depthTest:false }));
    this.points.renderOrder = 999;
    mesh.add(this.points);
  }
  detach(){
    if (this.points && this.host) this.host.remove(this.points);
    if (this.points) this.points.material.dispose();   // geometry belongs to the mesh
    this.points = null; this.host = null;
    this.marker.visible = false;
  }
  intersect(raycaster){
    if (!this.points) return null;
    const hits = raycaster.intersectObject(this.points);
    if (!hits.length) return null;
    const pos = this.host.geometry.attributes.position;
    const idx = hits[0].index;
    const vx = pos.getX(idx), vy = pos.getY(idx), vz = pos.getZ(idx);
    const indices = [], eps = 1e-4;
    for (let i = 0; i < pos.count; i++)
      if (Math.abs(pos.getX(i)-vx) < eps && Math.abs(pos.getY(i)-vy) < eps && Math.abs(pos.getZ(i)-vz) < eps)
        indices.push(i);
    return { indices, worldPos: this.host.localToWorld(new THREE.Vector3(vx, vy, vz)) };
  }
  moveGroupWorld(indices, worldPoint){
    if (!this.host) return;
    const local = this.host.worldToLocal(worldPoint.clone());
    const pos = this.host.geometry.attributes.position;
    indices.forEach(i => pos.setXYZ(i, local.x, local.y, local.z));
    pos.needsUpdate = true;
    const g = this.host.geometry;
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    this.host.userData.deformed = true;
    this.marker.position.copy(worldPoint);
    this.marker.visible = true;
  }
  hideMarker(){ this.marker.visible = false; }
}
