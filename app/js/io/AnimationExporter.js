/* global THREE */
// Animated export from the stop-motion timeline.
//
//  • animated GLB — bakes each frame's per-object pose into glTF
//    animation channels (translation / rotation / scale) with STEP
//    interpolation, matching the discrete stop-motion look. Plays in
//    Blender, three.js, and any glTF animation viewer. Geometry +
//    materials reuse the same embedding approach as the static GLB.
//
//  • animated GIF — renders each frame off the live renderer to a
//    canvas and encodes a looping GIF at the timeline's FPS. Fully
//    self-contained (tiny built-in encoder), good for quick sharing.
//
// Both read poses from the Timeline; objects absent from a frame are
// scaled to zero for that frame (the stop-motion "hidden" state).

function download(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============================ animated GLB ============================
export function exportAnimatedGLB(objects, timeline){
  // Gather all non-empty clips → each becomes a separate named GLB animation.
  const clips = (timeline.clips && timeline.clips.length)
    ? timeline.clips.filter(c => c.frames && c.frames.length >= 2)
    : (timeline.frames && timeline.frames.length >= 2
        ? [{ name:'stopmotion', fps:timeline.fps, frames:timeline.frames }]
        : []);
  if (!clips.length) throw new Error('Need at least one animation with 2+ frames');

  const json = {
    asset:{ version:'2.0', generator:'Crucible3D' },
    scene:0, scenes:[{ name:'Crucible3D animation', nodes:[] }],
    nodes:[], meshes:[], materials:[], accessors:[], bufferViews:[], buffers:[],
    images:[], textures:[], samplers:[], animations:[]
  };
  const binParts = []; let binLength = 0;
  const pad4 = n => (4 - (n % 4)) % 4;
  const addView = (arr, target) => {
    const pad = pad4(binLength);
    if (pad){ binParts.push(new Uint8Array(pad)); binLength += pad; }
    const view = { buffer:0, byteOffset:binLength, byteLength:arr.byteLength };
    if (target) view.target = target;
    binParts.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
    binLength += arr.byteLength;
    json.bufferViews.push(view);
    return json.bufferViews.length - 1;
  };
  const scalarAccessor = (arr, min, max) => {
    json.accessors.push({ bufferView:addView(arr), componentType:5126,
      count:arr.length, type:'SCALAR', min:[min], max:[max] });
    return json.accessors.length - 1;
  };
  const vecAccessor = (arr, comps) => {
    json.accessors.push({ bufferView:addView(arr), componentType:5126,
      count:arr.length / comps, type: comps === 4 ? 'VEC4' : 'VEC3' });
    return json.accessors.length - 1;
  };
  const texCache = new Map();
  const embedTexture = dataURL => {
    if (texCache.has(dataURL)) return texCache.get(dataURL);
    const comma = dataURL.indexOf(',');
    const mime = /data:(.*?);/.exec(dataURL)?.[1] || 'image/jpeg';
    const bin = atob(dataURL.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    json.images.push({ bufferView:addView(bytes), mimeType:mime });
    if (!json.samplers.length) json.samplers.push({ wrapS:10497, wrapT:10497 });
    json.textures.push({ source:json.images.length - 1, sampler:0 });
    const idx = json.textures.length - 1;
    texCache.set(dataURL, idx);
    return idx;
  };

  const euler = new THREE.Euler(), quat = new THREE.Quaternion();

  // --- PASS 1: build geometry + one node per object (shared by all clips) ---
  // Record each object's node index and uid so every clip's animation can
  // target the same nodes.
  const nodeFor = [];   // [{ nodeIndex, uid }]
  objects.forEach((obj) => {
    const g = obj.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index, uv = g.attributes.uv;
    const pArr = new Float32Array(pos.array);
    const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    for (let i = 0; i < pos.count; i++) for (let c = 0; c < 3; c++){
      const v = pArr[i*3+c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v;
    }
    json.accessors.push({ bufferView:addView(pArr, 34962), componentType:5126, count:pos.count, type:'VEC3', min, max });
    const posAcc = json.accessors.length - 1;
    json.accessors.push({ bufferView:addView(new Float32Array(nor.array), 34962), componentType:5126, count:nor.count, type:'VEC3' });
    const prim = { attributes:{ POSITION:posAcc, NORMAL:json.accessors.length - 1 } };
    if (uv){
      json.accessors.push({ bufferView:addView(new Float32Array(uv.array), 34962), componentType:5126, count:uv.count, type:'VEC2' });
      prim.attributes.TEXCOORD_0 = json.accessors.length - 1;
    }
    // vertex colors (from merges) → COLOR_0
    const vcol = g.attributes.color;
    if (vcol){
      const comps = vcol.itemSize || 3;
      const rgba = new Float32Array(vcol.count * 4);
      for (let i = 0; i < vcol.count; i++){
        rgba[i*4] = vcol.array[i*comps]; rgba[i*4+1] = vcol.array[i*comps+1];
        rgba[i*4+2] = vcol.array[i*comps+2]; rgba[i*4+3] = comps >= 4 ? vcol.array[i*comps+3] : 1;
      }
      json.accessors.push({ bufferView:addView(rgba, 34962), componentType:5126, count:vcol.count, type:'VEC4' });
      prim.attributes.COLOR_0 = json.accessors.length - 1;
    }
    if (idx){
      const wide = pos.count > 65535;
      const iArr = wide ? new Uint32Array(idx.count) : new Uint16Array(idx.count);
      for (let i = 0; i < idx.count; i++) iArr[i] = idx.getX(i);
      json.accessors.push({ bufferView:addView(iArr, 34963), componentType: wide ? 5125 : 5123, count:idx.count, type:'SCALAR' });
      prim.indices = json.accessors.length - 1;
    }
    const c = obj.material.color.clone().convertSRGBToLinear();
    const pbr = { baseColorFactor:[c.r,c.g,c.b,1], metallicFactor:obj.material.metalness ?? 0, roughnessFactor:obj.material.roughness ?? 1 };
    if (obj.userData.texture && uv){ pbr.baseColorTexture = { index:embedTexture(obj.userData.texture) }; pbr.baseColorFactor = [1,1,1,1]; }
    if (obj.material.side === 2 /* THREE.DoubleSide */) json.materials.push({ pbrMetallicRoughness: pbr, doubleSided:true });
    else json.materials.push({ pbrMetallicRoughness: pbr });
    prim.material = json.materials.length - 1;
    json.meshes.push({ name:obj.userData.name, primitives:[prim] });

    // node baseline TRS = first pose of the FIRST clip (so the model looks
    // right before playback). Fall back to the object's live transform.
    const uid = obj.userData.uid;
    const firstPose = clips[0].frames[0].poses[uid];
    const baseP = firstPose ? firstPose.p : obj.position.toArray();
    const baseR = firstPose ? firstPose.r : [obj.rotation.x, obj.rotation.y, obj.rotation.z];
    const baseS = firstPose ? firstPose.s : obj.scale.toArray();
    euler.set(baseR[0], baseR[1], baseR[2], 'XYZ'); quat.setFromEuler(euler);
    const nodeIndex = json.nodes.length;
    json.nodes.push({
      name: obj.userData.name,
      mesh: json.meshes.length - 1,
      translation: baseP.slice(),
      rotation: [quat.x, quat.y, quat.z, quat.w],
      scale: baseS.slice()
    });
    json.scenes[0].nodes.push(nodeIndex);
    nodeFor.push({ nodeIndex, uid });
  });

  // --- PASS 2: one glTF animation per clip, targeting the shared nodes ---
  const uniqueName = (() => {
    const seen = new Map();
    return (n) => {
      const base = (n || 'animation').replace(/[^\w\- ]/g, '').trim() || 'animation';
      const k = seen.get(base) || 0; seen.set(base, k + 1);
      return k ? `${base}_${k}` : base;
    };
  })();

  clips.forEach((clip) => {
    const frames = clip.frames;
    const fps = clip.fps || 6;
    const keyCount = frames.length + 1;   // extra hold keyframe for final pose
    const times = new Float32Array(keyCount);
    for (let i = 0; i < keyCount; i++) times[i] = i / fps;
    const timeAcc = scalarAccessor(times, 0, (keyCount - 1) / fps);

    const anim = { name: uniqueName(clip.name), channels:[], samplers:[] };

    nodeFor.forEach(({ nodeIndex, uid }) => {
      const T = new Float32Array(keyCount * 3);
      const R = new Float32Array(keyCount * 4);
      const S = new Float32Array(keyCount * 3);
      let last = { p:[0,0,0], r:[0,0,0], s:[1,1,1] };
      const writeKey = (k, pose) => {
        const p = pose ? pose.p : last.p;
        const r = pose ? pose.r : last.r;
        const s = pose ? pose.s : [0,0,0];   // absent this frame → scale 0 (hidden)
        T[k*3] = p[0]; T[k*3+1] = p[1]; T[k*3+2] = p[2];
        euler.set(r[0], r[1], r[2], 'XYZ'); quat.setFromEuler(euler);
        R[k*4] = quat.x; R[k*4+1] = quat.y; R[k*4+2] = quat.z; R[k*4+3] = quat.w;
        S[k*3] = s[0]; S[k*3+1] = s[1]; S[k*3+2] = s[2];
      };
      frames.forEach((f, fi) => {
        const pose = f.poses[uid];
        if (pose) last = pose;
        writeKey(fi, pose);
      });
      writeKey(keyCount - 1, frames[frames.length - 1].poses[uid] || null);

      const addChannel = (path, accessor) => {
        const sampler = anim.samplers.length;
        anim.samplers.push({ input:timeAcc, output:accessor, interpolation:'STEP' });
        anim.channels.push({ sampler, target:{ node:nodeIndex, path } });
      };
      addChannel('translation', vecAccessor(T, 3));
      addChannel('rotation', vecAccessor(R, 4));
      addChannel('scale', vecAccessor(S, 3));
    });

    json.animations.push(anim);
  });
  json.buffers.push({ byteLength: binLength });

  // assemble GLB container
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = pad4(jsonBytes.length), binPad = pad4(binLength);
  const total = 12 + 8 + jsonBytes.length + jsonPad + (binLength ? 8 + binLength + binPad : 0);
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let o = 0;
  dv.setUint32(o, 0x46546C67, true); o += 4;
  dv.setUint32(o, 2, true); o += 4;
  dv.setUint32(o, total, true); o += 4;
  dv.setUint32(o, jsonBytes.length + jsonPad, true); o += 4;
  dv.setUint32(o, 0x4E4F534A, true); o += 4;
  u8.set(jsonBytes, o); o += jsonBytes.length;
  for (let i = 0; i < jsonPad; i++) u8[o++] = 0x20;
  if (binLength){
    dv.setUint32(o, binLength + binPad, true); o += 4;
    dv.setUint32(o, 0x004E4942, true); o += 4;
    for (const part of binParts){ u8.set(part, o); o += part.byteLength; }
  }
  download(new Blob([buf], { type:'model/gltf-binary' }), 'crucible3d-animation.glb');
}

// ============================ animated GIF ===========================
// Renders each timeline frame off the main renderer and encodes a
// looping GIF. Uses a compact built-in encoder (median-cut palette +
// LZW), so there's no external dependency.
export async function exportAnimatedGIF(sceneManager, timeline, { width = 480 } = {}){
  const frames = timeline.frames;
  if (frames.length < 2) throw new Error('Need at least 2 frames');
  const wasIndex = timeline.index;
  timeline.stop();

  const src = sceneManager.renderer.domElement;
  const aspect = src.height / src.width;
  const W = width, H = Math.round(width * aspect);
  const cap = document.createElement('canvas'); cap.width = W; cap.height = H;
  const ctx = cap.getContext('2d');

  const enc = new GIFEncoder(W, H, Math.round(100 / timeline.fps));
  for (let i = 0; i < frames.length; i++){
    timeline.goTo(i);
    sceneManager.renderer.render(sceneManager.scene, sceneManager.camera);
    ctx.drawImage(src, 0, 0, W, H);
    enc.addFrame(ctx.getImageData(0, 0, W, H).data);
    await new Promise(r => setTimeout(r, 0));   // yield so UI can breathe
  }
  const bytes = enc.finish();
  if (wasIndex >= 0) timeline.goTo(wasIndex);
  download(new Blob([bytes], { type:'image/gif' }), 'crucible3d-animation.gif');
}

// --- minimal animated-GIF encoder (palette + LZW), no dependencies ---
class GIFEncoder {
  constructor(w, h, delayCs){
    this.w = w; this.h = h; this.delay = delayCs; this.frames = [];
  }
  addFrame(rgba){
    // build a 256-color palette for this frame (uniform quantization is
    // fast and fine for flat-shaded 3D); map pixels to indices.
    const { palette, indices } = quantize(rgba, this.w * this.h);
    this.frames.push({ palette, indices });
  }
  finish(){
    const out = [];
    const push = (...b) => out.push(...b);
    const str = s => { for (let i = 0; i < s.length; i++) push(s.charCodeAt(i)); };
    const short = n => push(n & 255, (n >> 8) & 255);
    str('GIF89a');
    short(this.w); short(this.h);
    push(0x00, 0, 0);                        // no global color table (frames carry local tables)
    // loop extension
    push(0x21, 0xFF, 0x0B); str('NETSCAPE2.0'); push(0x03, 0x01, 0, 0, 0x00);
    for (const fr of this.frames){
      push(0x21, 0xF9, 0x04, 0x00, this.delay & 255, (this.delay >> 8) & 255, 0, 0x00);  // GCE
      push(0x2C); short(0); short(0); short(this.w); short(this.h);
      push(0x87);                            // local color table, 256 entries
      for (let i = 0; i < 256; i++){ const p = fr.palette[i] || [0,0,0]; push(p[0], p[1], p[2]); }
      const lzw = lzwEncode(fr.indices, 8);
      push(8);
      for (let i = 0; i < lzw.length; i += 255){
        const chunk = lzw.slice(i, i + 255);
        push(chunk.length, ...chunk);
      }
      push(0);
    }
    push(0x3B);
    return new Uint8Array(out);
  }
}

// uniform 3-3-2 RGB quantization → 256-color palette + index map
function quantize(rgba, count){
  const palette = new Array(256);
  for (let i = 0; i < 256; i++){
    const r = (i >> 5) & 7, g = (i >> 2) & 7, b = i & 3;
    palette[i] = [Math.round(r*255/7), Math.round(g*255/7), Math.round(b*255/3)];
  }
  const indices = new Uint8Array(count);
  for (let i = 0; i < count; i++){
    const r = rgba[i*4], g = rgba[i*4+1], b = rgba[i*4+2];
    indices[i] = ((r >> 5) << 5) | ((g >> 5) << 2) | (b >> 6);
  }
  return { palette, indices };
}

// standard GIF LZW compressor (variable-width codes, clear/EOI, 4096 reset)
function lzwEncode(indices, minCode){
  const clearCode = 1 << minCode, eoiCode = clearCode + 1;
  let codeSize = minCode + 1, next = eoiCode + 1;
  let dict = new Map();
  const out = []; let cur = 0, curBits = 0;
  const emit = code => {
    cur |= code << curBits; curBits += codeSize;
    while (curBits >= 8){ out.push(cur & 255); cur >>= 8; curBits -= 8; }
  };
  emit(clearCode);
  let prefix = indices[0];                      // a code number (0..255 initially)
  for (let i = 1; i < indices.length; i++){
    const k = indices[i];
    const combo = prefix + ',' + k;
    if (dict.has(combo)){
      prefix = dict.get(combo);
    } else {
      emit(prefix);
      dict.set(combo, next++);
      if (next - 1 === (1 << codeSize) && codeSize < 12) codeSize++;
      if (next === 4096){
        emit(clearCode);
        dict = new Map(); next = eoiCode + 1; codeSize = minCode + 1;
      }
      prefix = k;
    }
  }
  emit(prefix);
  emit(eoiCode);
  if (curBits > 0) out.push(cur & 255);
  return out;
}
