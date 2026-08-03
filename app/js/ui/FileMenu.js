import SceneStore from '../io/SceneStore.js';
import Exporters from '../io/Exporters.js';
import toast from './toast.js';
import { kvGet, kvSet } from '../io/kvStore.js';

// File ▾ dropdown: project / new / save / open / quick save-load /
// export. Quick save persists through the shared kvStore adapter, so
// it works in artifact hosts (window.storage) and normal browsers
// (IndexedDB) alike.
const QUICKSAVE_KEY = 'scene:quicksave';

export default class FileMenu {
  // Server-verified export gate. Returns true if allowed; otherwise
  // nudges the user to sign in / upgrade. Real enforcement is the Edge
  // Function — this just avoids generating a file the server won't bless.
  async #gateExport(){
    if (!this.license) return true;                 // backend not wired: allow
    const ok = await this.license.authorizeExport();
    if (!ok){
      if (!this.license.signedIn) toast('Sign in and upgrade to export');
      else toast('Exporting requires the full version ($10). See Account → Upgrade.');
    }
    return ok;
  }

  constructor(bus, objectManager, cameraControls, projectManager = null, license = null){
    this.bus = bus; this.om = objectManager; this.cam = cameraControls;
    this.pm = projectManager; this.license = license;
    this.menu = document.getElementById('file-menu');
    this.btn = document.getElementById('btn-file');
    this.fileInput = document.getElementById('scene-file-input');
    this.confirmingNew = false;
    this.#build();
    this.btn.addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    window.addEventListener('click', e => { if (!this.menu.contains(e.target)) this.close(); });
    this.fileInput.addEventListener('change', () => this.#openFile());
  }
  #build(){
    const label = t => { const d = document.createElement('div'); d.className = 'menu-label'; d.textContent = t; this.menu.appendChild(d); };
    const sep = () => { const d = document.createElement('div'); d.className = 'menu-sep'; this.menu.appendChild(d); };
    const item = (text, fn, cls='') => {
      const b = document.createElement('button');
      b.className = 'menu-item ' + cls;
      b.textContent = text;
      b.addEventListener('click', e => { e.stopPropagation(); fn(b); });
      this.menu.appendChild(b);
      return b;
    };
    if (this.pm){
      label('Project');
      item('Save project', async () => {
        this.close();
        await this.pm.saveCurrent();
        toast('Project saved');
      });
      item('Scene & lighting…', () => { this.close(); this.pm.openThemeSettings(); });
      item('All projects…', () => { this.close(); this.pm.exitToLobby(); });
      sep();
    }
    label('Scene');
    this.newBtn = item('New scene', b => {
      if (!this.confirmingNew){
        this.confirmingNew = true;
        b.textContent = 'Tap again to clear all';
        b.classList.add('danger');
        return;
      }
      this.om.clear();
      this.close();
      toast('Scene cleared');
    });
    item('Save scene file', () => { SceneStore.download(this.om, this.cam); this.close(); toast('Scene file saved'); });
    item('Open scene file…', () => { this.fileInput.value = ''; this.fileInput.click(); this.close(); });
    item('Quick save', async () => {
      this.close();
      const ok = await kvSet(QUICKSAVE_KEY, SceneStore.serialize(this.om, this.cam));
      toast(ok ? 'Quick saved' : 'Quick save failed');
    });
    item('Quick load', async () => {
      this.close();
      try {
        const v = await kvGet(QUICKSAVE_KEY);
        if (v){
          const n = SceneStore.apply(v, this.om, this.cam);
          toast(`Loaded ${n} object${n === 1 ? '' : 's'}`);
        } else toast('No quick save yet');
      } catch { toast('No quick save yet'); }
    });
    sep();
    this.exportOpen = false;
    this.expBtn = item('Export ▸', () => this.#toggleExport());
    this.exportSub = document.createElement('div');
    this.exportSub.className = 'menu-sub';
    for (const [id, def] of Exporters.formats){
      const b = document.createElement('button');
      b.className = 'menu-item';
      b.textContent = def.label;
      b.addEventListener('click', async e => {
        e.stopPropagation();
        this.close();
        if (!this.om.objects.length){ toast('Nothing to export'); return; }
        if (!(await this.#gateExport())) return;
        Exporters.run(id, this.om.objects);
        toast(`Exported ${def.label}`);
      });
      this.exportSub.appendChild(b);
    }
    // animated exports — only meaningful with 2+ timeline frames
    this.animGlbBtn = document.createElement('button');
    this.animGlbBtn.className = 'menu-item';
    this.animGlbBtn.textContent = 'Animated .glb';
    this.animGlbBtn.addEventListener('click', async e => {
      e.stopPropagation(); this.close();
      const tl = this.pm?.timeline;
      const clipsWithFrames = tl?.clips ? tl.clips.filter(c => c.frames.length >= 2) : [];
      const ok = clipsWithFrames.length > 0 || (tl && tl.count >= 2);
      if (!ok){ toast('Capture 2+ animation frames first'); return; }
      if (!(await this.#gateExport())) return;
      try {
        const { exportAnimatedGLB } = await import('../io/AnimationExporter.js');
        exportAnimatedGLB(this.om.objects, tl);
        const n = clipsWithFrames.length || 1;
        toast(n > 1 ? `Exported .glb with ${n} animations` : 'Exported animated .glb');
      } catch (err){ toast('Animated export failed'); }
    });
    this.exportSub.appendChild(this.animGlbBtn);

    this.animGifBtn = document.createElement('button');
    this.animGifBtn.className = 'menu-item';
    this.animGifBtn.textContent = 'Animated .gif';
    this.animGifBtn.addEventListener('click', async e => {
      e.stopPropagation(); this.close();
      const tl = this.pm?.timeline;
      if (!tl || tl.count < 2){ toast('Capture 2+ animation frames first'); return; }
      toast('Rendering GIF…');
      try {
        const { exportAnimatedGIF } = await import('../io/AnimationExporter.js');
        await exportAnimatedGIF(this.pm.sm, tl);
        toast('Exported animated .gif');
      } catch (err){ toast('GIF export failed'); }
    });
    this.exportSub.appendChild(this.animGifBtn);
    this.menu.appendChild(this.exportSub);
  }
  #toggleExport(){
    this.exportOpen = !this.exportOpen;
    this.exportSub.classList.toggle('open', this.exportOpen);
    this.expBtn.textContent = this.exportOpen ? 'Export ▾' : 'Export ▸';
  }
  #collapseExport(){
    this.exportOpen = false;
    this.exportSub?.classList.remove('open');
    if (this.expBtn) this.expBtn.textContent = 'Export ▸';
  }
  #openFile(){
    const f = this.fileInput.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const n = SceneStore.apply(r.result, this.om, this.cam);
        toast(`Loaded ${n} object${n === 1 ? '' : 's'}`);
      } catch { toast('Could not read that file'); }
    };
    r.readAsText(f);
  }
  #resetNew(){
    this.confirmingNew = false;
    this.newBtn.textContent = 'New scene';
    this.newBtn.classList.remove('danger');
  }
  toggle(){ this.menu.classList.contains('open') ? this.close() : this.menu.classList.add('open'); }
  close(){ this.menu.classList.remove('open'); this.#resetNew(); this.#collapseExport(); }
}
