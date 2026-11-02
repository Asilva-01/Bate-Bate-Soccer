import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

const STEP = 1 / 60;
const CAR_HEIGHT = 0.4;
let initialization: Promise<void> | undefined;

export type DriveInput = { forward: boolean; reverse: boolean; left: boolean; right: boolean };

export async function createPhysics(ball: THREE.Group, cars: THREE.Group[], input: DriveInput) {
  initialization ??= RAPIER.init();
  await initialization;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const fixedBox = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRestitution(0.5));
  };
  fixedBox(0, -0.2, 0, 15, 0.25, 9);
  for (const z of [-8.2, 8.2]) fixedBox(0, 0.7, z, 14.2, 0.7, 0.1);
  // Close the ends during the physics phase; goal detection comes in phase 3.
  for (const x of [-14.1, 14.1]) fixedBox(x, 1.75, 0, 0.1, 1.75, 8.2);

  const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.96, 0).setCcdEnabled(true).setLinearDamping(0.2));
  const ballCollider = world.createCollider(RAPIER.ColliderDesc.ball(0.9).setMass(1).setRestitution(0.7).setFriction(0.5).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), ballBody);
  const events = new RAPIER.EventQueue(true);
  const carColliderHandles = new Set<number>();
  const carBodies = cars.map((car) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(car.position.x, CAR_HEIGHT, car.position.z).setCcdEnabled(true).setLinearDamping(1.8).setAngularDamping(3));
    body.setEnabledRotations(false, true, false, true);
    const collider = world.createCollider(RAPIER.ColliderDesc.cylinder(0.28, 1.2).setMass(4).setFriction(0.5).setRestitution(0.3), body);
    carColliderHandles.add(collider.handle);
    return body;
  });
  let heading = cars[0].rotation.y;
  const aiHeadings = cars.map((car) => car.rotation.y);
  const keys = new Set<string>();
  const accepted = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  const keydown = (event: KeyboardEvent) => {
    if (!accepted.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    keys.add(event.code);
  };
  const keyup = (event: KeyboardEvent) => { keys.delete(event.code); };
  const clearKeys = () => keys.clear();
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', clearKeys);
  let accumulator = 0;
  const sync = () => {
    const position = ballBody.translation();
    const rotation = ballBody.rotation();
    ball.position.set(position.x, position.y, position.z);
    ball.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    carBodies.forEach((body, index) => {
      const p = body.translation();
      const q = body.rotation();
      cars[index].position.set(p.x, p.y - CAR_HEIGHT, p.z);
      cars[index].quaternion.set(q.x, q.y, q.z, q.w);
    });
  };
  // Align the collision bodies with the cars' initial visual headings.
  carBodies.forEach((body, index) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cars[index].rotation.y);
    body.setRotation(q, true);
  });
  sync();
  return {
    update(delta: number, onBallHit: (position: THREE.Vector3, strength: number) => void) {
      accumulator += Math.min(delta, 0.1);
      while (accumulator >= STEP) {
        const forward = Number(input.forward || keys.has('KeyW') || keys.has('ArrowUp')) - Number(input.reverse || keys.has('KeyS') || keys.has('ArrowDown'));
        const turn = Number(input.left || keys.has('KeyA') || keys.has('ArrowLeft')) - Number(input.right || keys.has('KeyD') || keys.has('ArrowRight'));
        heading += turn * 3.2 * STEP * (forward < 0 ? -1 : 1);
        const car = carBodies[0];
        if (turn) car.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading), true);
        if (forward) car.applyImpulse({ x: -Math.sin(heading) * forward * 1.4, y: 0, z: -Math.cos(heading) * forward * 1.4 }, true);
        // Opponents steer towards the ball and keep a little space around it.
        const target = ballBody.translation();
        for (let index = 1; index < carBodies.length; index++) {
          const opponent = carBodies[index];
          const position = opponent.translation();
          const dx = target.x - position.x;
          const dz = target.z - position.z;
          const distance = Math.hypot(dx, dz);
          const desired = Math.atan2(-dx, -dz);
          const difference = Math.atan2(Math.sin(desired - aiHeadings[index]), Math.cos(desired - aiHeadings[index]));
          aiHeadings[index] += THREE.MathUtils.clamp(difference, -2 * STEP, 2 * STEP);
          opponent.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aiHeadings[index]), true);
          if (distance > 1.8 && Math.abs(difference) < 1.2) {
            opponent.applyImpulse({ x: -Math.sin(aiHeadings[index]) * 0.72, y: 0, z: -Math.cos(aiHeadings[index]) * 0.72 }, true);
          }
        }
        const before = ballBody.linvel();
        world.step(events);
        events.drainCollisionEvents((first, second, started) => {
          if (!started) return;
          const other = first === ballCollider.handle ? second : second === ballCollider.handle ? first : -1;
          if (!carColliderHandles.has(other)) return;
          const velocity = ballBody.linvel();
          const strength = Math.hypot(velocity.x - before.x, velocity.z - before.z);
          if (strength > 0.8) {
            const position = ballBody.translation();
            onBallHit(new THREE.Vector3(position.x, position.y, position.z), strength);
          }
        });
        accumulator -= STEP;
      }
      sync();
    },
    dispose() {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clearKeys);
      events.free();
      world.free();
    },
  };
}

