/* global THREE */
import toast from '../ui/toast.js';

// Hollow: turn a solid object into a shell with walls of a set
// thickness. Works on any geometry (primitives, deformed, sliced,
// merged, pen strokes) because it operates on the triangle surface,
// not a parametric solid.
//
// Method: keep the outer surface, then build an INNER surface by
// copying every triangle, pushing its vertices inward along their
// normals by `thickness`, and reversing the winding so the inner
// faces point into the cavity. Outer + flipped-inner = a wall you can
// see the thickness of, and that slicers read as hollow.
//
// The result is a 'custom' object (baked triangle geometry), so it
// persists through save / undo / export like other mesh edits. The
// operation bakes the object's scale into the geometry first so wall
// thickness stays uniform even on non-uniformly scaled objects.

// Average the normals of coincident (welded) vertices so the inner
// offset direction is smooth across shared edges — otherwise faceted
// meshes push corners apart and self-intersect.
function weldedNormals(pos, nor){
  const map = new Map();
  const key = i => `${Math.round(pos.getX(i)*1e4)},${Math.round(pos.getY(i)*1e4)},${Math.round(pos.getZ(i)*1e4)}`;
  for (let i = 0; i < pos.count; i++){
    const k = key(i);
    let e = map.get(k);
    if (!e){ e = { x:0, y:0, z:0, ids:[] }; map.set(k, e); }
    e.x += nor.getX(i); e.y += nor.getY(i); e.z += nor.getZ(i); e.ids.push(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (const e of map.values()){
    const len = Math.hypot(e.x, e.y, e.z) || 1;
    const nx = e.x/len, ny = e.y/len, nz = e.z/len;
    for (const i of e.ids){ out[i*3] = nx; out[i*3+1] = ny; out[i*3+2] = nz; }
  }
  return out;
}

// Build hollow shell geometry (interleaved px,py,pz,nx,ny,nz arrays).
function hollowGeometry(geom, thickness){
  const pos = geom.attributes.position, nor = geom.attributes.normal, idx = geom.index;
  const wn = weldedNormals(pos, nor);          // smooth inward directions
  const out = [];
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const vi = i => idx ? idx.getX(i) : i;

  const pushVert = (i, inner) => {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    if (inner){
      x -= wn[i*3] * thickness; y -= wn[i*3+1] * thickness; z -= wn[i*3+2] * thickness;
      nx = -nx; ny = -ny; nz = -nz;            // inner faces point into cavity
    }
    out.push(x, y, z, nx, ny, nz);
  };

  for (let t = 0; t < triCount; t++){
    const a = vi(t*3), b = vi(t*3+1), c = vi(t*3+2);
    // outer triangle (original winding)
    pushVert(a, false); pushVert(b, false); pushVert(c, false);
    // inner triangle (reversed winding so it faces inward)
    pushVert(a, true); pushVert(c, true); pushVert(b, true);
  }
  return out;
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

export default function makeHollowAction(om){
  return {
    label:'Hollow', key:'h', instant:true,
    icon:'<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 7l4 2.2v4.6L12 16l-4-2.2V9.2L12 7z"/>',
    run(){
      const o = om.selected;
      if (!o){ toast('Select an object to hollow'); return; }
      if (o.userData.hollow){ toast('Already hollow'); return; }

      // bake world scale into geometry so thickness is uniform, then
      // choose a wall thickness relative to the object's size
      const g = o.geometry;
      const bb = (g.computeBoundingBox(), g.boundingBox);
      const size = bb.getSize(new THREE.Vector3());
      const s = o.scale;
      const minDim = Math.min(size.x * s.x, size.y * s.y, size.z * s.z);
      if (minDim < 0.06){ toast('Too thin to hollow'); return; }
      const thickness = Math.max(0.02, Math.min(minDim * 0.15, 0.25)) / Math.max(s.x, s.y, s.z);

      const arr = hollowGeometry(g, thickness);
      const geo = buildGeometry(arr);
      const src = {
        name: (o.userData.name || 'Object') + ' hollow',
        color: '#' + o.material.color.getHexString(),
        position: o.position.clone(),
        rotation: o.rotation.clone(),
        scale: o.scale.clone()
      };
      const tex = o.userData.texture;
      om.remove(o);
      const mesh = om.addMesh(geo, src);
      mesh.userData.hollow = true;
      mesh.material.side = THREE.DoubleSide;   // show wall from inside too
      mesh.material.needsUpdate = true;
      if (tex){
        import('../io/TextureStore.js').then(({ applyTexture }) => applyTexture(mesh, tex).catch(() => {}));
      }
      om.setSelection([mesh]);
      om.bus.emit('history:commit');
      toast('Hollowed');
    }
  };
}
