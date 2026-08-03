/* global THREE */
// Procedural "basic human head" geometry — a stylized bust, not a
// scan. Starts from a UV sphere and displaces each vertex by a set of
// anatomical shaping rules (elongation, jaw taper, flattened back,
// brow, cheeks, chin, and a nose bump) so it reads as a head while
// staying a clean, editable, printable mesh. Faces +Z.
//
// The result is a normal BufferGeometry, so the head behaves like any
// other primitive: select, transform, deform, slice, hollow, texture,
// export. It has UVs from the base sphere, so textures map sensibly.

export function headGeometry(){
  const geo = new THREE.SphereGeometry(1, 40, 32);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  // smoothstep-ish helpers
  const bump = (t, c, w) => {                     // 0..1 hump centered at c, width w
    const d = Math.abs(t - c) / w;
    return d >= 1 ? 0 : Math.cos(d * Math.PI) * 0.5 + 0.5;
  };

  for (let i = 0; i < pos.count; i++){
    v.fromBufferAttribute(pos, i);
    const x = v.x, y = v.y, z = v.z;
    const yn = y;                                 // -1 (chin) .. 1 (crown)
    const front = z > 0 ? z : 0;                  // facing amount

    // base proportions: taller than wide, a bit deeper than wide
    let sx = 0.78, sy = 1.06, sz = 0.9;

    // taper toward the jaw/chin (narrower low, fuller at cheeks)
    const lower = Math.max(0, -yn);
    sx *= 1 - 0.28 * lower * lower;               // jaw narrows
    sz *= 1 - 0.10 * lower;

    // flatten the back of the skull slightly
    if (z < 0) sz *= 0.94;

    // crown rounds in a touch
    const upper = Math.max(0, yn);
    sx *= 1 - 0.10 * upper * upper;

    v.set(x * sx, y * sy, z * sz);

    // --- front-face features (only push where actually facing forward) ---
    const facing = front;                          // 0..1

    // brow ridge just above mid, chin, cheeks, nose
    const brow  = bump(yn,  0.18, 0.16) * facing * 0.06;
    const cheek = bump(yn, -0.15, 0.28) * facing * (1 - Math.abs(x) * 0.6) * 0.05;
    const chin  = bump(yn, -0.82, 0.22) * facing * (1 - Math.abs(x) * 1.4) * 0.10;
    // nose: narrow vertical ridge on the centerline, mid-lower face
    const noseCol = Math.max(0, 1 - Math.abs(x) / 0.16);
    const nose  = bump(yn, -0.05, 0.26) * facing * noseCol * 0.14;

    // brow slightly overhangs the eyes (small dip right below it)
    const socket = -bump(yn, 0.02, 0.10) * facing * (1 - Math.abs(x) * 0.5) * 0.03;

    const push = brow + cheek + chin + nose + socket;
    if (push !== 0){
      // push along +Z (outward from face), scaled by how forward we are
      v.z += push;
    }

    // gentle jaw definition: pull lower-side vertices back a hair
    if (yn < -0.3 && z > -0.2){
      v.z -= (1 - facing) * 0.04 * lower;
    }

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geo.scale(0.85, 0.85, 0.85);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
