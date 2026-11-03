import * as THREE from 'three';
import { FIELD } from './config';

const dark = new THREE.MeshStandardMaterial({ color: 0x101b29, roughness: 0.65, metalness: 0.35 });
const line = new THREE.MeshBasicMaterial({ color: 0x9bd8e7 });

function box(group: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function tube(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), FIELD.visual.tubeSegments), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  group.add(mesh);
}

export function createArena() {
  const group = new THREE.Group();
  const visual = FIELD.visual;
  box(group, visual.base.width, visual.base.height, visual.base.depth, 0, visual.base.y, 0, dark);
  const floor = new THREE.MeshStandardMaterial({ color: 0x3b6c4a, metalness: 0.05, roughness: 0.9 });
  box(group, visual.floor.width, visual.floor.height, visual.floor.depth, 0, 0, 0, floor);
  const stripe = new THREE.MeshStandardMaterial({ color: 0x477a52, roughness: 0.95 });
  for (let x = visual.stripes.startX; x <= visual.stripes.endX; x += visual.stripes.stepX) {
    box(group, visual.stripes.width, visual.stripes.height, visual.stripes.depth, x, visual.stripes.y, 0, stripe);
  }

  const markings = visual.markings;
  box(group, markings.center.width, markings.center.height, markings.center.depth, 0, markings.center.y, 0, line);
  for (const z of [-markings.sidelines.zOffset, markings.sidelines.zOffset]) {
    box(group, markings.sidelines.width, markings.sidelines.height, markings.sidelines.thickness, 0, markings.sidelines.y, z, line);
  }
  for (const x of [-markings.ends.xOffset, markings.ends.xOffset]) {
    box(group, markings.ends.width, markings.ends.height, markings.ends.depth, x, markings.ends.y, 0, line);
  }
  const circle = new THREE.Mesh(new THREE.RingGeometry(markings.centerCircle.innerRadius, markings.centerCircle.outerRadius, markings.centerCircle.segments), line);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = markings.centerCircle.y;
  group.add(circle);

  const goalMarks = markings.goalArea;
  for (const side of [-1, 1]) {
    for (const z of [-goalMarks.zOffset, goalMarks.zOffset]) {
      box(group, goalMarks.width, goalMarks.height, goalMarks.thickness, side * goalMarks.xOffset, goalMarks.y, z, line);
    }
    box(group, goalMarks.thickness, goalMarks.height, goalMarks.depth, side * goalMarks.crossXOffset, goalMarks.y, 0, line);
  }

  const goal = FIELD.visual.goalFrame;
  for (const side of [-1, 1]) {
    const postX = side * (FIELD.goalLineX / FIELD.scaleX);
    const backX = side * (FIELD.goalBackX / FIELD.scaleX);
    const halfWidth = FIELD.goalHalfWidth / FIELD.scaleZ;
    const glow = new THREE.MeshBasicMaterial({ color: side < 0 ? 0xe2604d : 0x69b7df });
    for (const z of [-halfWidth, halfWidth]) {
      tube(group, new THREE.Vector3(postX, goal.footY, z), new THREE.Vector3(postX, FIELD.goalHeight, z), goal.postRadius, glow);
    }
    tube(group, new THREE.Vector3(postX, FIELD.goalHeight, -halfWidth), new THREE.Vector3(postX, FIELD.goalHeight, halfWidth), goal.postRadius, glow);
    const net = new THREE.MeshBasicMaterial({ color: side < 0 ? 0xd38476 : 0x87b9c7, transparent: true, opacity: 0.6 });
    for (let z = -halfWidth; z <= halfWidth + goal.netMargin; z += goal.netStep) {
      tube(group, new THREE.Vector3(backX, goal.footY, z), new THREE.Vector3(backX, FIELD.goalHeight, z), goal.netRadius, net);
    }
    for (let y = goal.footY; y <= FIELD.goalHeight + goal.netMargin; y += goal.netStep) {
      tube(group, new THREE.Vector3(backX, y, -halfWidth), new THREE.Vector3(backX, y, halfWidth), goal.netRadius, net);
    }
    for (const z of [-halfWidth, halfWidth]) {
      tube(group, new THREE.Vector3(postX, FIELD.goalHeight, z), new THREE.Vector3(backX, FIELD.goalHeight, z), goal.braceRadius, net);
      tube(group, new THREE.Vector3(backX, goal.footY, z), new THREE.Vector3(backX, FIELD.goalHeight, z), goal.braceRadius, net);
    }
  }

  const wall = new THREE.MeshStandardMaterial({ color: 0x2b5469, transparent: true, opacity: 0.35, metalness: 0.5, roughness: 0.3 });
  const neon = new THREE.MeshBasicMaterial({ color: 0x23ccff });
  const walls = visual.walls;
  for (const z of [-walls.sideZ, walls.sideZ]) {
    box(group, walls.width, walls.height, walls.depth, 0, walls.y, z, wall);
    box(group, walls.neonWidth, walls.neonHeight, walls.neonDepth, 0, walls.neonY, z, neon);
  }
  for (const x of [-walls.supportX, walls.supportX]) {
    for (const z of [-walls.supportZ, walls.supportZ]) {
      box(group, walls.supportWidth, walls.supportHeight, walls.supportDepth, x, walls.y, z, wall);
    }
  }

  const stands = visual.stands;
  for (const side of [stands.side]) for (let row = 0; row < stands.rows; row++) {
    const z = side * (stands.z + row * stands.rowZStep);
    box(group, stands.width, visual.base.height, stands.depth, 0, stands.y + row * stands.rowYStep, z, dark);
    for (let x = stands.seatStartX; x <= stands.seatEndX; x += stands.seatStepX) {
      const seatColor = (Math.round(x * stands.seatColorMultiplier + row) % stands.seatColorCycle === 0) ? 0xffbd38 : 0x4584a3;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(stands.seatWidth, stands.seatHeight, stands.seatDepth), new THREE.MeshBasicMaterial({ color: seatColor }));
      seat.position.set(x, stands.seatY + row * stands.rowYStep, z);
      group.add(seat);
    }
  }
  return group;
}
