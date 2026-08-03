// Transform-tool registry. Tools are plain objects:
//   { label, icon, key, hint(state),
//     begin(x, y, ctx), update(x, y, sx, sy, ctx),
//     claim?(x, y, ctx),   // optional: custom hit test (see DeformTool)
//     end?(ctx) }          // optional: drag-finished hook
// Emits: 'tool:changed' (active id | null).
export default class ToolManager {
  constructor(bus){
    this.bus = bus;
    this.tools = new Map();
    this.active = null;
    this.state = { lift:false };
  }
  registerTool(id, def){ this.tools.set(id, def); }
  setActive(id){
    const def = this.tools.get(id);
    if (def?.instant){          // one-shot action: run, don't become modal
      def.run();
      this.bus.emit('tool:changed', this.active);
      return;
    }
    this.active = this.active === id ? null : id;
    if (this.active !== 'move') this.state.lift = false;
    this.bus.emit('tool:changed', this.active);
  }
  toggleLift(){ this.state.lift = !this.state.lift; this.bus.emit('tool:changed', this.active); }
  get activeTool(){ return this.tools.get(this.active) ?? null; }
}
