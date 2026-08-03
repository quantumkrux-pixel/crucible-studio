// Vertical drag → uniform scale (up grows, down shrinks).
export default {
  label:'Scale', key:'s',
  icon:'<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  hint: () => 'drag up / down on selected object to scale',
  begin(x, y, ctx){ ctx.startScale = ctx.object.scale.clone(); },
  update(x, y, sx, sy, ctx){
    const f = Math.max(0.05, 1 - (y - sy) * 0.006);
    ctx.object.scale.copy(ctx.startScale).multiplyScalar(f);
  }
};
