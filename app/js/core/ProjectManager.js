import SceneStore from '../io/SceneStore.js';
import Lobby from '../ui/Lobby.js';
import toast from '../ui/toast.js';

// Project lifecycle: owns the current project, opens/creates projects
// from the Lobby, autosaves (scene JSON + a thumbnail captured from
// the renderer) when leaving a project, and shows the project name in
// the topbar. The brand mark doubles as "back to projects".
// A per-project scene-theme override is stored in the project data
// ('theme' field) and applied through SettingsPanel on open.
export default class ProjectManager {
  constructor(bus, sceneManager, cameraControls, objectManager, store, settings, folder = null, timeline = null, palette = null, anchors = null){
    this.bus = bus; this.sm = sceneManager; this.cam = cameraControls;
    this.om = objectManager; this.store = store; this.settings = settings;
    this.folder = folder; this.timeline = timeline; this.palette = palette; this.anchors = anchors;
    this.current = null;
    this.penDepth = 0;
    // track the Magic Pen draw depth so it persists with the project
    bus.on('pen:depth', v => { this.penDepth = v; });
    this.nameEl = document.getElementById('project-name');
    this.lobby = new Lobby(store, {
      onOpen: entry => this.open(entry),
      onCreate: name => this.create(name)
    }, folder);
    const brand = document.getElementById('brand');
    brand.style.cursor = 'pointer';
    brand.title = 'Back to projects';
    brand.addEventListener('click', () => this.exitToLobby());
    // persist lighting toggles onto the open project
    this.settings.onLightingChange = () => { if (this.current) this.saveCurrent(); };
    // refresh the lobby's "sign in to start" state when auth changes
    this.bus.on('auth:changed', () => {
      if (!this.current && this.lobby?.el?.classList.contains('open'))
        this.lobby.show();
    });
  }
  showLobby(){ this.lobby.show(); }

  async create(name){
    let entry;
    try {
      entry = await this.store.create(name);
    } catch (err){
      // free-tier cap hit (RLS rejected the insert) → prompt to upgrade
      if (err?.name === 'ProjectLimitError'){
        const { default: toast } = await import('../ui/toast.js');
        toast('Free plan allows 1 project. Upgrade to save more.');
        this.bus.emit('license:limit');
        return;
      }
      // not signed in → prompt sign-in rather than throwing
      if (err?.name === 'NotSignedInError'){
        const { default: toast } = await import('../ui/toast.js');
        toast('Sign in to create a project.');
        this.bus.emit('auth:prompt');
        return;
      }
      throw err;
    }
    this.current = entry;
    this.om.clear();
    this.cam.reset();
    this.om.add('box');
    this.om.select(null);
    this.settings.setProjectOverride(null);
    this.settings.setProjectLighting(null);   // default: both lights on
    this.timeline?.fromJSON(null);
    this.palette?.fromJSON(null);
    this.anchors?.fromJSON(null);
    this.penDepth = 0;
    this.bus.emit('pen:setDepth', 0);
    this.bus.emit('history:reset');
    this.#setName(entry.name);
    this.lobby.hide();
    await this.saveCurrent();
  }
  async open(entry){
    this.current = entry;
    const data = await this.store.loadProject(entry.id);
    let doc = null;
    if (data){ try { doc = JSON.parse(data); } catch { doc = null; } }
    if (doc){
      try { SceneStore.apply(doc, this.om, this.cam); }
      catch { this.om.clear(); this.cam.reset(); toast('Could not read project data'); }
    } else {
      this.om.clear();
      this.cam.reset();
      if (data) toast('Could not read project data');
    }
    this.settings.setProjectOverride(doc?.theme ?? null);
    this.settings.setProjectLighting(doc?.lighting ?? null);
    this.timeline?.fromJSON(doc?.animation ?? null);
    this.palette?.fromJSON(doc?.textures ?? null);
    this.anchors?.fromJSON(doc?.anchors ?? null);
    this.penDepth = doc?.penDepth ?? 0;
    this.bus.emit('pen:setDepth', this.penDepth);
    this.bus.emit('history:reset');
    this.#setName(entry.name);
    this.lobby.hide();
  }
  async saveCurrent(){
    if (!this.current) return;
    const json = SceneStore.serialize(this.om, this.cam,
      { theme: this.settings.override ?? undefined,
        lighting: this.settings.lighting,
        animation: this.timeline?.toJSON(),
        textures: this.palette?.toJSON(),
        anchors: this.anchors?.toJSON(),
        penDepth: this.penDepth || undefined });
    await this.store.saveProject(this.current.id, json, this.#thumbnail());
    // mirror to the linked folder as a real .json file
    if (this.folder?.linked){
      try { await this.folder.write(this.current.name, json); }
      catch { /* permission lost or write failed; IndexedDB copy still saved */ }
    }
  }
  async exitToLobby(){
    if (this.current) await this.saveCurrent();
    this.current = null;
    this.settings.setProjectOverride(null);
    this.#setName('');
    this.lobby.show();
  }
  // File ▾ → Project theme… (settings modal in project-override mode)
  openThemeSettings(){
    if (!this.current) return;
    this.settings.openProject(() => this.saveCurrent());
  }
  // Capture a small jpeg of the live viewport for the lobby card.
  #thumbnail(){
    try {
      const src = this.sm.renderer.domElement;
      this.sm.renderer.render(this.sm.scene, this.sm.camera);
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = Math.max(1, Math.round(240 * src.height / src.width)) || 150;
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72);
    } catch { return null; }
  }
  #setName(n){ this.nameEl.textContent = n; }
}
