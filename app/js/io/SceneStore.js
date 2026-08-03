// Scene (de)serialization. Versioned JSON of primitives + transforms +
// camera; deformed geometry is captured as raw vertex data. Rebuilt
// through ObjectManager's primitive registry on load.
const SceneStore = {
  objectsPayload(om){
    return {
      counter: om.counter,
      objects: om.objects.map(o => {
        const d = {
          type:o.userData.type, name:o.userData.name, uid:o.userData.uid,
          color:'#' + o.material.color.getHexString(),
          position:o.position.toArray(),
          rotation:[o.rotation.x, o.rotation.y, o.rotation.z],
          scale:o.scale.toArray()
        };
        if (o.userData.texture) d.texture = o.userData.texture;
        if (o.userData.uv) d.uv = o.userData.uv;
        if (o.userData.hollow) d.hollow = true;
        if (o.material.opacity < 1) d.opacity = +o.material.opacity.toFixed(3);
        if (o.userData.hidden) d.hidden = true;
        if (o.userData.type === 'custom'){
          d.custom = {
            verts: Array.from(o.geometry.attributes.position.array, v => +v.toFixed(4)),
            norms: Array.from(o.geometry.attributes.normal.array, v => +v.toFixed(3))
          };
          // per-vertex colors (from merging differently-colored objects)
          if (o.geometry.attributes.color){
            d.custom.colors = Array.from(o.geometry.attributes.color.array, v => +v.toFixed(4));
          }
        } else if (o.userData.deformed)
          d.verts = Array.from(o.geometry.attributes.position.array, v => +v.toFixed(4));
        return d;
      })
    };
  },
  serialize(om, cam, extra = {}){
    return JSON.stringify({
      app:'crucible3d', version:1,
      camera:{ theta:cam.theta, phi:cam.phi, radius:cam.radius, target:cam.target.toArray() },
      ...this.objectsPayload(om),
      ...extra
    }, null, 1);
  },
  apply(json, om, cam){
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (d.app !== 'crucible3d' || !Array.isArray(d.objects)) throw new Error('Not a Crucible3D scene');
    om.clear();
    om.restore(d.objects, d.counter);
    if (d.camera){
      cam.theta = d.camera.theta; cam.phi = d.camera.phi;
      cam.radius = d.camera.radius; cam.target.fromArray(d.camera.target);
      cam.apply();
    }
    return d.objects.length;
  },
  download(om, cam){
    const blob = new Blob([this.serialize(om, cam)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crucible3d-scene.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
};
export default SceneStore;
