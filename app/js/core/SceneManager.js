/* global THREE */
// Owns the renderer, scene graph scaffolding (lights, grid, ground,
// axis stubs), the camera object, and the render loop.
export default class SceneManager {
  constructor(container){
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias:true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14161A);
    this.scene.fog = new THREE.Fog(0x14161A, 30, 70);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this.renderHooks = [];   // run after the main render each frame

    this.#lights(); this.#floor(); this.#axes();
  }
  addRenderHook(fn){ this.renderHooks.push(fn); }
  #lights(){
    // Fill light (ambient sky/ground bounce) and a key "sun" that casts
    // shadows. Both are toggleable per project via setLighting().
    this.fill = new THREE.HemisphereLight(0x9db4d4, 0x1c1a18, 0.55);
    this.scene.add(this.fill);
    this.sun = new THREE.DirectionalLight(0xfff2e0, 1.05);
    this.sun.position.set(6, 12, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -15;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 15;
    this.scene.add(this.sun);
    // remember full-strength intensities so toggles restore them
    this._sunIntensity = this.sun.intensity;
    this._fillIntensity = this.fill.intensity;
    this._lighting = { sun:true, fill:true };
  }
  // Toggle individual light sources. state = { sun?:bool, fill?:bool }.
  setLighting(state = {}){
    if ('sun' in state){
      this._lighting.sun = !!state.sun;
      this.sun.visible = this._lighting.sun;
    }
    if ('fill' in state){
      this._lighting.fill = !!state.fill;
      this.fill.visible = this._lighting.fill;
    }
  }
  getLighting(){ return { ...this._lighting }; }
  #floor(){
    this.grid = new THREE.GridHelper(40, 40, 0x3a4150, 0x252a33);
    this.grid.position.y = -0.001;
    this.scene.add(this.grid);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
      new THREE.ShadowMaterial({ opacity:0.35 }));
    ground.rotation.x = -Math.PI/2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }
  #axes(){
    // 3D vernacular: X red / Y green / Z blue
    const line = (dir, color) => new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.multiplyScalar(1.4)]),
      new THREE.LineBasicMaterial({ color }));
    this.scene.add(line(new THREE.Vector3(1,0,0), 0xFF5470));
    this.scene.add(line(new THREE.Vector3(0,1,0), 0x7BE07B));
    this.scene.add(line(new THREE.Vector3(0,0,1), 0x4DA6FF));
  }
  // Apply a scene theme: { bg, gridMajor, gridMinor } (hex numbers).
  // GridHelper bakes its colors at construction, so the grid is rebuilt.
  setTheme({ bg, gridMajor, gridMinor }){
    this.scene.background.setHex(bg);
    if (this.scene.fog) this.scene.fog.color.setHex(bg);
    if (this.grid){
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
    }
    this.grid = new THREE.GridHelper(40, 40, gridMajor, gridMinor);
    this.grid.position.y = -0.001;
    if (this._gridVisible === false) this.grid.visible = false;
    this.scene.add(this.grid);
  }
  setGridVisible(v){ if (this.grid) this.grid.visible = v; this._gridVisible = v; }
  resize(){
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  start(){
    const loop = () => {
      requestAnimationFrame(loop);
      this.renderer.render(this.scene, this.camera);
      for (const fn of this.renderHooks) fn();
    };
    loop();
  }
}
