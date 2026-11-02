import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { opponentCars, opponentSpeed, type Difficulty } from './match-rules';

const STEP = 1 / 60;
const CAR_HEIGHT = 0.4;
let initialization: Promise<void> | undefined;

export type DriveInput = { forward: boolean; reverse: boolean; left: boolean; right: boolean };

export type MatchState = { red: number; blue: number; redCars: number; blueCars: number; message: string; finished: boolean };
export async function createPhysics(ball: THREE.Group, cars: THREE.Group[], input: DriveInput, onState: (state: MatchState) => void, difficulty: Difficulty, round: number) {
  initialization ??= RAPIER.init();
  await initialization;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const fixedBox = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRestitution(0.5));
  };
  fixedBox(0, -0.2, 0, 28, 0.25, 14);
  for (const z of [-12.3, 12.3]) fixedBox(0, 0.7, z, 25.5, 0.7, 0.1);
  // Leave the middle of each end open for the goals.
  for (const x of [-25.38, 25.38]) {
    for (const z of [-8.4, 8.4]) fixedBox(x, 1.75, z, 0.1, 1.75, 3.9);
    fixedBox(x, 4, 0, 0.1, 0.5, 4.5);
    fixedBox(x * 1.06, 1.75, 0, 0.1, 1.75, 4.5);
  }

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
  let state: MatchState = { red: 0, blue: 0, redCars: 1, blueCars: opponentCars(round), message: 'Faça 3 gols para vencer', finished: false };
  const enabled = (index: number) => index === 0 || index === 1 || (index === 2 ? state.redCars > 1 : state.blueCars > 1);
  const setTeams = () => carBodies.forEach((body, index) => { const active = enabled(index); body.setEnabled(active); cars[index].visible = active; });
  const resetPositions = () => {
    ballBody.setTranslation({ x: 0, y: 0.96, z: 0 }, true);
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    heading = -Math.PI / 2;
    carBodies.forEach((body, index) => {
      aiHeadings[index] = index % 2 === 0 ? -Math.PI / 2 : Math.PI / 2;
      body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aiHeadings[index]), true);
      body.setTranslation({ x: index % 2 === 0 ? -11 : 11, y: CAR_HEIGHT, z: index < 2 ? 0 : (index === 2 ? 6 : -6) }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    setTeams();
  };
  setTeams();
  onState({ ...state });
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
      if (state.finished) return;
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
          if (!enabled(index)) continue;
          const opponent = carBodies[index];
          const state = opponents[index];
          const position = opponent.translation();
          const pushX = index === 2 ? 1 : -1;
          const pushZ = Math.abs(target.z) > 10 ? -Math.sign(target.z) * 0.8 : 0;
          const pushLength = Math.hypot(pushX, pushZ);
          const directionX = pushX / pushLength;
          const directionZ = pushZ / pushLength;
          const offset = (index - 2) * 1.4;
          const approachX = THREE.MathUtils.clamp(target.x - directionX * 3 - directionZ * offset, -23, 23);
          const approachZ = THREE.MathUtils.clamp(target.z - directionZ * 3 + directionX * offset, -10, 10);
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
            const acceleration = recovering ? -0.8 : index === 2 ? 0.72 : opponentSpeed(difficulty, round);
            opponent.applyImpulse({ x: -Math.sin(aiHeadings[index]) * acceleration, y: 0, z: -Math.cos(aiHeadings[index]) * acceleration }, true);
          }
        }
        const before = ballBody.linvel();
        const nearWall = Math.abs(target.x) > 23 || Math.abs(target.z) > 10;
        const contested = carBodies.some((body) => {
          const position = body.translation();
          return Math.hypot(position.x - target.x, position.z - target.z) < 3.5;
        });
        ballBlockedTime = nearWall && contested && Math.hypot(before.x, before.z) < 0.6 ? ballBlockedTime + STEP : 0;
        if (ballBlockedTime > 2) {
          const inwardX = Math.abs(target.x) > 23 ? -Math.sign(target.x) : 0;
          const inwardZ = Math.abs(target.z) > 10 ? -Math.sign(target.z) : 0;
          ballBody.applyImpulse({ x: inwardX * 2, y: 0, z: inwardZ * 2 }, true);
          ballBlockedTime = 0;
        }
        world.step(events);
        const ballPosition = ballBody.translation();
        if (Math.abs(ballPosition.x) > 25.44 && Math.abs(ballPosition.z) < 4.5 && ballPosition.y < 3.5) {
          const redGoal = ballPosition.x > 0;
          if (redGoal) { state.red++; state.redCars = 2; state.message = 'GOL VERMELHO! Reforço liberado.'; }
          else { state.blue++; state.redCars = 1; state.message = 'GOL AZUL! Você perdeu o reforço.'; }
          state.finished = state.red >= 3 || state.blue >= 3;
          if (state.finished) state.message = redGoal ? 'Vitória! Você venceu a partida.' : 'Fim de jogo. O azul venceu.';
          resetPositions(); onState({ ...state });
          accumulator = 0;
          break;
        }
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
    restart() {
      state = { red: 0, blue: 0, redCars: 1, blueCars: opponentCars(round), message: 'Faça 3 gols para vencer', finished: false };
      accumulator = 0; resetPositions(); onState({ ...state });
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

