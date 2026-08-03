/* global THREE */
// Texture support: import an image as a base-color (albedo) map on the
// selected object. Stored on the material and as a data URL in
// userData so it survives save/load, undo, duplication, and export.
//
// UVs: registry primitives ship with usable UVs from Three.js. Custom
// geometry (pen strokes, slice halves, merged meshes) has none, so we
// generate box-projection UVs on the fly — each triangle projected onto
// whichever world axis its normal points at most. Good enough to place
// wood/brick/etc. without manual unwrapping.

const loader = new THREE.TextureLoader();

// Build UVs by box projection (triangle-soup safe: works on
// non-indexed custom geometry as well as indexed primitives).
export function generateBoxUV(geometry, scale = 1){
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();

  // bounds → normalize projected coords into 0..1 across the object
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const size = bb.getSize(new THREE.Vector3());
  const inv = { x: size.x || 1, y: size.y || 1, z: size.z || 1 };

  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const vi = i => idx ? idx.getX(i) : i;
  const setPlanar = (i, u, v) => { uv[i*2] = u; uv[i*2+1] = v; };

  for (let t = 0; t < triCount; t++){
    const i0 = vi(t*3), i1 = vi(t*3+1), i2 = vi(t*3+2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a); ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (const [i, p] of [[i0, a], [i1, b], [i2, c]]){
      let u, v;
      if (ax >= ay && ax >= az){        // facing X → use Z,Y
        u = (p.z - bb.min.z) / inv.z; v = (p.y - bb.min.y) / inv.y;
      } else if (ay >= ax && ay >= az){ // facing Y → use X,Z
        u = (p.x - bb.min.x) / inv.x; v = (p.z - bb.min.z) / inv.z;
      } else {                          // facing Z → use X,Y
        u = (p.x - bb.min.x) / inv.x; v = (p.y - bb.min.y) / inv.y;
      }
      setPlanar(i, u * scale, v * scale);
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.attributes.uv.needsUpdate = true;
}

// Turn a data URL into a configured THREE.Texture (async).
export function textureFromDataURL(dataURL){
  return new Promise((resolve, reject) => {
    loader.load(dataURL, tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace ?? undefined;   // r152+; harmless if absent
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      resolve(tex);
    }, undefined, reject);
  });
}

// Apply a texture (from a data URL) as the base-color map on a mesh.
// Generates UVs first if the geometry lacks them.
export async function applyTexture(mesh, dataURL){
  if (!mesh.geometry.attributes.uv) generateBoxUV(mesh.geometry);
  const tex = await textureFromDataURL(dataURL);
  if (mesh.material.map) mesh.material.map.dispose();
  mesh.material.map = tex;
  mesh.material.color.set('#ffffff');   // let the texture show its true colors
  mesh.material.needsUpdate = true;
  mesh.userData.texture = dataURL;      // persisted by SceneStore
}

export function removeTexture(mesh){
  if (mesh.material.map){ mesh.material.map.dispose(); mesh.material.map = null; }
  mesh.material.needsUpdate = true;
  delete mesh.userData.texture;
}

// Read a File (from an <input type=file>) into a downscaled data URL,
// so huge photos don't bloat the scene JSON. Caps the longest edge.
export function fileToDataURL(file, maxEdge = 1024){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.round(width * scale); height = Math.round(height * scale);
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        // JPEG for photos keeps size down; PNG would balloon the JSON
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
