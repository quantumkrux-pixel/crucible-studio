/* global THREE */
// Owns EVERY raw input event (mouse, touch, keyboard) and routes it:
// camera orbit/pan/zoom, tool drags, tap-to-select, shortcuts.
// Touch: 1 finger orbit/transform, 2 fingers pinch-zoom + pan.
import MoveTool from '../tools/MoveTool.js';

// Long-press: hold still on an object this long to "grab" and move it
// without selecting the Move tool first. Kept as a constant so it's
// easy to tune. Moving more than LONGPRESS_SLOP px before it fires
// cancels it (that's an orbit/drag, not a hold).
const LONGPRESS_MS = 500;
const LONGPRESS_SLOP = 6;

export default class InteractionManager {
  constructor(bus, sceneManager, cameraControls, objectManager, toolManager){
    Object.assign(this, { bus, sm:sceneManager, cam:cameraControls, om:objectManager, tm:toolManager });
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.drag = { active:false, kind:null, sx:0, sy:0, lx:0, ly:0, moved:false, button:0,
                  pinchDist:0, pinchMid:{x:0,y:0}, ctx:{} };
    this.lp = { timer:null, target:null, ctx:null };   // long-press state
    this._anchorPending = null;
    // enter anchor targeting: next object tap binds `a` to the tapped object
    bus.on('anchor:start', a => {
      this._anchorPending = a;
      document.body.classList.add('anchor-targeting');
    });
    bus.on('anchor:cancelMode', () => {
      this._anchorPending = null;
      document.body.classList.remove('anchor-targeting');
    });
    this.#bind(sceneManager.renderer.domElement);
    this.#keys();
  }
  // --- picking helpers (exposed to tools via ctx) ---
  #setNDC(x, y){
    const r = this.sm.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((x - r.left)/r.width)*2 - 1, -((y - r.top)/r.height)*2 + 1);
  }
  pick(x, y){
    this.#setNDC(x, y);
    this.ray.setFromCamera(this.ndc, this.sm.camera);
    const hits = this.ray.intersectObjects(this.om.objects);
    return hits.length ? hits[0].object : null;
  }
  pointOnPlane(x, y, plane){
    this.#setNDC(x, y);
    this.ray.setFromCamera(this.ndc, this.sm.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, p) ? p : null;
  }
  raycasterAt(x, y){
    this.#setNDC(x, y);
    this.ray.setFromCamera(this.ndc, this.sm.camera);
    return this.ray;
  }
  // --- long-press to grab-and-move ---
  #armLongPress(x, y){
    this.#cancelLongPress();
    // only when not using a tool that already claims drags, and there's
    // an object under the pointer
    const hit = this.pick(x, y);
    if (!hit) return;
    this.lp.target = hit;
    this.lp.timer = setTimeout(() => this.#fireLongPress(), LONGPRESS_MS);
  }
  #cancelLongPress(){
    if (this.lp.timer){ clearTimeout(this.lp.timer); this.lp.timer = null; }
    this.lp.target = null;
  }
  #fireLongPress(){
    this.lp.timer = null;
    const obj = this.lp.target;
    if (!obj || !this.drag.active) return;
    // grab: select the object and start a Move-tool drag on it.
    // Force ground-plane movement (lift off) so the grab behaves
    // predictably regardless of the Move tool's lift toggle.
    this.om.select(obj);
    const grabState = { ...this.tm.state, lift:false };
    const ctx = { object:obj, camera:this.sm.camera, cameraControls:this.cam,
                  state:grabState,
                  pointOnPlane:this.pointOnPlane.bind(this),
                  raycasterAt:this.raycasterAt.bind(this) };
    MoveTool.begin(this.drag.lx, this.drag.ly, ctx);
    this.drag.kind = 'grab';
    this.drag.ctx = ctx;
    this.drag.moved = true;   // prevent the release from being treated as a tap
    // feedback: haptic buzz on supporting devices + a visual pulse
    if (navigator.vibrate) navigator.vibrate(15);
    this.bus.emit('object:grabbed', obj);
    document.body.classList.add('grabbing');
    if (!this._grabHintShown){
      this._grabHintShown = true;
      import('../ui/toast.js').then(({ default: toast }) => toast('Grabbed — drag to move, release to drop'));
    }
  }

  // --- drag lifecycle ---
  #begin(x, y, additive){
    const d = this.drag;
    d.sx = d.lx = x; d.sy = d.ly = y; d.moved = false; d.active = true;
    d.additive = !!additive || this.tm.active === 'multi';
    const tool = this.tm.activeTool, sel = this.om.selected;
    // the Multi tool is selection-only: it never claims a drag as a transform
    if (tool && this.tm.active !== 'multi' && (sel || tool.needsSelection === false)){
      const ctx = { object:sel, camera:this.sm.camera, cameraControls:this.cam, state:this.tm.state,
                    pointOnPlane:this.pointOnPlane.bind(this),
                    raycasterAt:this.raycasterAt.bind(this) };
      const claims = tool.claim ? tool.claim(x, y, ctx) : (sel && this.pick(x, y) === sel);
      if (claims){
        d.kind = 'tool'; d.ctx = ctx;
        tool.begin(x, y, ctx);
        return;
      }
    }
    d.kind = 'orbit';
    // A press that would otherwise orbit can instead become a grab if
    // held still on an object. (Skip while a selection-only tool like
    // Multi is active, and skip additive/shift presses.)
    if (this.tm.active !== 'multi' && !additive) this.#armLongPress(x, y);
  }
  #move(x, y, pan){
    const d = this.drag;
    const dx = x - d.lx, dy = y - d.ly;
    d.lx = x; d.ly = y;
    if (Math.abs(x - d.sx) + Math.abs(y - d.sy) > 5) d.moved = true;
    // moving beyond a small slop before the hold fires means this is an
    // orbit/drag, not a long-press — cancel the pending grab.
    if (this.lp.timer && Math.abs(x - d.sx) + Math.abs(y - d.sy) > LONGPRESS_SLOP)
      this.#cancelLongPress();
    if (d.kind === 'grab'){
      MoveTool.update(x, y, d.sx, d.sy, d.ctx);
      this.om.notifyTransformed();
    } else if (d.kind === 'orbit') pan ? this.cam.pan(dx, dy) : this.cam.orbit(dx, dy);
    else if (d.kind === 'tool' && this.tm.activeTool){
      this.tm.activeTool.update(x, y, d.sx, d.sy, d.ctx);
      this.om.notifyTransformed();
    }
  }
  #end(x, y){
    const d = this.drag;
    this.#cancelLongPress();
    if (d.kind === 'grab'){
      // finished a long-press move — commit it to history
      this.bus.emit('history:commit');
      document.body.classList.remove('grabbing');
      this.bus.emit('object:released');
    } else if (d.active && !d.moved){
      const hit = this.pick(x, y);
      // anchor targeting: the next object tap binds the pending object to it
      if (this._anchorPending){
        const src = this._anchorPending;
        this._anchorPending = null;
        document.body.classList.remove('anchor-targeting');
        if (hit && hit !== src){
          this.bus.emit('anchor:bind', { a: src, b: hit });
        } else {
          this.bus.emit('anchor:cancel');
        }
        return;
      }
      if (d.additive){
        if (hit) this.om.toggleSelect(hit);   // shift-click / Multi tool
      } else {
        this.om.select(hit);
      }
    } else if (d.active && d.kind === 'tool' && d.moved){
      this.tm.activeTool?.end?.(d.ctx);
      this.bus.emit('history:commit');
    }
    d.active = false; d.kind = null;
  }
  #bind(cv){
    cv.addEventListener('mousedown', e => { this.#begin(e.clientX, e.clientY, e.shiftKey); this.drag.button = e.button; });
    window.addEventListener('mousemove', e => {
      if (this.drag.active) this.#move(e.clientX, e.clientY,
        this.drag.button === 2 || this.drag.button === 1 || e.shiftKey);
    });
    window.addEventListener('mouseup', e => { if (this.drag.active) this.#end(e.clientX, e.clientY); });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.cam.zoom(1 + Math.sign(e.deltaY) * 0.09);
    }, { passive:false });

    cv.addEventListener('touchstart', e => {
      e.preventDefault();
      const d = this.drag;
      if (e.touches.length === 1) this.#begin(e.touches[0].clientX, e.touches[0].clientY);
      else if (e.touches.length === 2){
        this.#cancelLongPress();   // two fingers = pinch, not a hold
        d.active = true; d.kind = 'pinch'; d.moved = true;
        const [a,b] = e.touches;
        d.pinchDist = Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
        d.pinchMid = { x:(a.clientX+b.clientX)/2, y:(a.clientY+b.clientY)/2 };
      }
    }, { passive:false });
    cv.addEventListener('touchmove', e => {
      e.preventDefault();
      const d = this.drag;
      if (!d.active) return;
      if (d.kind === 'pinch' && e.touches.length === 2){
        const [a,b] = e.touches;
        const dist = Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
        const mid = { x:(a.clientX+b.clientX)/2, y:(a.clientY+b.clientY)/2 };
        this.cam.zoom(d.pinchDist / dist);
        this.cam.pan(mid.x - d.pinchMid.x, mid.y - d.pinchMid.y);
        d.pinchDist = dist; d.pinchMid = mid;
      } else if (e.touches.length === 1) this.#move(e.touches[0].clientX, e.touches[0].clientY, false);
    }, { passive:false });
    cv.addEventListener('touchend', e => {
      e.preventDefault();
      if (e.touches.length === 0){
        if (this.drag.kind === 'pinch'){ this.drag.active = false; this.drag.kind = null; }
        else this.#end(this.drag.lx, this.drag.ly);
      }
    }, { passive:false });
  }
  #keys(){
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();

      // ---- Shift+Alt: quick-move the selected object with arrow keys ----
      // Up/Down = vertical (world Y); Left/Right = horizontal, relative to
      // the camera so it always matches screen-left / screen-right.
      if (e.shiftKey && e.altKey && e.key.startsWith('Arrow')){
        const obj = this.om.selected;
        if (obj){
          e.preventDefault();
          // switch to the Move tool for visual consistency
          if (this.tm.active !== 'move') this.tm.setActive('move');
          const step = 0.1;   // world units per press
          const cam = this.sm.camera;
          if (e.key === 'ArrowUp')   obj.position.y += step;
          if (e.key === 'ArrowDown') obj.position.y -= step;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
            // camera "right" vector, flattened to the horizontal plane so
            // the object slides left/right on screen without drifting in Y
            cam.updateMatrixWorld();
            const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
            right.y = 0;
            if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
            right.normalize().multiplyScalar(e.key === 'ArrowRight' ? step : -step);
            obj.position.add(right);
          }
          this.bus.emit('object:transformed', obj);
          // debounce a history commit so a burst of presses is one undo step
          clearTimeout(this._nudgeCommit);
          this._nudgeCommit = setTimeout(() => this.bus.emit('history:commit'), 400);
        }
        return;
      }

      if (e.ctrlKey || e.metaKey){
        if (k === 'z'){ e.preventDefault(); this.bus.emit(e.shiftKey ? 'history:redo' : 'history:undo'); }
        if (k === 'y'){ e.preventDefault(); this.bus.emit('history:redo'); }
        // Ctrl+↑/↓ adjusts Magic Pen draw depth (only while pen is active)
        if (this.tm.active === 'pen' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
          e.preventDefault();
          const step = e.shiftKey ? 0.5 : 0.15;   // Shift = coarse
          this.bus.emit('pen:nudgeDepth', e.key === 'ArrowUp' ? step : -step);
        }
        return;
      }
      for (const [id, def] of this.tm.tools) if (def.key === k) this.tm.setActive(id);
      if ((k === 'delete' || k === 'backspace') && this.om.selected) this.om.remove(this.om.selected);
      if (k === 'd' && this.om.selected) this.om.duplicate(this.om.selected);
      if (k === 'escape'){
        if (this._anchorPending){ this.bus.emit('anchor:cancelMode'); return; }
        this.om.select(null);
      }
    });
  }
}
