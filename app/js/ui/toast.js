// Tiny transient notification pill.
let timer;
export default function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('show'), 2200);
}
