// PaintStudio — a simple 1:1 square-canvas texture painter. Pick a base
// color, then paint layers on top with a small brush palette. Save exports
// the canvas to a data URL that goes into the in-project texture palette.
//
// Deliberately simple: base fill + freehand brush with size/color/softness,
// plus an eraser and undo. No layers panel — "layers" here just means you
// paint on top of the base. Output is a square PNG data URL.

const SIZE = 512;              // canvas resolution (square, 1:1)
const PRESET_COLORS = ['#E8452C','#F5A623','#F8E71C','#7ED321','#4A90E2',
  '#9013FE','#FFFFFF','#111417'];

export default class PaintStudio {
  constructor(onSave){
    this.onSave = onSave;       // (dataURL) => void
    this.brush = { color:'#E8452C', size:24, soft:false, erase:false };
    this.undoStack = [];
    this.#build();
  }

  open(baseColor = '#C9CFD8'){
    this.modal.style.display = 'flex';
    this.#fill(baseColor);
    this.baseInput.value = baseColor;
    this.undoStack = [];
    this.#pushUndo();
  }
  close(){ this.modal.style.display = 'none'; }

  #build(){
    const wrap = document.createElement('div');
    wrap.className = 'paint-modal';
    wrap.style.display = 'none';
    wrap.innerHTML = `
      <div class="paint-box">
        <div class="paint-head">
          <span class="paint-title">Paint a texture</span>
          <button class="paint-x" data-act="close">✕</button>
        </div>
        <div class="paint-body">
          <div class="paint-canvas-wrap">
            <canvas class="paint-canvas" width="${SIZE}" height="${SIZE}"></canvas>
          </div>
          <div class="paint-tools">
            <div class="paint-group">
              <label>Base fill</label>
              <div class="paint-base-row">
                <input type="color" class="paint-base" value="#C9CFD8">
                <button class="paint-btn" data-act="fill">Fill</button>
              </div>
            </div>
            <div class="paint-group">
              <label>Brush color</label>
              <div class="paint-swatches">
                ${PRESET_COLORS.map(c =>
                  `<button class="paint-sw" data-color="${c}" style="background:${c}"></button>`).join('')}
                <input type="color" class="paint-brush-color" value="#E8452C" title="Custom color">
              </div>
            </div>
            <div class="paint-group">
              <label>Brush size <span class="paint-size-val">24</span></label>
              <input type="range" class="paint-size" min="2" max="96" value="24">
            </div>
            <div class="paint-group paint-brush-types">
              <button class="paint-btn tog active" data-brush="hard">● Hard</button>
              <button class="paint-btn tog" data-brush="soft">◌ Soft</button>
              <button class="paint-btn tog" data-brush="erase">⌫ Erase</button>
            </div>
            <div class="paint-group">
              <button class="paint-btn" data-act="undo">↶ Undo</button>
              <button class="paint-btn" data-act="clear">Clear layer</button>
            </div>
            <div class="paint-actions">
              <button class="paint-btn ghost" data-act="close">Cancel</button>
              <button class="paint-btn primary" data-act="save">Save to palette</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    this.modal = wrap;
    this.canvas = wrap.querySelector('.paint-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.baseInput = wrap.querySelector('.paint-base');
    this.sizeVal = wrap.querySelector('.paint-size-val');
    this.#wire();
  }

  #wire(){
    const w = this.modal;
    // actions
    w.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'close') this.close();
      else if (act === 'fill'){ this.#pushUndo(); this.#fill(this.baseInput.value); }
      else if (act === 'undo') this.#undo();
      else if (act === 'clear'){ this.#pushUndo(); this.#fill(this.baseInput.value); }
      else if (act === 'save') this.#save();
    }));
    // swatches
    w.querySelectorAll('.paint-sw').forEach(s => s.addEventListener('click', () => {
      this.brush.color = s.dataset.color;
      w.querySelector('.paint-brush-color').value = s.dataset.color;
    }));
    w.querySelector('.paint-brush-color').addEventListener('input', e => this.brush.color = e.target.value);
    // size
    const size = w.querySelector('.paint-size');
    size.addEventListener('input', () => { this.brush.size = +size.value; this.sizeVal.textContent = size.value; });
    // brush type toggles
    w.querySelectorAll('[data-brush]').forEach(b => b.addEventListener('click', () => {
      w.querySelectorAll('[data-brush]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      this.brush.soft = b.dataset.brush === 'soft';
      this.brush.erase = b.dataset.brush === 'erase';
    }));
    // painting (pointer)
    let drawing = false, lastX = 0, lastY = 0;
    const toXY = e => {
      const r = this.canvas.getBoundingClientRect();
      return { x:(e.clientX - r.left) / r.width * SIZE, y:(e.clientY - r.top) / r.height * SIZE };
    };
    const down = e => { drawing = true; this.#pushUndo(); const p = toXY(e); lastX = p.x; lastY = p.y; this.#dot(p.x, p.y); this.canvas.setPointerCapture(e.pointerId); };
    const move = e => { if (!drawing) return; const p = toXY(e); this.#stroke(lastX, lastY, p.x, p.y); lastX = p.x; lastY = p.y; };
    const up = () => { drawing = false; };
    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointerleave', up);
  }

  #fill(color){
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, SIZE, SIZE);
  }
  #applyBrush(){
    const b = this.brush;
    this.ctx.globalCompositeOperation = b.erase ? 'destination-out' : 'source-over';
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = b.size;
    this.ctx.strokeStyle = b.color;
    this.ctx.fillStyle = b.color;
    if (b.soft && !b.erase){
      this.ctx.shadowBlur = b.size * 0.6;
      this.ctx.shadowColor = b.color;
    } else {
      this.ctx.shadowBlur = 0;
    }
  }
  #dot(x, y){
    this.#applyBrush();
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.brush.size / 2, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.shadowBlur = 0;
  }
  #stroke(x0, y0, x1, y1){
    this.#applyBrush();
    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;
  }

  // ---- undo (snapshot-based; capped so memory stays bounded) ----
  #pushUndo(){
    try {
      this.undoStack.push(this.ctx.getImageData(0, 0, SIZE, SIZE));
      if (this.undoStack.length > 15) this.undoStack.shift();
    } catch { /* ignore */ }
  }
  #undo(){
    if (this.undoStack.length < 2){ return; }
    this.undoStack.pop();                       // drop current
    const prev = this.undoStack[this.undoStack.length - 1];
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.putImageData(prev, 0, 0);
  }

  #save(){
    const dataURL = this.canvas.toDataURL('image/png');
    this.onSave?.(dataURL);
    this.close();
  }
}
