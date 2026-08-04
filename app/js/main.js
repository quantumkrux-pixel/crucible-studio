// ============================================================
// CRUCIBLE3D — composition root
// Wires all components together. See README.md for the
// architecture overview and extension guide.
// ============================================================
import EventBus from './core/EventBus.js';
import SceneManager from './core/SceneManager.js';
import CameraControls from './core/CameraControls.js';
import ObjectManager from './core/ObjectManager.js';
import AnchorManager from './core/AnchorManager.js';
import ToolManager from './core/ToolManager.js';
import InteractionManager from './core/InteractionManager.js';
import HistoryManager from './core/HistoryManager.js';
import Timeline from './core/Timeline.js';
import OnionSkin from './tools/OnionSkin.js';
import MoveTool from './tools/MoveTool.js';
import { makeRotateTool } from './tools/RotateTool.js';
import ScaleTool from './tools/ScaleTool.js';
import VertexEditor from './tools/VertexEditor.js';
import makeDeformTool from './tools/DeformTool.js';
import FaceEditor from './tools/FaceEditor.js';
import makeFaceTool from './tools/FaceTool.js';
import makeSliceTool from './tools/SliceTool.js';
import makePenTool from './tools/PenTool.js';
import { makeMirrorAction, makeFlipAction, makeCloneAction } from './tools/ObjectActions.js';
import { makeMultiTool, makeMergeAction } from './tools/SelectionTools.js';
import makeHollowAction from './tools/HollowTool.js';
import PropertiesPanel from './ui/PropertiesPanel.js';
import UIManager from './ui/UIManager.js';
import FileMenu from './ui/FileMenu.js';
import LayoutManager from './ui/LayoutManager.js';
import SettingsPanel from './ui/SettingsPanel.js';
import TimelinePanel from './ui/TimelinePanel.js';
import PreviewHUD from './ui/PreviewHUD.js';
import ProjectStore from './io/ProjectStore.js';
import TexturePalette from './io/TexturePalette.js';
import PaintStudio from './ui/PaintStudio.js';
import SupabaseProjectStore from './io/SupabaseProjectStore.js';
import FolderStore, { isSupported as folderSupported } from './io/FolderStore.js';
import ProjectManager from './core/ProjectManager.js';
import { isConfigured as backendConfigured } from './auth/supabaseClient.js';
import LicenseManager from './auth/LicenseManager.js';
import AuthPanel from './auth/AuthPanel.js';
import { PRIMITIVES } from './config/primitives.js';

class App {
  constructor(){
    const bus = this.bus = new EventBus();
    const sm  = this.scene   = new SceneManager(document.getElementById('viewport'));
    const cam = this.camera  = new CameraControls(sm.camera);
    const om  = this.objects = new ObjectManager(bus, sm);
    const tm  = this.tools   = new ToolManager(bus);

    // ---- registries: extend the app here ----
    PRIMITIVES.forEach(p => om.registerPrimitive(p.id, p));
    tm.registerTool('pen', makePenTool(bus, sm, om, cam));
    tm.registerTool('move', MoveTool);
    tm.registerTool('rotate', makeRotateTool(bus, sm, om));
    tm.registerTool('scale', ScaleTool);
    this.vertexEditor = new VertexEditor(bus, sm, om, tm);
    tm.registerTool('deform', makeDeformTool(this.vertexEditor));
    this.faceEditor = new FaceEditor(bus, sm, om, tm);
    tm.registerTool('face', makeFaceTool(this.faceEditor));
    tm.registerTool('slice', makeSliceTool(om));
    tm.registerTool('mirror', makeMirrorAction(om));
    tm.registerTool('flip-h', makeFlipAction(om, 'x'));
    tm.registerTool('flip-v', makeFlipAction(om, 'y'));
    tm.registerTool('clone', makeCloneAction(om));
    tm.registerTool('multi', makeMultiTool());
    tm.registerTool('merge', makeMergeAction(om));
    tm.registerTool('hollow', makeHollowAction(om));

    // ---- wire components ----
    this.interaction = new InteractionManager(bus, sm, cam, om, tm);
    // anchor system: bind objects to points on other objects
    this.anchors = new AnchorManager(bus, om);
    sm.addRenderHook(() => this.anchors.enforce(sm.camera));
    bus.on('anchor:bind', ({ a, b }) => {
      this.anchors.bind(a, b);
      this.projects?.saveCurrent?.();
      import('./ui/toast.js').then(({ default: toast }) => toast(`Anchored to ${b.userData.name || 'object'}`));
    });
    bus.on('anchor:cancel', () => {
      import('./ui/toast.js').then(({ default: toast }) => toast('Anchor cancelled'));
    });
    // drop bindings whose objects no longer exist (after deletes/merges)
    bus.on('objects:changed', () => this.anchors.pruneMissing());
    this.palette = new TexturePalette(bus);
    this.paintStudio = new PaintStudio(dataURL => {
      this.palette.add(dataURL);
      this.projects?.saveCurrent?.();     // persist the new texture immediately
    });
    this.props = new PropertiesPanel(bus, om,
      [document.getElementById('props-body'), document.getElementById('sheet-props-body')],
      { palette: this.palette, paintStudio: this.paintStudio, anchors: this.anchors });
    bus.on('anchors:changed', () => { if (om.selected) this.props.render(); });
    this.ui = new UIManager(bus, om, tm, [
      { id:'mesh', label:'Mesh', tools:['deform','face','slice'] },
      { id:'more', label:'More Tools…', short:'More…', tools:['mirror','flip-h','flip-v','clone','merge','hollow'] }
    ]);
    this.layout = new LayoutManager(bus, sm);
    this.history = new HistoryManager(bus, om);
    this.settings = new SettingsPanel(sm);
    this.timeline = new Timeline(bus, om);
    this.onionSkin = new OnionSkin(bus, sm, om, this.timeline);
    this.timelinePanel = new TimelinePanel(bus, this.timeline, this.onionSkin);
    this.previewHud = new PreviewHUD(sm, om);

    // ---- auth / licensing ----
    // When the Supabase backend is configured, projects live in the
    // cloud (synced, RLS-gated). Otherwise the app runs fully local on
    // IndexedDB — no login, no limits — which is also how the paid
    // offline build behaves.
    this.license = new LicenseManager(bus);
    this.authPanel = new AuthPanel(bus, this.license);
    const store = backendConfigured() ? new SupabaseProjectStore() : new ProjectStore();

    // ---- projects ----
    const folder = folderSupported() ? new FolderStore() : null;
    if (folder) folder.tryRestore().catch(() => {});
    this.projects = new ProjectManager(bus, sm, cam, om, store, this.settings, folder, this.timeline, this.palette, this.anchors);
    this.fileMenu = new FileMenu(bus, om, cam, this.projects, this.license);

    // ---- boot ----
    sm.resize();
    sm.start();
    this.license.init();                         // async; updates UI when ready
    this.projects.showLobby();
  }
}
new App();
