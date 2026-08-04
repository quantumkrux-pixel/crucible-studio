// Object inspector, rendered into one or more mounts (desktop panel +
// mobile sheet share identical markup and wiring).
export default class PropertiesPanel {
  static PALETTE = ['#C9CFD8','#FF9838','#FF5470','#7BE07B','#4DA6FF','#B68CFF',
                    '#FFD166','#3DD6C3','#F4A0C0','#8D6E63','#5C6BC0','#455A64'];
  constructor(bus, objectManager, mounts, opts = {}){
    this.bus = bus; this.om = objectManager; this.mounts = mounts;
    this.palette = opts.palette || null;
    this.paintStudio = opts.paintStudio || null;
    this.anchors = opts.anchors || null;
    this.sortMode = 'age';   // 'age' (creation order) or 'type'
    bus.on('selection:changed', () => this.render());
    bus.on('object:transformed', () => this.sync());
    // keep the outliner current as objects are added/removed/renamed
    bus.on('objects:changed', () => { if (!this.om.selected) this.render(); });
    // refresh when the texture palette changes (added/removed)
    bus.on('palette:changed', () => { if (this.om.selected) this.render(); });
    this.render();
  }
  #deg(r){ return r * 180 / Math.PI; }
  // Scene outliner shown when nothing is selected: every object with a
  // color swatch, name, and quick actions. Clicking a row selects it.
  #listMarkup(){
    const objs = this.om.objects;
    if (!objs.length)
      return `<div class="empty">No objects yet. Add one from the ${document.body.classList.contains('mobile') ? 'Add button' : 'left rail'}.</div>`;
    // display order: 'age' = creation order (native), 'type' = grouped by type
    const order = objs.map((o, i) => ({ o, i }));
    if (this.sortMode === 'type'){
      order.sort((a, b) => {
        const ta = a.o.userData.type || '', tb = b.o.userData.type || '';
        return ta.localeCompare(tb) || a.i - b.i;   // stable within a type
      });
    }
    const rows = order.map(({ o }) => {
      const col = '#' + o.material.color.getHexString();
      const type = o.userData.type === 'custom' ? 'custom' : (o.userData.type || 'object');
      const hidden = !!o.userData.hidden;
      const dim = o.material.opacity < 1 ? ' style="opacity:.6"' : '';
      const eye = hidden
        ? '<path d="M2 2l20 20M9.9 4.24A9.1 9.1 0 0 1 12 4c5 0 9 5 9 8a12 12 0 0 1-2.16 3.19M6.6 6.6A12 12 0 0 0 3 12c0 3 4 8 9 8a9 9 0 0 0 3.9-.9"/>'   // eye-off
        : '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/>';   // eye
      return `<button class="obj-row${hidden ? ' is-hidden' : ''}" data-uid="${o.userData.uid}">
        <span class="obj-eye" data-eye="${o.userData.uid}" title="${hidden ? 'Show' : 'Hide'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">${eye}</svg></span>
        <span class="obj-dot" style="background:${col}"${dim}></span>
        <span class="obj-name">${this.#esc(o.userData.name || 'Object')}</span>
        <span class="obj-type">${type}</span>
        <span class="obj-del" data-del="${o.userData.uid}" title="Delete">✕</span>
      </button>`;
    }).join('');
    const sortLabel = this.sortMode === 'type' ? 'Type' : 'Added';
    return `<div class="obj-list-head">
        <span>${objs.length} object${objs.length===1?'':'s'}</span>
        <button class="obj-sort" data-sort title="Change sort order">Sort: ${sortLabel}</button>
      </div>
      <div class="obj-list">${rows}</div>
      <div class="obj-list-hint">Tap a row to edit · eye hides · ✕ deletes.</div>`;
  }
  // In-project texture palette: thumbnails of saved painted/imported
  // textures. Click one to apply it to the selected object.
  #paletteMarkup(){
    if (!this.palette || !this.palette.count) return '';
    const thumbs = this.palette.items.map(t =>
      `<div class="pal-thumb" data-pal="${t.id}" title="${(t.name||'').replace(/"/g,'')}">
        <img src="${t.dataURL}" alt="">
        <button class="pal-del" data-pal-del="${t.id}" title="Delete">✕</button>
      </div>`).join('');
    return `<div class="tex-palette"><div class="tex-palette-label">Project textures</div>
      <div class="tex-palette-grid">${thumbs}</div></div>`;
  }
  #esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  // Texture placement sliders (UV offset / scale / rotation).
  #uvControls(sel){
    const uv = sel.userData.uv || { offX:0, offY:0, repX:1, repY:1, rot:0 };
    const row = (label, key, min, max, step, val, unit='') =>
      `<div class="uv-row"><span class="uv-label">${label}</span>
        <input type="range" class="uv-slider" data-uv="${key}" min="${min}" max="${max}" step="${step}" value="${val}">
        <span class="uv-val" data-uvval="${key}">${(+val).toFixed(2)}${unit}</span></div>`;
    return `<div class="uv-controls">
      <div class="uv-head">Texture placement <button class="uv-reset" data-uv-reset>Reset</button></div>
      ${row('Move X', 'offX', -1, 1, 0.01, uv.offX)}
      ${row('Move Y', 'offY', -1, 1, 0.01, uv.offY)}
      ${row('Scale X', 'repX', 0.1, 5, 0.05, uv.repX)}
      ${row('Scale Y', 'repY', 0.1, 5, 0.05, uv.repY)}
      ${row('Rotate', 'rot', 0, 360, 1, uv.rot, '°')}
      <div class="uv-hint">Tip: drag on the object to move the texture directly.</div>
    </div>`;
  }
  #markup(){
    const sel = this.om.selected;
    if (!sel) return this.#listMarkup();
    const multi = this.om.selection.length > 1
      ? `<div class="multi-note">${this.om.selection.length} objects selected · editing “${sel.userData.name}”. Merge them from More Tools…</div>`
      : '';
    const p = sel.position, r = sel.rotation, s = sel.scale;
    const col = '#' + sel.material.color.getHexString().toUpperCase();
    const vec = (kind, vals, step) => `<div class="vec3">${['X','Y','Z'].map((ax,i)=>`
      <div class="axis-field" data-ax="${ax}">
        <input type="number" step="${step}" data-bind="${kind}" data-i="${i}" value="${vals[i]}">
      </div>`).join('')}</div>`;
    return multi + `
      <div class="prop-row"><label>Name</label><input class="name-input" value="${sel.userData.name}"></div>
      <div class="prop-row"><label>Color</label><div class="swatch-grid">
        ${PropertiesPanel.PALETTE.map(c=>`<button class="swatch ${c.toUpperCase()===col?'active':''}"
          data-color="${c}" style="background:${c}"></button>`).join('')}</div></div>
      <div class="prop-row"><label>Texture</label>
        <div class="tex-row">
          <button class="action-btn" data-tex="add">${sel.userData.texture ? 'Replace image…' : 'Import image…'}</button>
          ${this.paintStudio ? '<button class="action-btn" data-tex="paint">🎨 Paint…</button>' : ''}
          ${sel.userData.texture ? '<button class="action-btn danger" data-tex="remove">Remove</button>' : ''}
        </div>
        ${this.#paletteMarkup()}
        ${sel.userData.texture ? `<div class="tex-preview"><img src="${sel.userData.texture}" alt=""></div>` : ''}
        ${sel.userData.texture ? this.#uvControls(sel) : ''}
      </div>
      <div class="prop-row"><label>Opacity</label>
        <div class="opacity-row">
          <input type="range" class="opacity-slider" min="0" max="100" step="1"
            value="${Math.round((sel.material.opacity ?? 1) * 100)}">
          <span class="opacity-val">${Math.round((sel.material.opacity ?? 1) * 100)}%</span>
        </div>
      </div>
      <div class="prop-row"><label>Position</label>${vec('pos',[p.x.toFixed(2),p.y.toFixed(2),p.z.toFixed(2)],'0.1')}</div>
      <div class="prop-row"><label>Rotation °</label>${vec('rot',[this.#deg(r.x).toFixed(0),this.#deg(r.y).toFixed(0),this.#deg(r.z).toFixed(0)],'5')}</div>
      <div class="prop-row"><label>Scale</label>${vec('scl',[s.x.toFixed(2),s.y.toFixed(2),s.z.toFixed(2)],'0.1')}</div>
      <div class="action-row">
        <button class="action-btn" data-act="dup">Duplicate</button>
        ${this.anchors?.isAnchored(sel.userData.uid)
          ? '<button class="action-btn" data-act="unanchor">⚓ Unanchor</button>'
          : '<button class="action-btn" data-act="anchor">⚓ Anchor…</button>'}
        <button class="action-btn danger" data-act="del">Delete</button>
      </div>`;
  }
  render(){
    const html = this.#markup();
    this.mounts.forEach(m => { m.innerHTML = html; this.#wire(m); });
  }
  #wire(root){
    const sel = () => this.om.selected;
    // --- object list (empty-state outliner) ---
    root.querySelectorAll('.obj-row').forEach(row => {
      row.addEventListener('click', e => {
        const uid = row.dataset.uid;
        const obj = this.om.objects.find(o => o.userData.uid === uid);
        if (!obj) return;
        // eye toggle: show/hide, don't select
        if (e.target.closest('.obj-eye')){
          e.stopPropagation();
          this.om.setHidden(obj, !obj.userData.hidden);
          this.bus.emit('history:commit');
          return;
        }
        // delete button: remove, don't select
        if (e.target.classList.contains('obj-del')){
          e.stopPropagation();
          this.om.remove(obj); this.bus.emit('history:commit');
          return;
        }
        this.om.select(obj);
      });
    });
    const sortBtn = root.querySelector('[data-sort]');
    if (sortBtn) sortBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.sortMode = this.sortMode === 'age' ? 'type' : 'age';
      this.render();
    });
    root.querySelectorAll('[data-bind]').forEach(inp => {
      inp.addEventListener('input', () => {
        const o = sel(); if (!o) return;
        const v = parseFloat(inp.value); if (isNaN(v)) return;
        const i = +inp.dataset.i, k = inp.dataset.bind, ax = ['x','y','z'][i];
        if (k === 'pos') o.position[ax] = v;
        if (k === 'rot') o.rotation[ax] = v * Math.PI / 180;
        if (k === 'scl') o.scale[ax] = Math.max(0.05, v);
        this.om.refreshSelection();
      });
      inp.addEventListener('change', () => this.bus.emit('history:commit'));
    });
    const opacity = root.querySelector('.opacity-slider');
    if (opacity){
      const label = root.querySelector('.opacity-val');
      opacity.addEventListener('input', () => {
        const o = sel(); if (!o) return;
        const v = +opacity.value / 100;
        o.material.opacity = v;
        o.material.transparent = v < 1;       // only pay the transparent-render cost when needed
        o.material.depthWrite = v >= 1;        // avoid sorting artifacts when see-through
        o.material.needsUpdate = true;
        if (label) label.textContent = opacity.value + '%';
      });
      opacity.addEventListener('change', () => this.bus.emit('history:commit'));
    }
    root.querySelectorAll('.swatch').forEach(b => b.addEventListener('click', () => {
      const o = sel(); if (!o) return;
      o.material.color.set(b.dataset.color);
      // if this was a merged (vertex-colored) object, a deliberate color pick
      // means "make it all this color" — turn off per-vertex colors.
      if (o.material.vertexColors){
        o.material.vertexColors = false;
        o.material.needsUpdate = true;
        delete o.userData.vertexColors;
      }
      if (o.material.map){                 // switching to a flat color clears the texture
        import('../io/TextureStore.js').then(({ removeTexture }) => { removeTexture(o); this.render(); });
      }
      this.bus.emit('history:commit');
      this.render();
    }));
    root.querySelectorAll('[data-tex]').forEach(b => b.addEventListener('click', () => {
      const o = sel(); if (!o) return;
      if (b.dataset.tex === 'remove'){
        import('../io/TextureStore.js').then(({ removeTexture }) => {
          removeTexture(o); this.bus.emit('history:commit'); this.render();
        });
        return;
      }
      if (b.dataset.tex === 'paint'){
        // open the paint studio seeded with the object's current color
        const base = '#' + o.material.color.getHexString();
        this.paintStudio?.open(base);
        return;
      }
      // import: open a file picker, downscale, apply
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file) return;
        const { fileToDataURL, applyTexture } = await import('../io/TextureStore.js');
        try {
          const url = await fileToDataURL(file);
          await applyTexture(o, url);
          this.bus.emit('history:commit');
          this.render();
        } catch { /* bad image; ignore */ }
      });
      input.click();
    }));

    // --- texture palette: click a thumbnail to apply, ✕ to delete ---
    root.querySelectorAll('[data-pal]').forEach(el => el.addEventListener('click', async e => {
      if (e.target.closest('[data-pal-del]')) return;   // handled below
      const o = sel(); if (!o) return;
      const entry = this.palette?.get(el.dataset.pal);
      if (!entry) return;
      const { applyTexture } = await import('../io/TextureStore.js');
      await applyTexture(o, entry.dataURL);
      this.bus.emit('history:commit');
      this.render();
    }));
    root.querySelectorAll('[data-pal-del]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      this.palette?.remove(b.dataset.palDel);
      this.render();
    }));

    // --- texture placement (UV) sliders ---
    const uvSliders = root.querySelectorAll('.uv-slider');
    if (uvSliders.length){
      const applyUV = async () => {
        const o = sel(); if (!o) return;
        const { applyUVTransform } = await import('../io/TextureStore.js');
        const cur = o.userData.uv || { offX:0, offY:0, repX:1, repY:1, rot:0 };
        applyUVTransform(o, cur);
      };
      uvSliders.forEach(sl => {
        sl.addEventListener('input', async () => {
          const o = sel(); if (!o) return;
          const key = sl.dataset.uv;
          const cur = { offX:0, offY:0, repX:1, repY:1, rot:0, ...(o.userData.uv || {}) };
          cur[key] = +sl.value;
          const { applyUVTransform } = await import('../io/TextureStore.js');
          applyUVTransform(o, cur);
          const label = root.querySelector(`[data-uvval="${key}"]`);
          if (label) label.textContent = (+sl.value).toFixed(2) + (key === 'rot' ? '°' : '');
        });
        sl.addEventListener('change', () => this.bus.emit('history:commit'));
      });
      root.querySelector('[data-uv-reset]')?.addEventListener('click', async () => {
        const o = sel(); if (!o) return;
        const { applyUVTransform } = await import('../io/TextureStore.js');
        applyUVTransform(o, { offX:0, offY:0, repX:1, repY:1, rot:0 });
        this.bus.emit('history:commit');
        this.render();
      });
    }
    const name = root.querySelector('.name-input');
    if (name){
      name.addEventListener('input', () => { const o = sel(); if (o) o.userData.name = name.value; });
      name.addEventListener('change', () => this.bus.emit('history:commit'));
    }
    root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const o = sel(); if (!o) return;
      const act = b.dataset.act;
      if (act === 'anchor'){
        // enter targeting mode: next object click binds o to it
        this.bus.emit('anchor:start', o);
        import('./toast.js').then(({ default: toast }) => toast('Click the object to anchor to'));
        this.bus.emit('sheets:close');
        return;
      }
      if (act === 'unanchor'){
        this.anchors?.unbind(o.userData.uid);
        this.render();
        return;
      }
      act === 'del' ? this.om.remove(o) : this.om.duplicate(o);
      this.bus.emit('sheets:close');
    }));
  }
  sync(){
    const o = this.om.selected; if (!o) return;
    const vals = {
      pos:[o.position.x, o.position.y, o.position.z],
      rot:[this.#deg(o.rotation.x), this.#deg(o.rotation.y), this.#deg(o.rotation.z)],
      scl:[o.scale.x, o.scale.y, o.scale.z] };
    document.querySelectorAll('[data-bind]').forEach(inp => {
      if (document.activeElement === inp) return;
      const k = inp.dataset.bind, i = +inp.dataset.i;
      inp.value = k === 'rot' ? vals[k][i].toFixed(0) : vals[k][i].toFixed(2);
    });
  }
}
