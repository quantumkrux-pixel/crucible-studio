/* global THREE */
// Primitive registry + scene objects + selection.
// Emits: 'objects:changed', 'selection:changed', 'object:transformed'.
export default class ObjectManager {
  constructor(bus, sceneManager){
    this.bus = bus;
    this.scene = sceneManager.scene;
    this.objects = [];
    this.selected = null;        // primary selection (for panel, tools)
    this.selection = [];         // full selection set (multi-select)
    this.primitives = new Map();   // id -> {label, icon, create}
    this.counter = 0;
    this.markers = [];           // {obj, outline, glow} per selected object
  }
  registerPrimitive(id, def){ this.primitives.set(id, def); }

  // Stable per-object id so timeline frames can reference objects
  // across poses (array index and name both change; this doesn't).
  static uid(){ return 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  add(typeId){
    const def = this.primitives.get(typeId);
    if (!def) return;
    const mesh = new THREE.Mesh(def.create(),
      new THREE.MeshStandardMaterial({ color:new THREE.Color('#C9CFD8'), roughness:0.55, metalness:0.08 }));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.geometry.computeBoundingBox();
    const h = mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y;
    const n = this.counter++;
    const ang = n * 2.4, rad = n === 0 ? 0 : 0.9 + n * 0.45;   // loose spawn spiral
    mesh.position.set(Math.cos(ang)*rad, h/2, Math.sin(ang)*rad);
    mesh.userData = { name:`${def.label} ${String(n+1).padStart(2,'0')}`, type:typeId, uid:ObjectManager.uid() };
    this.scene.add(mesh);
    this.objects.push(mesh);
    this.bus.emit('objects:changed');
    this.select(mesh);
    return mesh;
  }
  remove(obj){
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    this.scene.remove(obj);
    obj.geometry.dispose(); obj.material.dispose();
    if (this.selection.includes(obj))
      this.setSelection(this.selection.filter(o => o !== obj));
    this.bus.emit('objects:changed');
  }
  duplicate(obj){
    const copy = obj.clone();
    copy.geometry = obj.geometry.clone();   // independent verts for deform
    copy.material = obj.material.clone();
    copy.position.x += 1.2;
    copy.userData = { ...obj.userData, name: obj.userData.name + ' copy', uid:ObjectManager.uid() };
    this.scene.add(copy);
    this.objects.push(copy);
    this.bus.emit('objects:changed');
    this.select(copy);
    return copy;
  }
  // Add an arbitrary prebuilt geometry as a scene object (e.g. slice
  // halves). Serialized as type 'custom' with full vertex data, since
  // it can't be rebuilt from a primitive factory.
  addMesh(geometry, { name = 'Object', color = '#C9CFD8', position, rotation, scale } = {}){
    const mesh = new THREE.Mesh(geometry,
      new THREE.MeshStandardMaterial({ color:new THREE.Color(color), roughness:0.55, metalness:0.08 }));
    mesh.castShadow = mesh.receiveShadow = true;
    if (position) mesh.position.copy(position);
    if (rotation) mesh.rotation.copy(rotation);
    if (scale) mesh.scale.copy(scale);
    mesh.userData = { name, type:'custom', uid:ObjectManager.uid() };
    this.scene.add(mesh);
    this.objects.push(mesh);
    this.bus.emit('objects:changed');
    return mesh;
  }
  clear(){
    this.select(null);
    this.objects.forEach(o => { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); });
    this.objects = [];
    this.#sweepArtifacts();
    this.counter = 0;
    this.bus.emit('objects:changed');
  }
  // Remove any stray selection artifacts left in the scene: our tagged
  // markers, plus—as a belt-and-suspenders catch for orphans created
  // before tagging existed—any BoxHelper that isn't attached to a live
  // object. Never touches real objects, the grid, or lights.
  #sweepArtifacts(){
    const live = new Set(this.objects);
    const kill = this.scene.children.filter(c => {
      if (c.userData?.isSelectionMarker) return true;
      // untagged orphan BoxHelper (constructor name survives minify-free build)
      if (c.type === 'BoxHelper' || c.isLineSegments && c.userData?.isSelectionMarker) return true;
      return false;
    });
    kill.forEach(s => {
      this.scene.remove(s);
      s.geometry?.dispose?.();
      s.material?.dispose?.();
    });
    return kill.length;
  }
  // Rebuild objects from a SceneStore payload (file load / undo / redo).
  restore(list, counter){
    const pendingTextures = [];
    for (const d of list){
      if (d.type === 'custom' && d.custom){
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(d.custom.verts), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(d.custom.norms), 3));
        // restore per-vertex colors from a merge, if present
        const hasVColors = Array.isArray(d.custom.colors) && d.custom.colors.length === d.custom.verts.length;
        if (hasVColors){
          g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(d.custom.colors), 3));
        }
        g.computeBoundingBox();
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g,
          new THREE.MeshStandardMaterial({ color:new THREE.Color(d.color), roughness:0.55, metalness:0.08 }));
        if (hasVColors){
          mesh.material.vertexColors = true;
          mesh.userData.vertexColors = true;
        }
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.position.fromArray(d.position);
        mesh.rotation.set(d.rotation[0], d.rotation[1], d.rotation[2]);
        mesh.scale.fromArray(d.scale);
        mesh.userData = { name:d.name, type:'custom', uid:d.uid || ObjectManager.uid() };
        if (hasVColors) mesh.userData.vertexColors = true;
        if (d.hollow){
          mesh.userData.hollow = true;
          mesh.material.side = THREE.DoubleSide;
        }
        if (typeof d.opacity === 'number' && d.opacity < 1){
          mesh.material.opacity = d.opacity;
          mesh.material.transparent = true;
          mesh.material.depthWrite = false;
        }
        if (d.hidden){ mesh.userData.hidden = true; mesh.visible = false; }
        this.scene.add(mesh);
        this.objects.push(mesh);
        if (d.uv) mesh.userData.uv = d.uv;
      if (d.texture) pendingTextures.push([mesh, d.texture]);
        continue;
      }
      const def = this.primitives.get(d.type); if (!def) continue;
      const mesh = new THREE.Mesh(def.create(),
        new THREE.MeshStandardMaterial({ color:new THREE.Color(d.color), roughness:0.55, metalness:0.08 }));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.fromArray(d.position);
      mesh.rotation.set(d.rotation[0], d.rotation[1], d.rotation[2]);
      mesh.scale.fromArray(d.scale);
      mesh.userData = { name:d.name, type:d.type, uid:d.uid || ObjectManager.uid() };
      if (Array.isArray(d.verts) && d.verts.length === mesh.geometry.attributes.position.array.length){
        mesh.geometry.attributes.position.array.set(d.verts);
        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
        mesh.userData.deformed = true;
      }
      if (typeof d.opacity === 'number' && d.opacity < 1){
        mesh.material.opacity = d.opacity;
        mesh.material.transparent = true;
        mesh.material.depthWrite = false;
      }
      if (d.hidden){ mesh.userData.hidden = true; mesh.visible = false; }
      this.scene.add(mesh);
      this.objects.push(mesh);
      if (d.texture) pendingTextures.push([mesh, d.texture]);
    }
    if (typeof counter === 'number') this.counter = counter;
    // re-apply persisted textures (async import; non-blocking)
    if (pendingTextures.length){
      import('../io/TextureStore.js').then(({ applyTexture }) => {
        pendingTextures.forEach(([mesh, url]) => applyTexture(mesh, url).catch(() => {}));
      });
    }
    this.bus.emit('objects:changed');
    this.select(null);
  }
  select(obj){ this.setSelection(obj ? [obj] : []); }
  // Show/hide an object from the scene (outliner eye toggle). The intent
  // is stored on userData.hidden so it survives save/load and isn't
  // clobbered by the animation timeline's temporary visibility changes.
  setHidden(obj, hidden){
    if (!obj) return;
    obj.userData.hidden = !!hidden;
    obj.visible = !hidden;
    if (hidden && this.selection.includes(obj))
      this.setSelection(this.selection.filter(o => o !== obj));
    this.bus.emit('objects:changed');
  }
  // Add or remove one object from the current selection (shift-click / Multi tool).
  toggleSelect(obj){
    if (!obj) return;
    const i = this.selection.indexOf(obj);
    if (i >= 0) this.selection.splice(i, 1);
    else this.selection.push(obj);
    this.#commitSelection();
  }
  setSelection(list){
    this.selection = list.filter(Boolean);
    this.#commitSelection();
  }
  #commitSelection(){
    // clear previous markers + emissive tints
    this.markers.forEach(m => {
      this.scene.remove(m.outline); m.outline.geometry.dispose();
      this.scene.remove(m.glow); m.glow.geometry.dispose(); m.glow.material.dispose();
      m.obj.material.emissive?.setHex(0x000000);
    });
    this.markers = [];
    // primary selection = last item (drives the properties panel & tools)
    this.selected = this.selection[this.selection.length - 1] ?? null;
    for (const obj of this.selection){
      const outline = new THREE.BoxHelper(obj, 0xFF9838);
      outline.userData.isSelectionMarker = true;
      this.scene.add(outline);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color:0xFF9838, transparent:true, opacity:0.18,
          blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.BackSide }));
      glow.userData.isSelectionMarker = true;
      glow.renderOrder = 1;
      this.scene.add(glow);
      obj.material.emissive?.setHex(0x4a2000);   // warm inner glow
      this.markers.push({ obj, outline, glow });
    }
    this.#fitGlows();
    // compat: keep `outline` pointing at the primary marker for old callers
    this.outline = this.markers.length ? this.markers[this.markers.length - 1].outline : null;
    this.bus.emit('selection:changed', this.selected);
  }
  #fitGlows(){
    const size = new THREE.Vector3();
    for (const m of this.markers){
      const b = new THREE.Box3().setFromObject(m.obj);
      b.getSize(size);
      b.getCenter(m.glow.position);
      m.glow.scale.set(size.x + 0.1, size.y + 0.1, size.z + 0.1);
    }
  }
  refreshSelection(){
    this.markers.forEach(m => m.outline.update());
    this.#fitGlows();
  }
  // Merge all selected meshes into a single object, baking world
  // transforms into geometry. The merged object becomes 'custom' type.
  mergeSelection(){
    if (this.selection.length < 2) return null;
    const merged = [];   // interleaved px,py,pz,nx,ny,nz,r,g,b in world space
    const nm = new THREE.Matrix3();
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const col = new THREE.Color();
    const items = this.selection.slice();
    let anyTextured = false;
    items.forEach(o => {
      o.updateMatrixWorld(true);
      nm.getNormalMatrix(o.matrixWorld);
      // this object's color (linear space, so vertex colors blend correctly)
      col.copy(o.material.color);
      if (o.material.map) anyTextured = true;
      const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
      const emit = i => {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        merged.push(v.x, v.y, v.z, n.x, n.y, n.z, col.r, col.g, col.b);
      };
      if (idx) for (let i = 0; i < idx.count; i++) emit(idx.getX(i));
      else for (let i = 0; i < pos.count; i++) emit(i);
    });
    const STRIDE = 9;
    const count = merged.length / STRIDE;
    const parr = new Float32Array(count * 3), narr = new Float32Array(count * 3);
    const carr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++){
      const b = i * STRIDE;
      parr[i*3] = merged[b];   parr[i*3+1] = merged[b+1]; parr[i*3+2] = merged[b+2];
      narr[i*3] = merged[b+3]; narr[i*3+1] = merged[b+4]; narr[i*3+2] = merged[b+5];
      carr[i*3] = merged[b+6]; carr[i*3+1] = merged[b+7]; carr[i*3+2] = merged[b+8];
    }
    // recenter geometry on its centroid so the new object's origin is sensible
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < count; i++){ cx += parr[i*3]; cy += parr[i*3+1]; cz += parr[i*3+2]; }
    cx /= count; cy /= count; cz /= count;
    for (let i = 0; i < count; i++){ parr[i*3] -= cx; parr[i*3+1] -= cy; parr[i*3+2] -= cz; }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(parr, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(narr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(carr, 3));
    geo.computeBoundingBox(); geo.computeBoundingSphere();

    const name = (items[0].userData.name || 'Object') + ' merged';
    items.forEach(o => {
      const idx = this.objects.indexOf(o);
      if (idx >= 0) this.objects.splice(idx, 1);
      this.scene.remove(o); o.geometry.dispose(); o.material.dispose();
    });
    // remove the selection markers (outline + glow) from the scene before
    // clearing the array — otherwise they orphan into the scene as ghost
    // orange bounding boxes that even persist through save/load.
    this.markers.forEach(m => {
      this.scene.remove(m.outline); m.outline.geometry.dispose();
      this.scene.remove(m.glow); m.glow.geometry.dispose(); m.glow.material.dispose();
    });
    this.markers = []; this.selection = []; this.selected = null;
    this.outline = null;
    // white base color so the per-vertex colors show at full strength
    const mesh = this.addMesh(geo, { name, color:'#ffffff', position:new THREE.Vector3(cx, cy, cz) });
    mesh.material.vertexColors = true;
    mesh.material.needsUpdate = true;
    mesh.userData.vertexColors = true;   // flag for save/load
    this.setSelection([mesh]);
    return mesh;
  }
  notifyTransformed(){
    this.refreshSelection();
    this.bus.emit('object:transformed', this.selected);
  }
}
