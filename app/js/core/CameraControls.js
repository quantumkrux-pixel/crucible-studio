/* global THREE */
// Pure orbit / pan / zoom math. No DOM listeners here —
// InteractionManager feeds it deltas, keeping input routing in one place.
export default class CameraControls {
  constructor(camera){
    this.camera = camera;
    this.target = new THREE.Vector3(0, 0.8, 0);
    this.theta = Math.PI/4; this.phi = Math.PI/3.1;
    this.radius = 10; this.minR = 2; this.maxR = 45;
    this.apply();
  }
  reset(){
    this.target.set(0, 0.8, 0);
    this.theta = Math.PI/4; this.phi = Math.PI/3.1;
    this.radius = 10;
    this.apply();
  }
  orbit(dx, dy){ this.theta -= dx * 0.0055; this.phi -= dy * 0.0055; this.apply(); }
  zoom(factor){ this.radius *= factor; this.apply(); }
  pan(dx, dy){
    const f = this.radius * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up    = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * f);
    this.target.addScaledVector(up,     dy * f);
    this.apply();
  }
  apply(){
    this.phi = Math.max(0.08, Math.min(Math.PI - 0.08, this.phi));
    this.radius = Math.max(this.minR, Math.min(this.maxR, this.radius));
    this.camera.position.set(
      this.target.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta));
    this.camera.lookAt(this.target);
  }
}
