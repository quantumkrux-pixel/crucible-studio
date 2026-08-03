/* global THREE */
// Drags the selected object along the ground plane, or vertically
// when the lift toggle is on (state.lift).
export default {
  label:'Move', key:'g',
  icon:'<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
  hint: s => s.lift ? 'drag selected object up / down' : 'drag selected object along the ground',
  begin(x, y, ctx){
    const { object, camera, state } = ctx;
    ctx.plane = new THREE.Plane();
    if (state.lift){
      const n = camera.getWorldDirection(new THREE.Vector3()); n.y = 0; n.normalize().negate();
      ctx.plane.setFromNormalAndCoplanarPoint(n, object.position);
    } else {
      ctx.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0,1,0),
        new THREE.Vector3(0, object.position.y, 0));
    }
    const p = ctx.pointOnPlane(x, y, ctx.plane);
    ctx.grab = p ? p.clone().sub(object.position) : new THREE.Vector3();
  },
  update(x, y, sx, sy, ctx){
    const p = ctx.pointOnPlane(x, y, ctx.plane);
    if (!p) return;
    if (ctx.state.lift) ctx.object.position.y = Math.max(0, p.y - ctx.grab.y);
    else { ctx.object.position.x = p.x - ctx.grab.x; ctx.object.position.z = p.z - ctx.grab.z; }
  }
};
