// Timeline UI: a collapsible bottom bar for stop-motion editing.
// Opens with the "Animate" button; shows frame chips, capture/play
// controls, and an FPS slider. All animation logic lives in Timeline;
// this is just its view + input.
export default class TimelinePanel {
  constructor(bus, timeline, onionSkin){
    this.bus = bus; this.tl = timeline; this.onion = onionSkin;
    this.el = document.getElementById('timeline');
    this.framesEl = document.getElementById('tl-frames');
    this.open = false;
    this.#wire();
    bus.on('timeline:changed', d => this.#render(d));
    bus.on('onion:changed', () => this.#syncOnion());
    bus.on('objects:changed', () => { if (this.open) this.#renderStatus(); });
  }
  #wire(){
    document.getElementById('btn-animate').addEventListener('click', () => this.toggle());
    document.getElementById('tl-close').addEventListener('click', () => this.close());
    document.getElementById('tl-capture').addEventListener('click', () => this.tl.captureFrame());
    document.getElementById('tl-update').addEventListener('click', () => this.tl.updateFrame());
    document.getElementById('tl-play').addEventListener('click', () => this.tl.togglePlay());
    document.getElementById('tl-onion').addEventListener('click', () => this.onion?.toggle());
    const fps = document.getElementById('tl-fps-range');
    fps.addEventListener('input', () => {
      this.tl.setFps(+fps.value);
      document.getElementById('tl-fps-val').textContent = fps.value;
    });
    // ---- clip controls ----
    document.getElementById('tl-clip-select').addEventListener('change', e => {
      this.tl.selectClip(+e.target.value);
    });
    document.getElementById('tl-clip-add').addEventListener('click', () => {
      const name = prompt('Name this animation:', `Animation ${this.tl.clips.length + 1}`);
      if (name !== null) this.tl.addClip(name.trim() || undefined);
    });
    document.getElementById('tl-clip-rename').addEventListener('click', () => {
      const cur = this.tl.clip.name;
      const name = prompt('Rename animation:', cur);
      if (name !== null && name.trim()) this.tl.renameClip(this.tl.activeClip, name.trim());
    });
    document.getElementById('tl-clip-dup').addEventListener('click', () => {
      this.tl.duplicateClip(this.tl.activeClip);
    });
    document.getElementById('tl-clip-del').addEventListener('click', () => {
      if (this.tl.clips.length <= 1){ alert('At least one animation clip is required.'); return; }
      if (confirm(`Delete animation "${this.tl.clip.name}"? This can't be undone.`))
        this.tl.deleteClip(this.tl.activeClip);
    });
    this.#syncOnion();
  }
  #syncOnion(){
    document.getElementById('tl-onion')?.classList.toggle('on', !!this.onion?.enabled);
  }
  toggle(){ this.open ? this.close() : this.openPanel(); }
  openPanel(){
    this.open = true;
    this.el.classList.add('open');
    document.body.classList.add('animating-mode');
    document.getElementById('btn-animate').classList.add('active-chip');
    this.#render();
  }
  close(){
    this.open = false;
    this.el.classList.remove('open');
    document.body.classList.remove('animating-mode');
    document.getElementById('btn-animate').classList.remove('active-chip');
    this.tl.exitEditing();   // restore live poses, show all objects
  }
  #renderClips(){
    const sel = document.getElementById('tl-clip-select');
    if (!sel) return;
    sel.innerHTML = this.tl.clips.map((c, i) =>
      `<option value="${i}"${i === this.tl.activeClip ? ' selected' : ''}>${
        c.name.replace(/[<>&]/g,'')} (${c.frames.length})</option>`).join('');
    // also update the fps slider to reflect the active clip's fps
    const fps = document.getElementById('tl-fps-range');
    if (fps){ fps.value = this.tl.fps; document.getElementById('tl-fps-val').textContent = this.tl.fps; }
  }
  #renderStatus(){
    const s = document.getElementById('tl-status');
    const n = this.tl.count;
    if (!n) s.textContent = 'No frames yet — pose your objects, then Capture';
    else s.textContent = `Frame ${this.tl.active ? this.tl.index + 1 : '–'} / ${n}`;
    document.getElementById('tl-play').disabled = n < 2;
  }
  #render(d){
    if (!this.open) return;
    document.getElementById('tl-play').textContent = this.tl.playing ? '❚❚' : '▶';
    this.#renderClips();
    this.#renderStatus();
    // during playback, only update the highlighted chip (cheap)
    if (d?.light){ this.#highlight(); return; }
    this.framesEl.innerHTML = '';
    this.tl.frames.forEach((f, i) => {
      const chip = document.createElement('button');
      chip.className = 'tl-frame' + (i === this.tl.index ? ' active' : '');
      chip.innerHTML = `<span class="tl-frame-n">${i + 1}</span>
        <button class="tl-frame-del" title="Delete frame">✕</button>`;
      chip.addEventListener('click', () => this.tl.goTo(i));
      chip.querySelector('.tl-frame-del').addEventListener('click', e => {
        e.stopPropagation(); this.tl.deleteFrame(i);
      });
      this.framesEl.appendChild(chip);
    });
  }
  #highlight(){
    [...this.framesEl.children].forEach((c, i) =>
      c.classList.toggle('active', i === this.tl.index));
  }
}
