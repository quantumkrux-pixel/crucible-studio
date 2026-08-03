/* global THREE */
import { kvGet, kvSet } from '../io/kvStore.js';

// Live preview mini-HUD: a small turntable view of the whole scene in
// the bottom-left corner, slowly orbiting and auto-framed to the
// scene's bounds. Rendered as a scissor pass on the MAIN renderer
// (registered via SceneManager.addRenderHook), so there's no second
// WebGL context — the DOM panel is a transparent frame whose bounding
// rect defines the render region each frame.
// A slim chevron tab collapses/expands it; the state persists.
const KEY = 'ui:preview-hud';
const SIZE_KEY = 'ui:preview-hud-size';
const MIN_W = 130, MIN_H = 84, MAX_W = 460, MAX_H = 320;
const ASPECT = 210 / 136;

export default class PreviewHUD {
  constructor(sceneManager, objectManager){
    this.sm = sceneManager; this.om = objectManager;
    this.root = document.getElementById('phud');
    this.panel = document.getElementById('phud-panel');
    this.view = document.getElementById('phud-view');
    this.tab = document.getElementById('phud-tab');
    this.grip = document.getElementById('phud-resize');
    this.cam = new THREE.PerspectiveCamera(45, 1.5, 0.1, 300);
    this.cam.layers.enable(2);   // also render the minimap-only draw plane (Magic Pen)
    this.theta = 0;
    this.open = true;
    this.w = 210; this.h = 136;
    this.tab.addEventListener('click', () => this.toggle(true));
    this.#bindResize();
    this.#restore();
    this.#syncTab();
    sceneManager.addRenderHook(() => this.#render());
  }
  #applySize(){
    this.panel.style.width = this.w + 'px';
    this.panel.style.height = this.h + 'px';
  }
  #bindResize(){
    let active = false, sx = 0, sy = 0, w0 = 0, h0 = 0;
    const down = (x, y) => {
      active = true; sx = x; sy = y; w0 = this.w; h0 = this.h;
      this.panel.classList.remove('animating');
    };
    const move = (x, y) => {
      if (!active) return;
      // dragging up-right grows the panel (anchored bottom-left)
      let w = w0 + (x - sx);
      w = Math.max(MIN_W, Math.min(MAX_W, w));
      let h = w / ASPECT;
      if (h < MIN_H){ h = MIN_H; w = h * ASPECT; }
      if (h > MAX_H){ h = MAX_H; w = h * ASPECT; }
      this.w = Math.round(w); this.h = Math.round(h);
      this.#applySize();
    };
    const up = () => {
      if (!active) return;
      active = false;
      kvSet(SIZE_KEY, `${this.w}x${this.h}`);
    };
    this.grip.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); down(e.clientX, e.clientY); });
    window.addEventListener('mousemove', e => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', up);
    this.grip.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation();
      down(e.touches[0].clientX, e.touches[0].clientY); }, { passive:false });
    window.addEventListener('touchmove', e => { if (active){ e.preventDefault();
      move(e.touches[0].clientX, e.touches[0].clientY); } }, { passive:false });
    window.addEventListener('touchend', up);
  }
  async #restore(){
    const size = await kvGet(SIZE_KEY);
    if (size){
      const m = /^(\d+)x(\d+)$/.exec(size);
      if (m){
        this.w = Math.max(MIN_W, Math.min(MAX_W, +m[1]));
        this.h = Math.max(MIN_H, Math.min(MAX_H, +m[2]));
      }
    }
    this.#applySize();
    const v = await kvGet(KEY);
    if (v === '0'){
      this.open = false;
      this.root.classList.add('closed');
      this.#syncTab();
    }
  }
  toggle(persist){
    this.open = !this.open;
    this.panel.classList.add('animating');
    this.root.classList.toggle('closed', !this.open);
    this.#syncTab();
    if (persist) kvSet(KEY, this.open ? '1' : '0');
  }
  #syncTab(){
    this.tab.textContent = this.open ? '‹' : '›';
    this.tab.title = this.open ? 'Hide preview' : 'Show preview';
  }
  #frameScene(){
    const box = new THREE.Box3();
    let has = false;
    for (const o of this.om.objects){ box.expandByObject(o); has = true; }
    if (!has) return { center:new THREE.Vector3(0, 0.8, 0), radius:5 };
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.min(40, Math.max(3.5, Math.max(size.x, size.y, size.z) * 1.7));
    return { center, radius };
  }
  #render(){
    if (!this.open) return;
    const r = this.sm.renderer, cv = r.domElement;
    const cr = cv.getBoundingClientRect(), pr = this.view.getBoundingClientRect();
    const w = pr.width, h = pr.height;
    if (w < 12 || h < 12) return;              // collapsed / mid-animation

    this.theta += 0.0045;                       // slow turntable
    const { center, radius } = this.#frameScene();
    this.cam.position.set(
      center.x + radius * Math.sin(this.theta),
      center.y + radius * 0.55,
      center.z + radius * Math.cos(this.theta));
    this.cam.lookAt(center);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();

    const x = pr.left - cr.left;
    const y = cr.bottom - pr.bottom;            // WebGL origin: bottom-left
    r.setScissorTest(true);
    r.setViewport(x, y, w, h);
    r.setScissor(x, y, w, h);
    r.render(this.sm.scene, this.cam);
    r.setScissorTest(false);
    r.setViewport(0, 0, cr.width, cr.height);   // restore for next frame
  }
}
