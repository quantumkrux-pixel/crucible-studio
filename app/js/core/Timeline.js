/* global THREE */
// Stop-motion timeline with multiple named animation CLIPS. Each clip is
// an independent sequence of pose-snapshot frames (object uid ->
// {position, rotation, scale}), played back at a chosen FPS like
// claymation. You can have several clips -- "walk", "jump", "wave" -- and
// switch which one you're editing/playing. On export, each clip becomes a
// separate named animation in the GLB.
//
// A "clip" is { name, fps, frames }. The active clip's frames drive all
// the existing frame operations, so the stop-motion workflow is unchanged.
//
// Emits: 'timeline:changed'.
export default class Timeline {
  constructor(bus, objectManager){
    this.bus = bus; this.om = objectManager;
    this.clips = [ this.#newClip('Animation 1') ];
    this.activeClip = 0;
    this.index = -1;
    this.playing = false;
    this._raf = null; this._acc = 0; this._last = 0;
  }

  #newClip(name){ return { name, fps: 6, frames: [] }; }

  get clip(){ return this.clips[this.activeClip]; }
  get frames(){ return this.clip.frames; }
  set frames(v){ this.clip.frames = v; }
  get fps(){ return this.clip.fps; }
  set fps(v){ this.clip.fps = v; }
  get count(){ return this.frames.length; }
  get active(){ return this.index >= 0 && this.index < this.frames.length; }

  addClip(name){
    const n = name || `Animation ${this.clips.length + 1}`;
    this.clips.push(this.#newClip(n));
    this.activeClip = this.clips.length - 1;
    this.index = -1;
    this.#showAll();
    this.#emit();
    return this.clips.length - 1;
  }
  selectClip(i){
    if (i < 0 || i >= this.clips.length || i === this.activeClip) return;
    this.stop();
    this.activeClip = i;
    this.index = -1;
    this.#showAll();
    this.#emit();
  }
  renameClip(i, name){
    if (i < 0 || i >= this.clips.length) return;
    const nm = (name || '').trim();
    if (nm) { this.clips[i].name = nm; this.#emit(); }
  }
  deleteClip(i){
    if (this.clips.length <= 1){
      this.clips[0] = this.#newClip('Animation 1'); this.activeClip = 0;
      this.index = -1; this.#showAll(); this.#emit(); return;
    }
    this.stop();
    this.clips.splice(i, 1);
    this.activeClip = Math.max(0, Math.min(this.activeClip, this.clips.length - 1));
    this.index = -1;
    this.#showAll();
    this.#emit();
  }
  duplicateClip(i){
    if (i < 0 || i >= this.clips.length) return;
    const src = this.clips[i];
    const copy = { name: src.name + ' copy', fps: src.fps,
      frames: JSON.parse(JSON.stringify(src.frames)) };
    this.clips.splice(i + 1, 0, copy);
    this.activeClip = i + 1;
    this.index = -1;
    this.#showAll();
    this.#emit();
  }

  #snapshot(){
    const poses = {};
    for (const o of this.om.objects){
      poses[o.userData.uid] = {
        p: o.position.toArray(),
        r: [o.rotation.x, o.rotation.y, o.rotation.z],
        s: o.scale.toArray()
      };
    }
    return { poses };
  }
  #applyFrame(frame){
    if (!frame) return;
    for (const o of this.om.objects){
      const pose = frame.poses[o.userData.uid];
      if (pose){
        o.visible = true;
        o.position.fromArray(pose.p);
        o.rotation.set(pose.r[0], pose.r[1], pose.r[2]);
        o.scale.fromArray(pose.s);
      } else {
        o.visible = false;
      }
    }
    this.om.refreshSelection();
  }
  #showAll(){ for (const o of this.om.objects) o.visible = !o.userData.hidden; }

  captureFrame(){
    const at = this.active ? this.index + 1 : this.frames.length;
    this.frames.splice(at, 0, this.#snapshot());
    this.index = at;
    this.#emit();
  }
  updateFrame(){
    if (!this.active) return;
    this.frames[this.index] = this.#snapshot();
    this.#emit();
  }
  deleteFrame(i = this.index){
    if (i < 0 || i >= this.frames.length) return;
    this.frames.splice(i, 1);
    this.index = Math.min(this.index, this.frames.length - 1);
    if (this.active) this.#applyFrame(this.frames[this.index]);
    else this.#showAll();
    this.#emit();
  }
  goTo(i){
    if (i < 0 || i >= this.frames.length) return;
    this.stop();
    this.index = i;
    this.#applyFrame(this.frames[i]);
    this.#emit();
  }
  clearAll(){
    this.stop();
    this.frames = []; this.index = -1;
    this.#showAll();
    this.#emit();
  }
  exitEditing(){
    this.stop();
    this.index = -1;
    this.#showAll();
    this.om.refreshSelection();
    this.#emit();
  }

  play(){
    if (this.frames.length < 2){ return; }
    this.playing = true; this._acc = 0; this._last = performance.now();
    const loop = now => {
      if (!this.playing) return;
      const dt = (now - this._last) / 1000; this._last = now;
      this._acc += dt;
      const step = 1 / this.fps;
      while (this._acc >= step){
        this._acc -= step;
        this.index = (this.index + 1) % this.frames.length;
        this.#applyFrame(this.frames[this.index]);
        this.#emit(true);
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
    this.#emit();
  }
  stop(){
    this.playing = false;
    if (this._raf){ cancelAnimationFrame(this._raf); this._raf = null; }
    this.#emit();
  }
  togglePlay(){ this.playing ? this.stop() : this.play(); }
  setFps(v){ this.clip.fps = Math.max(1, Math.min(24, v)); this.#emit(); }

  #emit(light){ this.bus.emit('timeline:changed', { light: !!light }); }

  toJSON(){
    const nonEmpty = this.clips.some(c => c.frames.length);
    if (!nonEmpty) return undefined;
    return { clips: this.clips, activeClip: this.activeClip };
  }
  fromJSON(data){
    this.stop();
    if (data && Array.isArray(data.clips) && data.clips.length){
      this.clips = data.clips.map(c => ({
        name: c.name || 'Animation',
        fps: c.fps || 6,
        frames: Array.isArray(c.frames) ? c.frames : []
      }));
      this.activeClip = Math.min(data.activeClip || 0, this.clips.length - 1);
    } else if (data && Array.isArray(data.frames)){
      this.clips = [ { name: 'Animation 1', fps: data.fps || 6, frames: data.frames } ];
      this.activeClip = 0;
    } else {
      this.clips = [ this.#newClip('Animation 1') ];
      this.activeClip = 0;
    }
    this.index = -1;
    this.#showAll();
    this.#emit();
  }
}
