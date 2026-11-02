import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { awardGoal, getScoringSide, opponentCars, opponentSpeed, selectAttacker, type Difficulty } from './match-rules';
import { createStuckMonitor } from './stuck-monitor';
import { GAME_CONFIG } from './game-config';
import { getLateralRecoveryImpulse } from './vehicle-dynamics';

const { fixedStep: STEP, maxFrameDelta } = GAME_CONFIG.simulation;
const { arena, vehicles, ball: ballConfig, goals, ai } = GAME_CONFIG;
const CAR_HEIGHT = vehicles.halfHeight + 0.06;
let initialization: Promise<void> | undefined;

export type DriveInput = { forward: boolean; reverse: boolean; left: boolean; right: boolean };

export type MatchState = { red: number; blue: number; redCars: number; blueCars: number; message: string; finished: boolean };
export async function createPhysics(ball: THREE.Group, cars: THREE.Group[], input: DriveInput, onState: (state: MatchState) => void, difficulty: Difficulty, round: number, isPlaying: () => boolean) {
  initialization ??= RAPIER.init();
  await initialization;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  world.integrationParameters.numSolverIterations = 8;
  const fixedBox = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRestitution(0.5));
  };
  fixedBox(0, -0.2, 0, arena.halfWidth, 0.25, arena.halfLength);
  for (const z of [-arena.sideWallZ, arena.sideWallZ]) fixedBox(0, 0.7, z, arena.goalLineX, 0.7, 0.1);
  // Posts and crossbars match the visible goal openings; the goal mouth remains clear.
  for (const x of [-arena.goalLineX, arena.goalLineX]) {
    for (const z of [-arena.goalHalfWidth, arena.goalHalfWidth]) fixedBox(x, arena.goalHeight / 2, z, 0.1, arena.goalHeight / 2, 0.1);
    fixedBox(x, arena.goalHeight, 0, 0.1, 0.1, arena.goalHalfWidth);
    fixedBox(Math.sign(x) * arena.goalBackX, arena.goalHeight / 2, 0, 0.1, arena.goalHeight / 2, arena.goalHalfWidth);
  }

  const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, ballConfig.radius + 0.06, 0).setCcdEnabled(true).setLinearDamping(ballConfig.linearDamping));
  const ballCollider = world.createCollider(RAPIER.ColliderDesc.ball(ballConfig.radius).setMass(ballConfig.mass).setRestitution(ballConfig.restitution).setFriction(ballConfig.friction).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), ballBody);
  const events = new RAPIER.EventQueue(true);
  const carColliderIndices = new Map<number, number>();
  const carBodies = cars.map((car, index) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(car.position.x, CAR_HEIGHT, car.position.z).setCcdEnabled(true).setLinearDamping(vehicles.rollingDrag).setAngularDamping(3));
    body.setEnabledRotations(false, true, false, true);
    const collider = world.createCollider(RAPIER.ColliderDesc.cylinder(vehicles.halfHeight, vehicles.radius).setMass(vehicles.mass).setFriction(0.8).setRestitution(0.38).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    carColliderIndices.set(collider.handle, index);
    return body;
  });
  const impactRecovery = new Float32Array(cars.length);
  let state: MatchState = { red: 0, blue: 0, redCars: 1, blueCars: opponentCars(round), message: 'Faça 3 gols para vencer', finished: false };
  const enabled = (index: number) => index === 0 || index === 1 || (index === 2 ? state.redCars > 1 : index - 2 < state.blueCars);
  const spawn = [{ x: -18, z: 0 }, { x: 18, z: 0 }, { x: -18, z: 9 }, { x: 18, z: -9 }, { x: 18, z: 9 }, { x: 24, z: 0 }];
  const setTeams = () => carBodies.forEach((body, index) => { const active = enabled(index); body.setEnabled(active); cars[index].visible = active; });
  const resetPositions = () => {
    stuck.reset();
    impactRecovery.fill(0);
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
      accumulator += Math.min(delta, maxFrameDelta);
      while (accumulator >= STEP) {
        const forward = Number(input.forward || keys.has('KeyW') || keys.has('ArrowUp')) - Number(input.reverse || keys.has('KeyS') || keys.has('ArrowDown'));
        const turn = Number(input.left || keys.has('KeyA') || keys.has('ArrowLeft')) - Number(input.right || keys.has('KeyD') || keys.has('ArrowRight'));
        const car = carBodies[0];
        const velocity = car.linvel();
        const directionX = -Math.sin(heading);
        const directionZ = -Math.cos(heading);
        const speed = velocity.x * directionX + velocity.z * directionZ;
        const steeringScale = THREE.MathUtils.clamp(Math.abs(speed) / 3, 0, 1);
        heading += turn * vehicles.steeringRate * steeringScale * STEP * (speed < -0.4 ? -1 : 1);
        const nextDirectionX = -Math.sin(heading);
        const nextDirectionZ = -Math.cos(heading);
        const lateralSpeed = velocity.x * nextDirectionZ - velocity.z * nextDirectionX;
        const grip = turn ? vehicles.lateralGrip * 0.55 : vehicles.lateralGrip;
        car.applyImpulse({ x: -nextDirectionZ * lateralSpeed * grip, y: 0, z: nextDirectionX * lateralSpeed * grip }, true);
        const currentSpeed = velocity.x * nextDirectionX + velocity.z * nextDirectionZ;
        const targetSpeed = forward > 0 ? vehicles.maxSpeed : forward < 0 ? -vehicles.reverseMaxSpeed : 0;
        const rate = forward && currentSpeed * forward < -0.3 ? vehicles.braking : forward ? vehicles.acceleration : vehicles.rollingDrag;
        const nextSpeed = THREE.MathUtils.damp(currentSpeed, targetSpeed, rate / Math.max(vehicles.maxSpeed, vehicles.reverseMaxSpeed), STEP);
        car.applyImpulse({ x: nextDirectionX * (nextSpeed - currentSpeed) * vehicles.mass, y: 0, z: nextDirectionZ * (nextSpeed - currentSpeed) * vehicles.mass }, true);
        // Approach from behind the ball, then push it away from the nearest wall.
        const target = ballBody.translation();
        const ballVelocity = ballBody.linvel();
        const predictedX = THREE.MathUtils.clamp(target.x + ballVelocity.x * ai.predictionSeconds, -arena.goalLineX, arena.goalLineX);
        const predictedZ = THREE.MathUtils.clamp(target.z + ballVelocity.z * ai.predictionSeconds, -arena.sideWallZ + 2, arena.sideWallZ - 2);
        for (let index = 1; index < carBodies.length; index++) {
          if (!enabled(index)) continue;
          const opponent = carBodies[index];
          const state = opponents[index];
          const position = opponent.translation();
          const pushX = index === 2 ? 1 : -1;
          const playerPosition = carBodies[0].translation();
          const playerBlocksGoal = index !== 2 && playerPosition.x < target.x - 2 && Math.abs(playerPosition.z - target.z) < 4;
          const aimZ = playerBlocksGoal ? (playerPosition.z >= 0 ? -4.8 : 4.8) : 0;
          const goalX = index === 2 ? arena.goalLineX : -arena.goalLineX;
          const pushZ = THREE.MathUtils.clamp((aimZ - target.z) / Math.min(14, Math.max(8, Math.abs(goalX - target.x))), -0.8, 0.8);
          const pushLength = Math.hypot(pushX, pushZ);
          const directionX = pushX / pushLength;
          const directionZ = pushZ / pushLength;
          const offset = index === 1 || index === 2 ? 0 : (index - 3) * 2.5 - 2.5;
          const activeTeamCars = carBodies.map((body, carIndex) => ({ body, carIndex })).filter(({ carIndex }) => carIndex > 0 && enabled(carIndex));
          const sameTeamCars = activeTeamCars.filter(({ carIndex }) => index === 2 ? carIndex === 2 : carIndex !== 2);
          const attackerIndex = selectAttacker(sameTeamCars.map(({ body }) => {
            const carPosition = body.translation(); return { x: carPosition.x, y: carPosition.y, z: carPosition.z };
          }), { x: predictedX, y: target.y, z: predictedZ });
          const isAttacker = sameTeamCars[attackerIndex]?.carIndex === index;
          const defendX = index === 2 ? -arena.goalLineX + ai.defenseDepth : arena.goalLineX - ai.defenseDepth;
          const approachX = THREE.MathUtils.clamp(isAttacker ? predictedX - directionX * ai.attackRange - directionZ * offset : defendX, -arena.goalLineX + 2, arena.goalLineX - 2);
          const approachZ = THREE.MathUtils.clamp(isAttacker ? predictedZ - directionZ * ai.attackRange + directionX * offset : predictedZ * 0.45 + offset, -arena.sideWallZ + 2, arena.sideWallZ - 2);
          const approachDistance = Math.hypot(approachX - position.x, approachZ - position.z);
          const ballDistance = Math.hypot(predictedX - position.x, predictedZ - position.z);
          if (isAttacker && approachDistance < 1.8) state.attacking = true;
          if (!isAttacker) state.attacking = false;
          const sidewaysError = Math.abs((position.x - target.x) * directionZ - (position.z - target.z) * directionX);
          if (ballDistance > 5 || (position.x - target.x) * directionX + (position.z - target.z) * directionZ > 0.5 || (ballDistance < 4 && sidewaysError > 2)) state.attacking = false;
          const dx = (state.attacking ? target.x - directionX * 1.5 : approachX) - position.x;
          const dz = (state.attacking ? target.z - directionZ * 1.5 : approachZ) - position.z;
          const desired = Math.atan2(-dx, -dz);
          const difference = Math.atan2(Math.sin(desired - aiHeadings[index]), Math.cos(desired - aiHeadings[index]));
          const velocity = opponent.linvel();
          const tryingToMove = Math.abs(difference) < 1.2;
          state.blockedTime = tryingToMove && Math.hypot(velocity.x, velocity.z) < 0.08 ? state.blockedTime + STEP : 0;
          if (state.blockedTime > 1.2 && state.recoveryTime <= 0) {
            state.recoveryTime = ai.recoverAfterSeconds;
            state.blockedTime = 0;
            state.attacking = false;
          }
          const recovering = state.recoveryTime > 0;
          state.recoveryTime = Math.max(0, state.recoveryTime - STEP);
          aiHeadings[index] += recovering ? (index % 2 ? 1 : -1) * 1.8 * STEP : THREE.MathUtils.clamp(difference, -2.5 * STEP, 2.5 * STEP);
          opponent.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aiHeadings[index]), true);
          const aiSpeed = opponent.linvel();
          const aiCap = opponentSpeed(difficulty, round) * 8;
          const aiForward = isAttacker ? aiCap : aiCap * 0.72;
          if (!recovering) {
            const steeringFactor = THREE.MathUtils.clamp(1 - Math.abs(difference) / Math.PI, 0.2, 1);
            const nextX = velocity.x - Math.sin(aiHeadings[index]) * aiForward * steeringFactor * STEP;
            const nextZ = velocity.z - Math.cos(aiHeadings[index]) * aiForward * steeringFactor * STEP;
            const nextSpeed = Math.hypot(nextX, nextZ);
            const speedScale = nextSpeed > aiCap ? aiCap / nextSpeed : 1;
            opponent.setLinvel({ x: nextX * speedScale, y: velocity.y, z: nextZ * speedScale }, true);
          }
          const aiPlanarSpeed = Math.hypot(aiSpeed.x, aiSpeed.z);
          if (aiPlanarSpeed > aiCap && aiPlanarSpeed > 0) opponent.setLinvel({ x: aiSpeed.x * aiCap / aiPlanarSpeed, y: aiSpeed.y, z: aiSpeed.z * aiCap / aiPlanarSpeed }, true);
        }
        const before = ballBody.linvel();
        const carVelocitiesBefore = carBodies.map((body) => body.linvel());
        world.step(events);
        events.drainCollisionEvents((first, second, started) => {
          if (!started) return;
          const firstIndex = carColliderIndices.get(first);
          const secondIndex = carColliderIndices.get(second);
          for (const index of [firstIndex, secondIndex]) {
            if (index === undefined) continue;
            const after = carBodies[index].linvel();
            const beforeCar = carVelocitiesBefore[index];
            const impact = Math.hypot(after.x - beforeCar.x, after.y - beforeCar.y, after.z - beforeCar.z);
            if (impact >= vehicles.impactRecoveryThreshold) impactRecovery[index] = vehicles.impactRecoverySeconds;
          }
          const hitCar = first === ballCollider.handle ? second : second === ballCollider.handle ? first : undefined;
          if (hitCar !== undefined && carColliderIndices.has(hitCar)) {
            const velocityAfterHit = ballBody.linvel();
            const strength = Math.hypot(velocityAfterHit.x - before.x, velocityAfterHit.z - before.z);
            if (strength > 0.8) {
              const position = ballBody.translation();
              onBallHit(new THREE.Vector3(position.x, position.y, position.z), strength);
            }
          }
        });
        for (const body of carBodies) {
          const velocity = body.linvel();
          const speed = Math.hypot(velocity.x, velocity.z);
          if (speed > vehicles.maxSpeed && speed > 0) body.setLinvel({ x: velocity.x * vehicles.maxSpeed / speed, y: velocity.y, z: velocity.z * vehicles.maxSpeed / speed }, true);
        }
        carBodies.forEach((body, index) => {
          if (impactRecovery[index] <= 0) return;
          impactRecovery[index] = Math.max(0, impactRecovery[index] - STEP);
          const velocity = body.linvel();
          const angle = index === 0 ? heading : aiHeadings[index];
          const impulse = getLateralRecoveryImpulse(velocity.x, velocity.z, angle, vehicles.mass, vehicles.impactRecoveryGrip);
          body.applyImpulse({ x: impulse.x, y: 0, z: impulse.z }, true);
        });
        const ballPosition = ballBody.translation();
        const scoringSide = getScoringSide(ballPosition);
        if (scoringSide) {
          const redGoal = scoringSide === 'blue';
          state = awardGoal(state, redGoal ? 'red' : 'blue', round);
          resetPositions(); onState({ ...state });
          accumulator = 0;
          break;
        }
        if (stuck.update(ballPosition.x, ballPosition.z, STEP)) {
          resetPositions();
          state.message = 'Bola presa: jogada reiniciada no centro.';
          onState({ ...state });
          accumulator = 0;
          break;
        }
        accumulator -= STEP;
      }
      sync();
    },
    resetAccumulator() {
      accumulator = 0;
      keys.clear();
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

