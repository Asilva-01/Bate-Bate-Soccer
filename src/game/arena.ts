import * as THREE from 'three';

const dark = new THREE.MeshStandardMaterial({ color: 0x101b29, roughness: 0.65, metalness: 0.35 });
const line = new THREE.MeshBasicMaterial({ color: 0x9bd8e7 });
function box(group: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); group.add(mesh); return mesh;
}
function tube(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) {
  const direction = new THREE.Vector3().subVectors(b, a); const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material); mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); group.add(mesh);
}
export function createArena() {
  const group = new THREE.Group();
  box(group, 30, 0.5, 18, 0, -0.3, 0, dark);
  const floor = new THREE.MeshStandardMaterial({ color: 0x1c3944, metalness: 0.42, roughness: 0.48 });
  box(group, 28, 0.1, 16, 0, 0, 0, floor);
  // Court markings are thin raised geometry, visible from any camera angle.
  box(group, 0.09, 0.015, 15.6, 0, 0.06, 0, line);
  for (const z of [-7.7, 7.7]) box(group, 27.5, 0.015, 0.08, 0, 0.06, z, line);
  for (const x of [-13.7, 13.7]) box(group, 0.08, 0.015, 15.4, x, 0.06, 0, line);
  const circle = new THREE.Mesh(new THREE.RingGeometry(2.25, 2.32, 64), line); circle.rotation.x = -Math.PI / 2; circle.position.y = 0.065; group.add(circle);
  for (const side of [-1, 1]) {
    box(group, 3.2, 0.015, 0.08, side * 12.1, 0.06, -3.7, line); box(group, 3.2, 0.015, 0.08, side * 12.1, 0.06, 3.7, line); box(group, 0.08, 0.015, 7.4, side * 10.5, 0.06, 0, line);
    const glow = new THREE.MeshBasicMaterial({ color: side < 0 ? 0x1bd9ff : 0xff4767 });
    for (const z of [-3, 3]) tube(group, new THREE.Vector3(side * 13.7, 0.1, z), new THREE.Vector3(side * 13.7, 3.5, z), 0.09, glow);
    tube(group, new THREE.Vector3(side * 13.7, 3.5, -3), new THREE.Vector3(side * 13.7, 3.5, 3), 0.09, glow);
    const net = new THREE.MeshBasicMaterial({ color: side < 0 ? 0x39b4d1 : 0xd75c7a, transparent: true, opacity: 0.6 });
    for (let z = -3; z <= 3.01; z += 0.5) tube(group, new THREE.Vector3(side * 14.7, 0.1, z), new THREE.Vector3(side * 14.7, 3.5, z), 0.012, net);
    for (let y = 0.1; y <= 3.6; y += 0.5) tube(group, new THREE.Vector3(side * 14.7, y, -3), new THREE.Vector3(side * 14.7, y, 3), 0.012, net);
    for (const z of [-3, 3]) { tube(group, new THREE.Vector3(side * 13.7, 3.5, z), new THREE.Vector3(side * 14.7, 3.5, z), 0.035, net); tube(group, new THREE.Vector3(side * 14.7, 0.1, z), new THREE.Vector3(side * 14.7, 3.5, z), 0.035, net); }
  }
  const wall = new THREE.MeshStandardMaterial({ color: 0x2b5469, transparent: true, opacity: 0.35, metalness: 0.5, roughness: 0.3 });
  const neon = new THREE.MeshBasicMaterial({ color: 0x23ccff });
  for (const z of [-8.2, 8.2]) { box(group, 28, 1.1, 0.18, 0, 0.65, z, wall); box(group, 28, 0.09, 0.2, 0, 1.25, z, neon); }
  for (const x of [-14.1, 14.1]) for (const z of [-5.65, 5.65]) box(group, 0.2, 1.1, 5, x, 0.65, z, wall);
  // Layered stadium seating and colored lamps.
  // Keep the near side clear so the fixed camera can see the whole pitch.
  for (const z of [-1]) for (let i = 0; i < 4; i++) {
    box(group, 30, 0.5, 1.4, 0, 0.15 + i * 0.65, z * (9.1 + i * 1.1), dark);
    for (let x = -13; x <= 13; x += 1.2) box(group, 0.14, 0.16, 0.1, x, 0.5 + i * 0.65, z * (9.1 + i * 1.1), new THREE.MeshBasicMaterial({ color: (Math.round(x * 10 + i) % 3 === 0) ? 0xffbd38 : 0x4584a3 }));
  }
  return group;
}
