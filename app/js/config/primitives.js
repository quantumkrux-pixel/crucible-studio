/* global THREE */
// Built-in primitives. Add an entry here and it appears automatically
// in the desktop rail, the mobile Add sheet, and scene save/load.
import { headGeometry } from './headGeometry.js';

export const PRIMITIVES = [
  { id:'box',      label:'Cube',
    icon:'<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    create:() => new THREE.BoxGeometry(1.4, 1.4, 1.4) },
  { id:'sphere',   label:'Sphere',
    icon:'<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.4"/>',
    create:() => new THREE.SphereGeometry(0.85, 32, 24) },
  { id:'cylinder', label:'Cylinder',
    icon:'<ellipse cx="12" cy="5.5" rx="6.5" ry="2.6"/><path d="M5.5 5.5v13c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6v-13"/>',
    create:() => new THREE.CylinderGeometry(0.7, 0.7, 1.5, 32) },
  { id:'cone',     label:'Cone',
    icon:'<path d="M12 3L5.5 18.5"/><path d="M12 3l6.5 15.5"/><ellipse cx="12" cy="18.5" rx="6.5" ry="2.5"/>',
    create:() => new THREE.ConeGeometry(0.8, 1.6, 32) },
  { id:'pyramid',  label:'Pyramid',
    icon:'<path d="M12 3L3 19h18L12 3z"/><path d="M12 3v16M3 19l9-6 9 6"/>',
    create:() => new THREE.ConeGeometry(1, 1.5, 4) },   // 4-sided cone = square pyramid
  { id:'torus',    label:'Torus',
    icon:'<ellipse cx="12" cy="12" rx="8.5" ry="5.5"/><ellipse cx="12" cy="12" rx="3.5" ry="1.8"/>',
    create:() => new THREE.TorusGeometry(0.7, 0.28, 18, 40) },
  { id:'plane',    label:'Plane',
    icon:'<path d="M4 16l6-8h10l-6 8H4z"/>',
    create:() => new THREE.BoxGeometry(2, 0.06, 2) },
  { id:'head',     label:'Head',
    icon:'<path d="M8 3.5c-2.2 1-3.5 3.3-3.5 6 0 2 .7 3.2 1.4 4.2.5.7.6 1 .6 2V19a2 2 0 0 0 2 2h5"/><path d="M15.5 21c1.5-.6 2.2-1.8 2.2-3.3 0-.9.2-1.3.7-2 .8-1.1 1.6-2.4 1.6-4.7 0-4-2.8-6.7-6.5-6.7"/><circle cx="9.5" cy="10" r="1"/>',
    create:() => headGeometry() }
];
