import toast from '../ui/toast.js';

// One-shot object actions for the "More Tools…" group. These register
// with ToolManager like any tool but carry `instant: true`, so tapping
// them runs immediately instead of entering a modal drag mode.
//
// Mirror/flip bake the reflection into the geometry (negated axis,
// re-wound triangles, recomputed normals) rather than using negative
// scale — so lighting stays correct and the result persists through
// save/undo/export like any other deformation.

function mirrorGeometry(g, axis){
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++){
    if (axis === 'x') pos.setX(i, -pos.getX(i));
    else pos.setY(i, -pos.getY(i));
  }
  const idx = g.index;
  if (idx){
    for (let i = 0; i < idx.count; i += 3){
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
    idx.needsUpdate = true;
  } else {
    for (let i = 0; i < pos.count; i += 3){
      const bx = pos.getX(i+1), by = pos.getY(i+1), bz = pos.getZ(i+1);
      pos.setXYZ(i+1, pos.getX(i+2), pos.getY(i+2), pos.getZ(i+2));
      pos.setXYZ(i+2, bx, by, bz);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

const needSelection = om => {
  if (om.selected) return om.selected;
  toast('Select an object first');
  return null;
};

// Creates a mirrored duplicate across the world X plane — position,
// rotation, and geometry all reflected. Great for symmetric builds.
export function makeMirrorAction(om){
  return {
    label:'Mirror', key:'m', instant:true,
    icon:'<path d="M12 3v18" stroke-dasharray="2 3"/><path d="M8 7v10L3 12l5-5z"/><path d="M16 7v10l5-5-5-5z"/>',
    run(){
      const src = needSelection(om); if (!src) return;
      const copy = om.duplicate(src);
      if (!copy) return;
      mirrorGeometry(copy.geometry, 'x');
      copy.userData.deformed = true;
      copy.userData.name = src.userData.name + ' mirror';
      copy.position.set(-src.position.x, src.position.y, src.position.z);
      copy.rotation.set(src.rotation.x, -src.rotation.y, -src.rotation.z);
      om.notifyTransformed();
      toast('Mirrored across X');
    }
  };
}

// Flips the selected object in place (horizontal = across its local
// vertical plane, vertical = upside down).
export function makeFlipAction(om, axis){
  const horizontal = axis === 'x';
  return {
    label: horizontal ? 'Flip H' : 'Flip V', instant:true,
    icon: horizontal
      ? '<path d="M3 12h18"/><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/>'
      : '<path d="M12 3v18"/><path d="M8 7l4-4 4 4"/><path d="M8 17l4 4 4-4"/>',
    run(){
      const o = needSelection(om); if (!o) return;
      mirrorGeometry(o.geometry, axis);
      o.userData.deformed = true;
      om.notifyTransformed();
      om.bus.emit('history:commit');
      toast(horizontal ? 'Flipped horizontally' : 'Flipped vertically');
    }
  };
}

// Duplicate the selected object (same as pressing D).
export function makeCloneAction(om){
  return {
    label:'Clone', instant:true,
    icon:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    run(){
      const o = needSelection(om); if (!o) return;
      om.duplicate(o);
      toast('Cloned');
    }
  };
}
