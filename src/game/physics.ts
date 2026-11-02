import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { opponentCars, opponentSpeed, type Difficulty } from './match-rules';
import { createStuckMonitor } from './stuck-monitor';

const STEP = 1 / 60;
const CAR_HEIGHT = 0.4;
let initialization: Promise<void> | undefined;

export type DriveInput = { forward: boolean; reverse: boolean; left: boolean; right: boolean };

export type MatchState = { red: number; blue: number; redCars: number; blueCars: number; message: string; finished: boolean };
export async function createPhysics(ball: THREE.Group, cars: THREE.Group[], input: DriveInput, onState: (state: MatchState) => void, difficulty: Difficulty, round: number, isPlaying: () => boolean) {
  initialization ??= RAPIER.init();
  await initialization;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const fixedBox = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRestitution(0.5));
  };
  fixedBox(0, -0.2, 0, 38, 0.25, 19);
  for (const z of [-16.4, 16.4]) fixedBox(0, 0.7, z, 34, 0.7, 0.1);
  // Leave the middle of each end open for the goals.
  for (const x of [-33.84, 33.84]) {
    for (const z of [-11.2, 11.2]) fixedBox(x, 1.75, z, 0.1, 1.75, 5.2);
    fixedBox(x, 4, 0, 0.1, 0.5, 6);
    fixedBox(x * 1.06, 1.75, 0, 0.1, 1.75, 6);
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
  const enabled = (index: number) => index === 0 || index === 1 || (index === 2 ? state.redCars > 1 : index - 2 < state.blueCars);
  const spawn = [{ x: -15, z: 0 }, { x: 15, z: 0 }, { x: -15, z: 8 }, { x: 15, z: -8 }, { x: 15, z: 8 }, { x: 21, z: 0 }];
  const setTeams = () => carBodies.forEach((body, index) => { const active = enabled(index); body.setEnabled(active); cars[index].visible = active; });
  const resetPositions = () => {
    stuck.reset();
    opponents.forEach((opponent) => { opponent.blockedTime = 0; opponent.recoveryTime = 0; opponent.attacking = false; });
    ballBody.setTranslation({ x: 0, y: 0.96, z: 0 }, true);
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    heading = -Math.PI / 2;
    carBodies.forEach((body, index) => {
      aiHeadings[index] = index === 0 || index === 2 ? -Math.PI / 2 : Math.PI / 2;
      body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aiHeadings[index]), true);
      body.setTranslation({ x: spawn[index].x, y: CAR_HEIGHT, z: spawn[index].z }, true);
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
    if (!isPlaying() || !accepted.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    keys.add(event.code);
  };
  const keyup = (event: KeyboardEvent) => { keys.delete(event.code); };
  const clearKeys = () => keys.clear();
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', clearKeys);
  let accumulator = 0;
  const stuck = createStuckMonitor();
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
        const directionX = -Math.sin(heading);
        const directionZ = -Math.cos(heading);
        const velocity = car.linvel();
        // Reduce sideways sliding while retaining collision momentum and reverse control.
        const lateralSpeed = velocity.x * directionZ - velocity.z * directionX;
        car.applyImpulse({ x: -directionZ * lateralSpeed * 0.7, y: 0, z: directionX * lateralSpeed * 0.7 }, true);
        const speed = velocity.x * directionX + velocity.z * directionZ;
        if (forward && (Math.abs(speed) < 15 || Math.sign(speed) !== forward)) {
          car.applyImpulse({ x: directionX * forward * 1.65, y: 0, z: directionZ * forward * 1.65 }, true);
        }
        // Approach from behind the ball, then push it away from the nearest wall.
        const target = ballBody.translation();
        for (let index = 1; index < carBodies.length; index++) {
          if (!enabled(index)) continue;
          const opponent = carBodies[index];
          const state = opponents[index];
          const position = opponent.translation();
          const pushX = index === 2 ? 1 : -1;
          const playerPosition = carBodies[0].translation();
          const playerBlocksGoal = index !== 2 && playerPosition.x < target.x - 2 && Math.abs(playerPosition.z - target.z) < 4;
          const aimZ = playerBlocksGoal ? (playerPosition.z >= 0 ? -4.8 : 4.8) : 0;
          const goalX = index === 2 ? 34 : -34;
          const pushZ = THREE.MathUtils.clamp((aimZ - target.z) / Math.min(14, Math.max(8, Math.abs(goalX - target.x))), -0.8, 0.8);
          const pushLength = Math.hypot(pushX, pushZ);
          const directionX = pushX / pushLength;
          const directionZ = pushZ / pushLength;
          const offset = index === 1 || index === 2 ? 0 : (index - 3) * 2.5 - 2.5;
          const approachX = THREE.MathUtils.clamp(target.x - directionX * 3 - directionZ * offset, -31, 31);
          const approachZ = THREE.MathUtils.clamp(target.z - directionZ * 3 + directionX * offset, -14, 14);
          const approachDistance = Math.hypot(approachX - position.x, approachZ - position.z);
          const ballDistance = Math.hypot(target.x - position.x, target.z - position.z);
          if (approachDistance < 1.3) state.attacking = true;
          const sidewaysError = Math.abs((position.x - target.x) * directionZ - (position.z - target.z) * directionX);
          if (ballDistance > 5 || (position.x - target.x) * directionX + (position.z - target.z) * directionZ > 0.5 || (ballDistance < 4 && sidewaysError > 2)) state.attacking = false;
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
        world.step(events);
        const ballPosition = ballBody.translation();
        if (Math.abs(ballPosition.x) > 33.95 && Math.abs(ballPosition.z) < 6 && ballPosition.y < 3.5) {
          const redGoal = ballPosition.x > 0;
          if (redGoal) { state.red++; if (round >= 2) { state.redCars = 2; state.message = 'GOL VERMELHO! Reforço liberado.'; } else state.message = 'GOL VERMELHO! Reforço disponível a partir da rodada 2.'; }
          else { state.blue++; state.redCars = 1; state.message = 'GOL AZUL! Você perdeu o reforço.'; }
          state.finished = state.red >= 3 || state.blue >= 3;
          if (state.finished) state.message = redGoal ? 'Vitória! Você venceu a partida.' : 'Fim de jogo. O azul venceu.';
          resetPositions(); onState({ ...state });
          accumulator = 0;
          break;
        }
        if (stuck.update(ballPosition.x, ballPosition.z, STEP)) {
          resetPositions();
          state.message = 'Bola presa: jogada reiniciada no centro.';
          onState({ ...state });
          events.drainCollisionEvents(() => {});
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

