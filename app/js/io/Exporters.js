/* global THREE */
// Export-format registry. Register a new format and it appears in the
// File ▾ menu automatically:
//   Exporters.register('gltf', { label:'glTF', build(objects){ ... } });
const Exporters = {
  formats: new Map(),
  register(id, def){ this.formats.set(id, def); },
  run(id, objects){
    const def = this.formats.get(id); if (!def) return;
    const out = def.build(objects);   // { text | data, filename, mime? }
    const blob = new Blob([out.data ?? out.text], { type: out.mime ?? 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = out.filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
};

Exporters.register('obj', {
  label:'Wavefront .obj',
  build(objects){
    let out = '# Crucible3D export\n', off = 1;
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    objects.forEach(obj => {
      obj.updateMatrixWorld(true);
      nm.getNormalMatrix(obj.matrixWorld);
      const pos = obj.geometry.attributes.position, nor = obj.geometry.attributes.normal, idx = obj.geometry.index;
      const vcol = obj.geometry.attributes.color;   // per-vertex colors (from merge)
      out += `o ${obj.userData.name.replace(/\s+/g,'_')}\n`;
      for (let i = 0; i < pos.count; i++){
        v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
        if (vcol){
          // vertex-color extension: r g b appended to the v line (Blender,
          // MeshLab, etc. read this). Values are 0..1.
          const cc = vcol.itemSize || 3;
          const r = vcol.array[i*cc], gr = vcol.array[i*cc+1], bl = vcol.array[i*cc+2];
          out += `v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)} ${r.toFixed(4)} ${gr.toFixed(4)} ${bl.toFixed(4)}\n`;
        } else {
          out += `v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}\n`;
        }
      }
      for (let i = 0; i < nor.count; i++){
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        out += `vn ${n.x.toFixed(4)} ${n.y.toFixed(4)} ${n.z.toFixed(4)}\n`;
      }
      const f = (a,b,c) => `f ${a+off}//${a+off} ${b+off}//${b+off} ${c+off}//${c+off}\n`;
      if (idx) for (let i = 0; i < idx.count; i += 3) out += f(idx.getX(i), idx.getX(i+1), idx.getX(i+2));
      else for (let i = 0; i < pos.count; i += 3) out += f(i, i+1, i+2);
      off += pos.count;
    });
    return { text: out, filename:'crucible3d-scene.obj' };
  }
});

// ---- glTF binary (.glb) — full material persistence ----------------
// Hand-rolled glTF 2.0 binary writer: one node+mesh per object with
// TRS transforms, indexed geometry, and an embedded PBR material
// (baseColor from the object's color converted sRGB→linear, plus
// roughness/metalness). Imports with correct colors into Blender,
// Unity, Unreal, and any glTF viewer.
Exporters.register('glb', {
  label:'glTF binary .glb',
  build(objects){
    const json = {
      asset:{ version:'2.0', generator:'Crucible3D' },
      scene:0, scenes:[{ name:'Crucible3D scene', nodes:[] }],
      nodes:[], meshes:[], materials:[], accessors:[], bufferViews:[], buffers:[],
      images:[], textures:[], samplers:[]
    };
    const binParts = [];
    let binLength = 0;
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
    // Embed a data-URL image into the binary buffer, returning a glTF
    // texture index (deduplicated so repeated images embed once).
    const texCache = new Map();
    const embedTexture = dataURL => {
      if (texCache.has(dataURL)) return texCache.get(dataURL);
      const comma = dataURL.indexOf(',');
      const mime = /data:(.*?);/.exec(dataURL)?.[1] || 'image/jpeg';
      const bin = atob(dataURL.slice(comma + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const view = addView(bytes);
      json.images.push({ bufferView:view, mimeType:mime });
      if (!json.samplers.length) json.samplers.push({ wrapS:10497, wrapT:10497 });   // REPEAT
      json.textures.push({ source:json.images.length - 1, sampler:0 });
      const idx = json.textures.length - 1;
      texCache.set(dataURL, idx);
      return idx;
    };

    objects.forEach(obj => {
      const g = obj.geometry;
      const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;

      const pArr = new Float32Array(pos.array);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.count; i++)
        for (let c = 0; c < 3; c++){
          const v = pArr[i*3 + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      json.accessors.push({ bufferView:addView(pArr, 34962), componentType:5126,
        count:pos.count, type:'VEC3', min, max });
      const posAcc = json.accessors.length - 1;

      json.accessors.push({ bufferView:addView(new Float32Array(nor.array), 34962),
        componentType:5126, count:nor.count, type:'VEC3' });
      const prim = { attributes:{ POSITION:posAcc, NORMAL:json.accessors.length - 1 } };

      // UVs (TEXCOORD_0) — export when present so textures map correctly
      const uv = g.attributes.uv;
      if (uv){
        json.accessors.push({ bufferView:addView(new Float32Array(uv.array), 34962),
          componentType:5126, count:uv.count, type:'VEC2' });
        prim.attributes.TEXCOORD_0 = json.accessors.length - 1;
      }

      // Vertex colors (COLOR_0) — export when present (e.g. from merging
      // differently-colored objects) so those colors survive into Blender/
      // Unity. glTF expects VEC4 RGBA float in linear space; our stored
      // vertex colors are already linear (THREE material colors are linear
      // internally), so we pass them through and fill alpha = 1.
      const vcol = g.attributes.color;
      if (vcol){
        const comps = vcol.itemSize || 3;
        const rgba = new Float32Array(vcol.count * 4);
        for (let i = 0; i < vcol.count; i++){
          rgba[i*4]   = vcol.array[i*comps];
          rgba[i*4+1] = vcol.array[i*comps + 1];
          rgba[i*4+2] = vcol.array[i*comps + 2];
          rgba[i*4+3] = comps >= 4 ? vcol.array[i*comps + 3] : 1;
        }
        json.accessors.push({ bufferView:addView(rgba, 34962),
          componentType:5126, count:vcol.count, type:'VEC4' });
        prim.attributes.COLOR_0 = json.accessors.length - 1;
      }

      if (idx){
        const wide = pos.count > 65535;
        const iArr = wide ? new Uint32Array(idx.count) : new Uint16Array(idx.count);
        for (let i = 0; i < idx.count; i++) iArr[i] = idx.getX(i);
        json.accessors.push({ bufferView:addView(iArr, 34963),
          componentType: wide ? 5125 : 5123, count:idx.count, type:'SCALAR' });
        prim.indices = json.accessors.length - 1;
      }

      const hasTex = obj.userData.texture && uv;
      const c = obj.material.color.clone().convertSRGBToLinear();
      const alpha = obj.material.opacity ?? 1;
      const pbr = {
        baseColorFactor:[c.r, c.g, c.b, alpha],
        metallicFactor: obj.material.metalness ?? 0,
        roughnessFactor: obj.material.roughness ?? 1
      };
      if (hasTex){
        pbr.baseColorTexture = { index: embedTexture(obj.userData.texture) };
        pbr.baseColorFactor = [1, 1, 1, alpha];   // keep texture colors, apply alpha
      }
      const mat = { name:(obj.userData.name || 'Object') + ' material',
        pbrMetallicRoughness: pbr };
      if (alpha < 1) mat.alphaMode = 'BLEND';       // glTF transparency
      json.materials.push(mat);
      prim.material = json.materials.length - 1;

      json.meshes.push({ name:obj.userData.name, primitives:[prim] });
      json.nodes.push({ name:obj.userData.name, mesh:json.meshes.length - 1,
        translation:obj.position.toArray(),
        rotation:obj.quaternion.toArray(),
        scale:obj.scale.toArray() });
      json.scenes[0].nodes.push(json.nodes.length - 1);
    });
    json.buffers.push({ byteLength: binLength });

    // assemble: 12-byte header + JSON chunk (space-padded) + BIN chunk
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonPad = pad4(jsonBytes.length), binPad = pad4(binLength);
    const total = 12 + 8 + jsonBytes.length + jsonPad + (binLength ? 8 + binLength + binPad : 0);
    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let o = 0;
    dv.setUint32(o, 0x46546C67, true); o += 4;                 // 'glTF'
    dv.setUint32(o, 2, true); o += 4;
    dv.setUint32(o, total, true); o += 4;
    dv.setUint32(o, jsonBytes.length + jsonPad, true); o += 4;
    dv.setUint32(o, 0x4E4F534A, true); o += 4;                 // 'JSON'
    u8.set(jsonBytes, o); o += jsonBytes.length;
    for (let i = 0; i < jsonPad; i++) u8[o++] = 0x20;
    if (binLength){
      dv.setUint32(o, binLength + binPad, true); o += 4;
      dv.setUint32(o, 0x004E4942, true); o += 4;               // 'BIN\0'
      for (const part of binParts){ u8.set(part, o); o += part.byteLength; }
    }
    return { data:buf, filename:'crucible3d-scene.glb', mime:'model/gltf-binary' };
  }
});

// ---- FBX ASCII (.fbx) -----------------------------------------------
// Minimal FBX 7.3 ASCII document: one Geometry/Model/Material triplet
// per object with per-corner normals and the object's diffuse color.
// Note: ASCII FBX opens in Autodesk tools (Maya, 3ds Max, FBX Review)
// and converters, but Blender only imports BINARY fbx — use .glb there.
Exporters.register('fbx', {
  label:'FBX ASCII .fbx',
  build(objects){
    const f = x => +x.toFixed(6);
    const deg = r => r * 180 / Math.PI;
    const safe = s => (s || 'Object').replace(/["\\]/g, '');
    let objectsBlock = '', connections = '';

    objects.forEach((obj, i) => {
      const g = obj.geometry, pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
      const geoId = 1000000 + i, modelId = 2000000 + i, matId = 3000000 + i;
      const name = safe(obj.userData.name);
      const verts = [], pvi = [], normals = [];
      for (let v = 0; v < pos.count; v++)
        verts.push(f(pos.getX(v)), f(pos.getY(v)), f(pos.getZ(v)));
      const corner = vi =>
        normals.push(f(nor.getX(vi)), f(nor.getY(vi)), f(nor.getZ(vi)));
      if (idx){
        for (let t = 0; t < idx.count; t += 3){
          const a = idx.getX(t), b = idx.getX(t+1), c = idx.getX(t+2);
          pvi.push(a, b, ~c);              // FBX: last polygon index is bitwise-NOT
          corner(a); corner(b); corner(c);
        }
      } else {
        for (let t = 0; t < pos.count; t += 3){
          pvi.push(t, t+1, ~(t+2));
          corner(t); corner(t+1); corner(t+2);
        }
      }
      const col = obj.material.color;
      objectsBlock += `
	Geometry: ${geoId}, "Geometry::${name}", "Mesh" {
		Vertices: *${verts.length} { a: ${verts.join(',')} }
		PolygonVertexIndex: *${pvi.length} { a: ${pvi.join(',')} }
		GeometryVersion: 124
		LayerElementNormal: 0 {
			Version: 101
			Name: ""
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "Direct"
			Normals: *${normals.length} { a: ${normals.join(',')} }
		}
		LayerElementMaterial: 0 {
			Version: 101
			Name: ""
			MappingInformationType: "AllSame"
			ReferenceInformationType: "IndexToDirect"
			Materials: *1 { a: 0 }
		}
		Layer: 0 {
			Version: 100
			LayerElement:  {
				Type: "LayerElementNormal"
				TypedIndex: 0
			}
			LayerElement:  {
				Type: "LayerElementMaterial"
				TypedIndex: 0
			}
		}
	}
	Model: ${modelId}, "Model::${name}", "Mesh" {
		Version: 232
		Properties70:  {
			P: "Lcl Translation", "Lcl Translation", "", "A",${f(obj.position.x)},${f(obj.position.y)},${f(obj.position.z)}
			P: "Lcl Rotation", "Lcl Rotation", "", "A",${f(deg(obj.rotation.x))},${f(deg(obj.rotation.y))},${f(deg(obj.rotation.z))}
			P: "Lcl Scaling", "Lcl Scaling", "", "A",${f(obj.scale.x)},${f(obj.scale.y)},${f(obj.scale.z)}
		}
		Shading: T
		Culling: "CullingOff"
	}
	Material: ${matId}, "Material::${name}", "" {
		Version: 102
		ShadingModel: "phong"
		MultiLayer: 0
		Properties70:  {
			P: "DiffuseColor", "Color", "", "A",${f(col.r)},${f(col.g)},${f(col.b)}
			P: "SpecularColor", "Color", "", "A",0.2,0.2,0.2
			P: "Shininess", "double", "Number", "",20
			P: "Opacity", "double", "Number", "",1
		}
	}`;
      connections += `
	C: "OO",${modelId},0
	C: "OO",${geoId},${modelId}
	C: "OO",${matId},${modelId}`;
    });

    const n = objects.length;
    const text = `; FBX 7.3.0 project file
; Exported by Crucible3D
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7300
	Creator: "Crucible3D"
}
GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UpAxis", "int", "Integer", "",1
		P: "UpAxisSign", "int", "Integer", "",1
		P: "FrontAxis", "int", "Integer", "",2
		P: "FrontAxisSign", "int", "Integer", "",1
		P: "CoordAxis", "int", "Integer", "",0
		P: "CoordAxisSign", "int", "Integer", "",1
		P: "OriginalUpAxis", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",100
	}
}
Documents:  {
	Count: 1
	Document: 9000000, "", "Scene" {
		Properties70:  {
			P: "SourceObject", "object", "", ""
			P: "ActiveAnimStackName", "KString", "", "", ""
		}
		RootNode: 0
	}
}
References:  {
}
Definitions:  {
	Version: 100
	Count: ${3 * n}
	ObjectType: "Model" {
		Count: ${n}
	}
	ObjectType: "Geometry" {
		Count: ${n}
	}
	ObjectType: "Material" {
		Count: ${n}
	}
}
Objects:  {${objectsBlock}
}
Connections:  {${connections}
}
Takes:  {
	Current: ""
}
`;
    return { text, filename:'crucible3d-scene.fbx' };
  }
});

export default Exporters;
