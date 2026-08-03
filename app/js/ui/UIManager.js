// Builds the desktop rail, mobile dock, and Add sheet from the
// primitive + tool registries, and keeps chrome (hint, lift chip,
// undo/redo buttons, sheets) in sync with bus events.
//
// Tool groups: pass an array like
//   [{ id:'mesh', label:'Mesh', tools:['deform','face'] }]
// and those tools collapse into ONE button that expands with a small
// flyout of circular sub-tool icons (right of the rail, above the
// dock). The group button always shows the last-used sub-tool.
export default class UIManager {
  constructor(bus, objectManager, toolManager, groups = [], opts = {}){
    this.bus = bus; this.om = objectManager; this.tm = toolManager;
    this.groups = groups.map(g => ({ ...g, current: g.tools[0] }));
    // Primitives and tools both render in a 2-column grid (all visible).
    this.#buildRail(); this.#buildDock(); this.#buildAddSheet(); this.#wireChrome();
    this.#wirePenDepth();
    bus.on('tool:changed', () => this.#syncTools());
    bus.on('selection:changed', () => this.#syncTools());
    bus.on('objects:changed', () => this.#stats());
    bus.on('layout:changed', () => { this.closeFlyouts(); this.#syncTools(); });
    bus.on('sheets:close', () => this.closeSheets());
    window.addEventListener('click', () => this.closeFlyouts());
    this.#stats(); this.#syncTools();
  }
  #svg(inner, stroke='#8B93A1', w='1.6'){
    return `<svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${w}">${inner}</svg>`;
  }
  #groupOf(toolId){ return this.groups.find(g => g.tools.includes(toolId)); }

  // ---- grouped tool button + flyout (shared by rail & dock) ----
  #buildGroup(grp, variant){
    const wrap = document.createElement('div');
    wrap.className = 'tool-group';
    const btn = document.createElement('button');
    btn.className = (variant === 'rail' ? 'tool' : 'dock-btn') + ' mode grouped';
    btn.dataset.group = grp.id;
    btn._renderMain = () => {
      const def = this.tm.tools.get(grp.current);
      btn.dataset.mode = grp.current;
      btn.title = `${grp.label}: ${def.label}`;
      btn.innerHTML = this.#svg(def.icon, '#8B93A1', variant === 'dock' ? '1.8' : '1.6')
        + (grp.short ?? grp.label);   // short label fits the narrow rail grid + dock
    };
    btn._renderMain();
    btn.addEventListener('click', e => { e.stopPropagation(); this.#toggleFlyout(wrap); });

    const fly = document.createElement('div');
    fly.className = 'flyout';
    fly.addEventListener('click', e => e.stopPropagation());
    for (const tid of grp.tools){
      const tdef = this.tm.tools.get(tid);
      const sb = document.createElement('button');
      sb.className = 'sub-tool mode';
      sb.dataset.mode = tid;
      sb.title = tdef.label;
      sb.innerHTML = this.#svg(tdef.icon);
      sb.addEventListener('click', () => {
        grp.current = tid;
        this.#renderGroupMains(grp.id);
        this.tm.setActive(tid);
        this.closeFlyouts();
      });
      fly.appendChild(sb);
    }
    wrap.append(btn, fly);
    return wrap;
  }
  #renderGroupMains(gid){
    document.querySelectorAll(`.grouped[data-group="${gid}"]`).forEach(b => b._renderMain());
  }
  #toggleFlyout(wrap){
    const fly = wrap.querySelector('.flyout');
    const wasOpen = fly.classList.contains('open');
    this.closeFlyouts();
    if (!wasOpen) fly.classList.add('open');
  }
  closeFlyouts(){
    document.querySelectorAll('.flyout.open').forEach(f => f.classList.remove('open'));
  }

  // ---- construction ----
  // Build one rail button (primitive or standalone tool).
  #railPrimitiveBtn(id, def){
    const b = document.createElement('button');
    b.className = 'tool';
    b.innerHTML = this.#svg(def.icon) + def.label;
    b.addEventListener('click', () => this.om.add(id));
    return b;
  }
  #railToolBtn(id, def){
    const b = document.createElement('button');
    b.className = 'tool mode';
    b.dataset.mode = id;
    b.innerHTML = this.#svg(def.icon) + def.label;
    b.addEventListener('click', () => this.tm.setActive(id));
    return b;
  }

  #buildRail(){
    const rail = document.getElementById('rail');

    // --- Add section (primitives) in a 2-column grid ---
    const addGroup = document.createElement('div');
    addGroup.className = 'rail-group';
    addGroup.innerHTML = '<div class="rail-label">Add</div>';
    const addGrid = document.createElement('div');
    addGrid.className = 'rail-grid';
    for (const [id, def] of this.om.primitives){
      addGrid.appendChild(this.#railPrimitiveBtn(id, def));
    }
    addGroup.appendChild(addGrid);

    // --- Tool section in a 2-column grid ---
    const toolGroup = document.createElement('div');
    toolGroup.className = 'rail-group';
    toolGroup.innerHTML = '<div class="rail-label">Tool</div>';
    const toolGrid = document.createElement('div');
    toolGrid.className = 'rail-grid';
    const rendered = new Set();
    for (const [id, def] of this.tm.tools){
      const grp = this.#groupOf(id);
      if (grp){
        if (rendered.has(grp.id)) continue;
        rendered.add(grp.id);
        toolGrid.appendChild(this.#buildGroup(grp, 'rail'));
      } else {
        toolGrid.appendChild(this.#railToolBtn(id, def));
      }
    }
    toolGroup.appendChild(toolGrid);

    rail.append(addGroup, toolGroup);
  }
  #buildDock(){
    const dock = document.getElementById('dock');
    const mk = (label, icon, fn, cls='') => {
      const b = document.createElement('button');
      b.className = 'dock-btn ' + cls;
      b.innerHTML = this.#svg(icon, '#8B93A1', '1.8') + label;
      b.addEventListener('click', fn);
      dock.appendChild(b);
      return b;
    };
    mk('Add', '<path d="M12 5v14M5 12h14"/>', () => this.openSheet('sheet-add'));
    const rendered = new Set();
    for (const [id, def] of this.tm.tools){
      const grp = this.#groupOf(id);
      if (grp){
        if (rendered.has(grp.id)) continue;
        rendered.add(grp.id);
        dock.appendChild(this.#buildGroup(grp, 'dock'));
      } else {
        mk(def.label, def.icon, () => this.tm.setActive(id), 'mode').dataset.mode = id;
      }
    }
    mk('Object', '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="17" cy="18" r="2"/>',
      () => this.openSheet('sheet-props'));
  }
  #buildAddSheet(){
    const grid = document.getElementById('add-grid');
    for (const [id, def] of this.om.primitives){
      const b = document.createElement('button');
      b.className = 'add-card';
      b.innerHTML = this.#svg(def.icon, '#E8EAED') + def.label;
      b.addEventListener('click', () => { this.om.add(id); this.closeSheets(); });
      grid.appendChild(b);
    }
  }
  #wireChrome(){
    document.getElementById('scrim').addEventListener('click', () => this.closeSheets());
    document.getElementById('lift-chip').addEventListener('click', () => this.tm.toggleLift());
    document.getElementById('btn-undo').addEventListener('click', () => this.bus.emit('history:undo'));
    document.getElementById('btn-redo').addEventListener('click', () => this.bus.emit('history:redo'));
    this.bus.on('history:changed', s => {
      document.getElementById('btn-undo').disabled = !s.canUndo;
      document.getElementById('btn-redo').disabled = !s.canRedo;
    });
    const cv = document.querySelector('#viewport canvas');
    setTimeout(() => document.getElementById('hint').classList.add('gone'), 9000);
    if (cv) ['mousedown','touchstart'].forEach(ev =>
      cv.addEventListener(ev, () => document.getElementById('hint').classList.remove('gone')));
  }

  // ---- sheets ----
  openSheet(id){
    this.closeSheets();
    this.closeFlyouts();
    document.getElementById(id).classList.add('open');
    document.getElementById('scrim').classList.add('show');
  }
  closeSheets(){
    document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open'));
    document.getElementById('scrim').classList.remove('show');
  }

  // ---- sync ----
  #stats(){
    const n = this.om.objects.length;
    document.getElementById('scene-stats').textContent = `${n} object${n === 1 ? '' : 's'}`;
  }
  #syncTools(){
    // if a grouped tool was activated (e.g. via keyboard), reflect it
    // on the group's main button
    this.groups.forEach(g => {
      if (this.tm.active && g.tools.includes(this.tm.active) && g.current !== this.tm.active){
        g.current = this.tm.active;
        this.#renderGroupMains(g.id);
      }
    });
    document.querySelectorAll('.mode').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === this.tm.active));
    const chip = document.getElementById('lift-chip');
    const show = this.tm.active === 'move' && this.om.selected;
    const mobile = document.body.classList.contains('mobile');
    chip.classList.toggle('visible', !!show && mobile);
    chip.style.display = show ? (mobile ? '' : 'block') : 'none';
    chip.classList.toggle('on', this.tm.state.lift);
    chip.textContent = this.tm.state.lift ? 'Lift ↑↓ on' : 'Lift ↑↓ off';
    const tool = this.tm.activeTool;
    document.getElementById('hint').textContent = tool
      ? tool.hint(this.tm.state)
      : 'drag orbit · scroll zoom · right-drag pan · click select';
    // show the pen-depth bar only while the Magic Pen is active
    const pd = document.getElementById('pen-depth');
    if (pd) pd.style.display = (this.tm.active === 'pen') ? 'flex' : 'none';
  }
  #wirePenDepth(){
    const range = document.getElementById('pd-range');
    const val = document.getElementById('pd-val');
    const near = document.getElementById('pd-near');
    const far = document.getElementById('pd-far');
    if (!range) return;
    range.addEventListener('input', () => this.bus.emit('pen:setDepth', +range.value));
    near.addEventListener('click', () => this.bus.emit('pen:nudgeDepth', -0.15));
    far.addEventListener('click', () => this.bus.emit('pen:nudgeDepth', 0.15));
    // reflect depth changes (from keys, slider, or project restore)
    this.bus.on('pen:depth', v => {
      range.value = v;
      val.textContent = (v >= 0 ? '+' : '') + (+v).toFixed(1);
    });
  }
}
