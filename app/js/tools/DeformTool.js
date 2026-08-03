/* global THREE */
// Vertex-pull deformation. Uses claim() to grab drags that start on a
// vertex handle (rather than the object body), then moves the welded
// vertex group in a camera-facing plane. Pick radius scales with zoom
// distance so vertices stay tappable on touch screens.
export default function makeDeformTool(vertexEditor){
  return {
    label:'Deform', key:'v',
    icon:'<path d="M5 19h14L12 6z"/><circle cx="12" cy="6" r="2"/><circle cx="5" cy="19" r="1.4"/><circle cx="19" cy="19" r="1.4"/>',
    hint: () => 'drag an orange point to pull the surface',
    claim(x, y, ctx){
      const rc = ctx.raycasterAt(x, y);
      rc.params.Points = { threshold: Math.max(0.06,
        ctx.camera.position.distanceTo(ctx.object.position) * 0.02) };
      const hit = vertexEditor.intersect(rc);
      if (!hit) return false;
      ctx.vertexHit = hit;
      return true;
    },
    begin(x, y, ctx){
      const hit = ctx.vertexHit;
      ctx.indices = hit.indices;
      ctx.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        ctx.camera.getWorldDirection(new THREE.Vector3()).negate(), hit.worldPos);
      const p = ctx.pointOnPlane(x, y, ctx.plane);
      ctx.grab = p ? p.clone().sub(hit.worldPos) : new THREE.Vector3();
    },
    update(x, y, sx, sy, ctx){
      const p = ctx.pointOnPlane(x, y, ctx.plane);
      if (!p) return;
      vertexEditor.moveGroupWorld(ctx.indices, p.sub(ctx.grab));
    },
    end(){ vertexEditor.hideMarker(); }
  };
}
