// Face push/pull. claim() grabs any drag starting on the selected
// object's surface, resolves the logical face under the pointer, and
// the drag slides that face along its own normal — e.g. pull one side
// of a cube to stretch it into a rectangular beam.
export default function makeFaceTool(faceEditor){
  return {
    label:'Face', key:'f',
    icon:'<path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z"/><path d="M4 7.5v9L12 21l8-4.5v-9"/><path d="M12 12v9"/><path d="M12 7.5v-3"/>',
    hint: () => 'drag a face to push / pull it along its normal',
    claim(x, y, ctx){
      const hit = faceEditor.pickFace(ctx.raycasterAt(x, y), ctx.object);
      if (!hit) return false;
      ctx.faceHit = hit;
      return true;
    },
    begin(x, y, ctx){
      faceEditor.beginDrag(ctx.object, ctx.faceHit, ctx.raycasterAt(x, y));
    },
    update(x, y, sx, sy, ctx){
      const s = faceEditor.axisParam(ctx.raycasterAt(x, y));
      if (s === null || !faceEditor.session) return;
      faceEditor.dragTo(s - faceEditor.session.s0);
    },
    end(){ faceEditor.endDrag(); }
  };
}
