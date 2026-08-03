import { THEMES, DEFAULT_THEME } from '../config/themes.js';
import { kvGet, kvSet } from '../io/kvStore.js';

// Settings modal with two entry points:
//   open()            — global mode (lobby ⚙): picks the app-wide theme
//   openProject(cb)   — project mode (File ▾ → Project theme…): sets a
//                       per-project override, with an "App default"
//                       card to clear it. cb fires on change so the
//                       project can persist immediately.
// The effective theme = project override ?? global choice.
const THEME_KEY = 'settings:theme';
const GRID_KEY = 'settings:grid';

export default class SettingsPanel {
  constructor(sceneManager){
    this.sm = sceneManager;
    this.el = document.getElementById('settings');
    this.globalId = DEFAULT_THEME;
    this.override = null;          // per-project override (theme id | null)
    this.mode = 'global';
    this.onChange = null;
    this.#buildShell();
    document.getElementById('btn-settings').addEventListener('click', () => this.open());
    this.#init();
  }
  get effectiveId(){ return this.override ?? this.globalId; }
  async #init(){
    const saved = await kvGet(THEME_KEY);
    if (saved && THEMES.some(t => t.id === saved)) this.globalId = saved;
    this.#applyEffective();
    const g = await kvGet(GRID_KEY);
    this.#setGrid(g !== '0', false);
  }
  #applyEffective(){
    const t = THEMES.find(x => x.id === this.effectiveId) ?? THEMES[0];
    this.sm.setTheme(t);
  }
  // Called by ProjectManager when opening/creating/leaving a project.
  setProjectOverride(id){
    this.override = id && THEMES.some(t => t.id === id) ? id : null;
    this.#applyEffective();
  }

  open(){ this.mode = 'global'; this.onChange = null; this.#renderOptions(); this.el.classList.add('open'); }
  openProject(onChange){ this.mode = 'project'; this.onChange = onChange ?? null; this.#renderOptions(); this.el.classList.add('open'); }
  close(){ this.el.classList.remove('open'); }

  #buildShell(){
    this.el.innerHTML = `
      <div class="settings-card">
        <div class="settings-head">
          <h2>Settings</h2>
          <button class="settings-close" title="Close">✕</button>
        </div>
        <div class="settings-label" id="settings-theme-label">Scene theme</div>
        <div class="theme-grid" id="theme-grid"></div>
        <div class="settings-label" style="margin-top:18px">Grid</div>
        <button class="settings-toggle" id="grid-toggle">
          <span class="settings-toggle-name">Show gridlines</span>
          <span class="settings-switch"><span class="settings-knob"></span></span>
        </button>
        <div id="lighting-section">
          <div class="settings-label" style="margin-top:18px">Lighting</div>
          <button class="settings-toggle" id="light-sun-toggle">
            <span class="settings-toggle-name">Key light (sun &amp; shadows)</span>
            <span class="settings-switch"><span class="settings-knob"></span></span>
          </button>
          <button class="settings-toggle" id="light-fill-toggle">
            <span class="settings-toggle-name">Fill light (ambient)</span>
            <span class="settings-switch"><span class="settings-knob"></span></span>
          </button>
        </div>
      </div>`;
    this.el.addEventListener('click', e => { if (e.target === this.el) this.close(); });
    this.el.querySelector('.settings-close').addEventListener('click', () => this.close());
    this.gridVisible = true;
    this.gridToggle = this.el.querySelector('#grid-toggle');
    this.gridToggle.addEventListener('click', () => this.#setGrid(!this.gridVisible, true));
    // per-project lighting (defaults both on)
    this.lighting = { sun:true, fill:true };
    this.onLightingChange = null;
    this.sunToggle = this.el.querySelector('#light-sun-toggle');
    this.fillToggle = this.el.querySelector('#light-fill-toggle');
    this.sunToggle.addEventListener('click', () => this.#toggleLight('sun'));
    this.fillToggle.addEventListener('click', () => this.#toggleLight('fill'));
    this.#syncLightToggles();
  }
  #toggleLight(which){
    this.lighting[which] = !this.lighting[which];
    this.sm.setLighting({ [which]: this.lighting[which] });
    this.#syncLightToggles();
    this.onLightingChange?.({ ...this.lighting });   // persist on the project
  }
  #syncLightToggles(){
    this.sunToggle.classList.toggle('on', this.lighting.sun);
    this.fillToggle.classList.toggle('on', this.lighting.fill);
  }
  // Called by ProjectManager when opening/creating a project. Applies
  // the saved lighting (or defaults) without triggering a persist.
  setProjectLighting(state){
    this.lighting = {
      sun: state?.sun !== false,      // default on
      fill: state?.fill !== false,
    };
    this.sm.setLighting(this.lighting);
    this.#syncLightToggles();
  }
  #setGrid(v, persist){
    this.gridVisible = v;
    this.sm.setGridVisible(v);
    this.gridToggle.classList.toggle('on', v);
    if (persist) kvSet(GRID_KEY, v ? '1' : '0');
  }
  #renderOptions(){
    // Lighting is a per-project setting, so only offer it when editing a
    // project (File ▾ → Project theme…), not from the global lobby ⚙.
    const lightSection = this.el.querySelector('#lighting-section');
    if (lightSection) lightSection.style.display = this.mode === 'project' ? '' : 'none';
    const grid = this.el.querySelector('#theme-grid');
    const label = this.el.querySelector('#settings-theme-label');
    const hex = n => '#' + n.toString(16).padStart(6, '0');
    const card = (t, id, name, sub = '') => `
      <button class="theme-opt" data-theme="${id}">
        <div class="theme-preview" style="background-color:${hex(t.bg)};
          background-image:
            linear-gradient(${hex(t.gridMajor)}66 1px, transparent 1px),
            linear-gradient(90deg, ${hex(t.gridMajor)}66 1px, transparent 1px);
          background-size:11px 11px;"></div>
        <span>${name}</span>${sub ? `<span class="sub">${sub}</span>` : ''}
      </button>`;
    let html = '';
    if (this.mode === 'project'){
      label.textContent = 'Project theme';
      const g = THEMES.find(t => t.id === this.globalId) ?? THEMES[0];
      html += card(g, '__default', 'App default', g.label);
    } else {
      label.textContent = 'Scene theme';
    }
    html += THEMES.map(t => card(t, t.id, t.label)).join('');
    grid.innerHTML = html;
    grid.querySelectorAll('.theme-opt').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.theme;
      if (this.mode === 'project'){
        this.override = id === '__default' ? null : id;
        this.#applyEffective();
        this.onChange?.(this.override);
      } else {
        this.globalId = id;
        kvSet(THEME_KEY, id);
        this.#applyEffective();
      }
      this.#syncActive();
    }));
    this.#syncActive();
  }
  #syncActive(){
    const activeId = this.mode === 'project' ? (this.override ?? '__default') : this.globalId;
    this.el.querySelectorAll('.theme-opt').forEach(b =>
      b.classList.toggle('active', b.dataset.theme === activeId));
  }
}
