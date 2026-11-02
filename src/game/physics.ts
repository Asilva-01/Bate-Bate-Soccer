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
  const opponents = cars.map(() => ({ blockedTime: 0, recoveryTime: 0, attacking: false }));
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
  let ballBlockedTime = 0;
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
        // Approach from behind the ball, then push it away from the nearest wall.
        const target = ballBody.translation();
        for (let index = 1; index < carBodies.length; index++) {
          const opponent = carBodies[index];
          const state = opponents[index];
          const position = opponent.translation();
          const pushX = Math.abs(target.x) > 10 ? -Math.sign(target.x) : index === 3 ? 1 : -1;
          const pushZ = Math.abs(target.z) > 5 ? -Math.sign(target.z) * 0.8 : 0;
          const pushLength = Math.hypot(pushX, pushZ);
          const directionX = pushX / pushLength;
          const directionZ = pushZ / pushLength;
          const offset = (index - 2) * 1.4;
          const approachX = THREE.MathUtils.clamp(target.x - directionX * 3 - directionZ * offset, -12.5, 12.5);
          const approachZ = THREE.MathUtils.clamp(target.z - directionZ * 3 + directionX * offset, -6.5, 6.5);
          const approachDistance = Math.hypot(approachX - position.x, approachZ - position.z);
          const ballDistance = Math.hypot(target.x - position.x, target.z - position.z);
          if (approachDistance < 1.3) state.attacking = true;
          if (ballDistance > 5 || (position.x - target.x) * directionX + (position.z - target.z) * directionZ > 0.5) state.attacking = false;
          const dx = (state.attacking ? target.x + directionX * 1.5 : approachX) - position.x;
          const dz = (state.attacking ? target.z + directionZ * 1.5 : approachZ) - position.z;
          const desired = Math.atan2(-dx, -dz);
          const difference = Math.atan2(Math.sin(desired - aiHeadings[index]), Math.cos(desired - aiHeadings[index]));
          const velocity = opponent.linvel();
          const tryingToMove = Math.abs(difference) < 1.2;
          state.blockedTime = tryingToMove && Math.hypot(velocity.x, velocity.z) < 0.35 ? state.blockedTime + STEP : 0;
          if (state.blockedTime > 1.2 && state.recoveryTime <= 0) {
            state.recoveryTime = 1;
            state.blockedTime = 0;
            state.attacking = false;
          }
          const recovering = state.recoveryTime > 0;
          state.recoveryTime = Math.max(0, state.recoveryTime - STEP);
          aiHeadings[index] += recovering ? (index % 2 ? 1 : -1) * 1.8 * STEP : THREE.MathUtils.clamp(difference, -2.5 * STEP, 2.5 * STEP);
          opponent.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aiHeadings[index]), true);
          if (recovering || tryingToMove) {
            const acceleration = recovering ? -0.8 : 0.72;
            opponent.applyImpulse({ x: -Math.sin(aiHeadings[index]) * acceleration, y: 0, z: -Math.cos(aiHeadings[index]) * acceleration }, true);
          }
        }
        const before = ballBody.linvel();
        const nearWall = Math.abs(target.x) > 12 || Math.abs(target.z) > 6.5;
        const contested = carBodies.some((body) => {
          const position = body.translation();
          return Math.hypot(position.x - target.x, position.z - target.z) < 3.5;
        });
        ballBlockedTime = nearWall && contested && Math.hypot(before.x, before.z) < 0.6 ? ballBlockedTime + STEP : 0;
        if (ballBlockedTime > 2) {
          const inwardX = Math.abs(target.x) > 12 ? -Math.sign(target.x) : 0;
          const inwardZ = Math.abs(target.z) > 6.5 ? -Math.sign(target.z) : 0;
          ballBody.applyImpulse({ x: inwardX * 2, y: 0, z: inwardZ * 2 }, true);
          ballBlockedTime = 0;
        }
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

