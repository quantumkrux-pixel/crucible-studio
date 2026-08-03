// Desktop ⇄ mobile switching. CSS does the heavy lifting via the
// body.mobile class; this just decides when and notifies the bus.
// Emits: 'layout:changed' ('mobile' | 'desktop').
export default class LayoutManager {
  constructor(bus, sceneManager){
    this.bus = bus; this.sm = sceneManager;
    window.addEventListener('resize', () => this.apply());
    matchMedia('(pointer:coarse)').addEventListener?.('change', () => this.apply());
    this.apply();
  }
  isMobile(){
    return window.innerWidth < 768 ||
      (matchMedia('(pointer:coarse)').matches && window.innerWidth <= 1024);
  }
  apply(){
    const mobile = this.isMobile();
    const changed = document.body.classList.contains('mobile') !== mobile;
    document.body.classList.toggle('mobile', mobile);
    this.sm.resize();
    if (changed) this.bus.emit('layout:changed', mobile ? 'mobile' : 'desktop');
  }
}
