/* global THREE */
// Onion-skinning: while editing (paused on) a frame in the timeline,
// show translucent "ghosts" of the objects at the previous and next
// frames' poses, so you can register a new pose against the last one —
// the classic animator's reference. Previous frame tints warm, next
// frame tints cool. Ghosts share each object's geometry (no copies of
// vertex data) and are rebuilt only when the frame/selection changes,
// not per render frame. Hidden entirely during playback.
//
// Toggle with the timeline's onion button; state persists via kvStore.
import { kvGet, kvSet } from '../io/kvStore.js';
const KEY = 'ui:onion-skin';
const PREV_COLOR = 0xFF7A4D;   // warm = past
const NEXT_COLOR = 0x4DA6FF;   // cool = future

export default class OnionSkin {
  constructor(bus, sceneManager, objectManager, timeline){
    this.bus = bus; this.sm = sceneManager; this.om = objectManager; this.tl = timeline;
    this.enabled = false;
    this.group = new THREE.Group();
    this.group.renderOrder = -1;
    sceneManager.scene.add(this.group);
    kvGet(KEY).then(v => { this.enabled = v === '1'; this.#rebuild(); this.bus.emit('onion:changed'); });
    bus.on('timeline:changed', d => { if (!d?.light) this.#rebuild(); else this.#hideWhilePlaying(); });
    bus.on('object:transformed', () => { if (this.enabled) this.#rebuild(); });
  }
  toggle(){
    this.enabled = !this.enabled;
    kvSet(KEY, this.enabled ? '1' : '0');
    this.#rebuild();
    this.bus.emit('onion:changed');
  }
  #hideWhilePlaying(){ this.group.visible = false; }
  #clear(){
    while (this.group.children.length){
      const m = this.group.children.pop();
      m.material.dispose();          // geometry is shared with the real object
    }
  }
  #rebuild(){
    this.#clear();
    // only show ghosts while paused on a real frame with neighbors
    const showable = this.enabled && !this.tl.playing && this.tl.active && this.tl.count > 1;
    this.group.visible = showable;
    if (!showable) return;

    const byUid = new Map(this.om.objects.map(o => [o.userData.uid, o]));
    const ghostFrame = (frameIdx, color) => {
      const frame = this.tl.frames[frameIdx];
      if (!frame) return;
      for (const uid in frame.poses){
        const src = byUid.get(uid);
        if (!src) continue;
        const pose = frame.poses[uid];
        const ghost = new THREE.Mesh(src.geometry, new THREE.MeshBasicMaterial({
          color, transparent:true, opacity:0.22, depthWrite:false, side:THREE.DoubleSide }));
        ghost.position.fromArray(pose.p);
        ghost.rotation.set(pose.r[0], pose.r[1], pose.r[2]);
        ghost.scale.fromArray(pose.s);
        this.group.add(ghost);
      }
    };
    ghostFrame(this.tl.index - 1, PREV_COLOR);
    ghostFrame(this.tl.index + 1, NEXT_COLOR);
  }
}
