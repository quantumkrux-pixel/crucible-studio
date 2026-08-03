/* global THREE */
import RotationGizmo from './RotationGizmo.js';

// Rotate tool with an axis gizmo. Grab a colored ring (X/Y/Z) to rotate
// around that world axis; grab the object elsewhere for free rotation.
// The gizmo shows whenever this tool is active with an object selected.
export function makeRotateTool(bus, sceneManager, objectManager){
  const gizmo = new RotationGizmo(sceneManager.scene);
  const WORLD = { x:new THREE.Vector3(1,0,0), y:new THREE.Vector3(0,1,0), z:new THREE.Vector3(0,0,1) };

  const refresh = () => {
    const on = tool._active && objectManager.selected;
    if (on) gizmo.show(objectManager.selected);
    else gizmo.hide();
  };
  bus.on('tool:changed', id => { tool._active = (id === 'rotate'); refresh(); });
  bus.on('selection:changed', refresh);
  bus.on('object:transformed', () => gizmo.update());
  sceneManager.addRenderHook(() => gizmo.update());

  const tool = {
    label:'Rotate', key:'r', _active:false,
    icon:'<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 3v5h-5"/>',
    hint: () => 'grab a ring to rotate on that axis, or drag the object to rotate freely',

    claim(x, y, ctx){
      const axis = gizmo.pick(ctx.raycasterAt(x, y));
      if (axis){ ctx._axis = axis; gizmo.highlight(axis); return true; }
      const hit = ctx.raycasterAt(x, y).intersectObject(ctx.object, false);
      if (hit.length){ ctx._axis = null; return true; }
      return false;
    },

    begin(x, y, ctx){
      ctx.startQuat = ctx.object.quaternion.clone();
      if (ctx._axis){
        const c = new THREE.Vector3();
        new THREE.Box3().setFromObject(ctx.object).getCenter(c);
        ctx._center2d = worldToScreen(c, ctx.camera, sceneManager.renderer.domElement);
        ctx._startAngle = Math.atan2(y - ctx._center2d.y, x - ctx._center2d.x);
      }
    },

    update(x, y, sx, sy, ctx){
      if (ctx._axis){
        const a = Math.atan2(y - ctx._center2d.y, x - ctx._center2d.x);
        const delta = a - ctx._startAngle;
        const sign = ctx._axis === 'y' ? -1 : 1;
        const q = new THREE.Quaternion().setFromAxisAngle(WORLD[ctx._axis], delta * sign);
        ctx.object.quaternion.copy(q.multiply(ctx.startQuat));
      } else {
        const qy = new THREE.Quaternion().setFromAxisAngle(WORLD.y, (x - sx) * 0.012);
        const qx = new THREE.Quaternion().setFromAxisAngle(WORLD.x, (y - sy) * 0.012);
        ctx.object.quaternion.copy(qy.multiply(qx).multiply(ctx.startQuat));
      }
      ctx.object.rotation.setFromQuaternion(ctx.object.quaternion, ctx.object.rotation.order);
      gizmo.update();
    },

    end(ctx){ ctx._axis = null; gizmo.highlight(null); }
  };
  return tool;
}

function worldToScreen(v, camera, dom){
  const p = v.clone().project(camera);
  const r = dom.getBoundingClientRect();
  return { x:r.left + (p.x * 0.5 + 0.5) * r.width, y:r.top + (-p.y * 0.5 + 0.5) * r.height };
}
