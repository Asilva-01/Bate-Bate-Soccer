import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { awardGoal, getScoringSide, opponentCars, opponentSpeed, selectAttacker, type Difficulty } from './match-rules';
import { createStuckMonitor } from './stuck-monitor';
import { AI, BALL, CAR, FIELD, MATCH, SIMULATION } from './config';
import { createKeyboardInput, type DriveInput } from './input';
import { getLateralRecoveryImpulse } from './vehicle-dynamics';

const { fixedStep: STEP, maxFrameDelta } = SIMULATION;
const CAR_HEIGHT = CAR.halfHeight + CAR.bodyOffset;
let initialization: Promise<void> | undefined;

export type MatchState = { red: number; blue: number; redCars: number; blueCars: number; message: string; finished: boolean };
export async function createPhysics(ball: THREE.Group, cars: THREE.Group[], input: DriveInput, onState: (state: MatchState) => void, difficulty: Difficulty, round: number, isPlaying: () => boolean) {
  initialization ??= RAPIER.init();
  await initialization;
  const world = new RAPIER.World({ x: 0, y: -SIMULATION.gravity, z: 0 });
  world.timestep = STEP;
  world.integrationParameters.numSolverIterations = SIMULATION.solverIterations;
  const fixedBox = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRestitution(SIMULATION.wallRestitution));
  };
  fixedBox(0, FIELD.recovery.floorCenterY, 0, FIELD.halfWidth, FIELD.recovery.floorHalfHeight, FIELD.halfLength);
  for (const z of [-FIELD.sideWallZ, FIELD.sideWallZ]) fixedBox(0, SIMULATION.carBodyCenterOffset, z, FIELD.goalLineX, FIELD.recovery.wallHalfHeight, FIELD.recovery.wallHalfDepth);
  // Posts and crossbars match the visible goal openings; the goal mouth remains clear.
  for (const x of [-FIELD.goalLineX, FIELD.goalLineX]) {
    for (const z of [-FIELD.goalHalfWidth, FIELD.goalHalfWidth]) fixedBox(x, FIELD.goalHeight / 2, z, FIELD.recovery.goalColliderHalfSize, FIELD.goalHeight / 2, FIELD.recovery.goalColliderHalfSize);
    fixedBox(x, FIELD.goalHeight, 0, FIELD.recovery.goalColliderHalfSize, FIELD.recovery.goalColliderHalfSize, FIELD.goalHalfWidth);
    fixedBox(Math.sign(x) * FIELD.goalBackX, FIELD.goalHeight / 2, 0, FIELD.recovery.goalColliderHalfSize, FIELD.goalHeight / 2, FIELD.goalHalfWidth);
  }

  const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, BALL.radius + BALL.bodyOffset, 0).setCcdEnabled(true).setLinearDamping(BALL.linearDamping));
  const ballCollider = world.createCollider(RAPIER.ColliderDesc.ball(BALL.radius).setMass(BALL.mass).setRestitution(BALL.restitution).setFriction(BALL.friction).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), ballBody);
  const events = new RAPIER.EventQueue(true);
  const carColliderIndices = new Map<number, number>();
  const carBodies = cars.map((car, index) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(car.position.x, CAR_HEIGHT, car.position.z).setCcdEnabled(true).setLinearDamping(CAR.rollingDrag).setAngularDamping(CAR.angularDamping));
    body.setEnabledRotations(false, true, false, true);
    const collider = world.createCollider(RAPIER.ColliderDesc.cylinder(CAR.halfHeight, CAR.radius).setMass(CAR.mass).setFriction(CAR.friction).setRestitution(CAR.restitution).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    carColliderIndices.set(collider.handle, index);
    return body;
  });
  const impactRecovery = new Float32Array(cars.length);
  let state: MatchState = { red: 0, blue: 0, redCars: MATCH.startingCars, blueCars: opponentCars(round), message: 'FaÃ§a 3 gols para vencer', finished: false };
  const enabled = (index: number) => index === AI.playerIndex || index === AI.opponentIndex || (index === AI.redAllyIndex ? state.redCars > MATCH.startingCars : index - AI.redAllyIndex < state.blueCars);
  const spawn = CAR.spawnPositions;
  const setTeams = () => carBodies.forEach((body, index) => { const active = enabled(index); body.setEnabled(active); cars[index].visible = active; });
  const resetPositions = () => {
    stuck.reset();
    impactRecovery.fill(0);
    opponents.forEach((opponent) => { opponent.blockedTime = 0; opponent.recoveryTime = 0; opponent.attacking = false; });
    ballBody.setTranslation({ x: 0, y: BALL.radius + BALL.bodyOffset, z: 0 }, true);
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    heading = -Math.PI / 2;
    carBodies.forEach((body, index) => {
      aiHeadings[index] = index === AI.playerIndex || index === AI.redAllyIndex ? -Math.PI / 2 : Math.PI / 2;
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
  const keyboard = createKeyboardInput(isPlaying);
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
        const keys = keyboard.read(input);
        const forward = Number(keys.forward) - Number(keys.reverse);
        const turn = Number(keys.left) - Number(keys.right);
        const car = carBodies[AI.playerIndex];
        const velocity = car.linvel();
        const directionX = -Math.sin(heading);
        const directionZ = -Math.cos(heading);
        const speed = velocity.x * directionX + velocity.z * directionZ;
        const steeringScale = THREE.MathUtils.clamp(Math.abs(speed) / CAR.steeringReferenceSpeed, 0, 1);
        heading += turn * CAR.steeringRate * steeringScale * STEP * (speed < -CAR.reverseSteeringThreshold ? -1 : 1);
        const nextDirectionX = -Math.sin(heading);
        const nextDirectionZ = -Math.cos(heading);
        const lateralSpeed = velocity.x * nextDirectionZ - velocity.z * nextDirectionX;
        const grip = turn ? CAR.lateralGrip * CAR.turningGripFactor : CAR.lateralGrip;
        car.applyImpulse({ x: -nextDirectionZ * lateralSpeed * grip, y: 0, z: nextDirectionX * lateralSpeed * grip }, true);
        const currentSpeed = velocity.x * nextDirectionX + velocity.z * nextDirectionZ;
        const targetSpeed = forward > 0 ? CAR.maxSpeed : forward < 0 ? -CAR.reverseMaxSpeed : 0;
        const rate = forward && currentSpeed * forward < -CAR.brakingThreshold ? CAR.braking : forward ? CAR.acceleration : CAR.rollingDrag;
        const nextSpeed = THREE.MathUtils.damp(currentSpeed, targetSpeed, rate / Math.max(CAR.maxSpeed, CAR.reverseMaxSpeed), STEP);
        car.applyImpulse({ x: nextDirectionX * (nextSpeed - currentSpeed) * CAR.mass, y: 0, z: nextDirectionZ * (nextSpeed - currentSpeed) * CAR.mass }, true);
        // Approach from behind the ball, then push it away from the nearest wall.
        const target = ballBody.translation();
        const ballVelocity = ballBody.linvel();
        const predictedX = THREE.MathUtils.clamp(target.x + ballVelocity.x * AI.predictionSeconds, -FIELD.goalLineX, FIELD.goalLineX);
        const predictedZ = THREE.MathUtils.clamp(target.z + ballVelocity.z * AI.predictionSeconds, -FIELD.sideWallZ + AI.wallClearance, FIELD.sideWallZ - AI.wallClearance);
        for (let index = 1; index < carBodies.length; index++) {
          if (!enabled(index)) continue;
          const opponent = carBodies[index];
          const state = opponents[index];
          const position = opponent.translation();
          const pushX = index === AI.redAllyIndex ? 1 : -1;
          const playerPosition = carBodies[0].translation();
          const playerBlocksGoal = index !== AI.redAllyIndex && playerPosition.x < target.x - AI.playerBlockGoalXMargin && Math.abs(playerPosition.z - target.z) < AI.playerBlockGoalZRange;
          const aimZ = playerBlocksGoal ? (playerPosition.z >= 0 ? -AI.aimLaneOffset : AI.aimLaneOffset) : 0;
          const goalX = index === AI.redAllyIndex ? FIELD.goalLineX : -FIELD.goalLineX;
          const pushZ = THREE.MathUtils.clamp((aimZ - target.z) / Math.min(AI.pushDistanceMax, Math.max(AI.pushDistanceMin, Math.abs(goalX - target.x))), -AI.pushZLimit, AI.pushZLimit);
          const pushLength = Math.hypot(pushX, pushZ);
          const directionX = pushX / pushLength;
          const directionZ = pushZ / pushLength;
          const offset = index === AI.opponentIndex || index === AI.redAllyIndex ? 0 : (index - AI.roleOffsetStartIndex) * AI.roleOffsetSpacing - AI.roleOffsetCenter;
          const activeTeamCars = carBodies.map((body, carIndex) => ({ body, carIndex })).filter(({ carIndex }) => carIndex > AI.playerIndex && enabled(carIndex));
          const sameTeamCars = activeTeamCars.filter(({ carIndex }) => index === AI.redAllyIndex ? carIndex === AI.redAllyIndex : carIndex !== AI.redAllyIndex);
          const attackerIndex = selectAttacker(sameTeamCars.map(({ body }) => {
            const carPosition = body.translation(); return { x: carPosition.x, y: carPosition.y, z: carPosition.z };
          }), { x: predictedX, y: target.y, z: predictedZ });
          const isAttacker = sameTeamCars[attackerIndex]?.carIndex === index;
          const defendX = index === AI.redAllyIndex ? -FIELD.goalLineX + AI.defenseDepth : FIELD.goalLineX - AI.defenseDepth;
          const approachX = THREE.MathUtils.clamp(isAttacker ? predictedX - directionX * AI.attackRange - directionZ * offset : defendX, -FIELD.goalLineX + AI.goalClampMargin, FIELD.goalLineX - AI.goalClampMargin);
          const approachZ = THREE.MathUtils.clamp(isAttacker ? predictedZ - directionZ * AI.attackRange + directionX * offset : predictedZ * AI.defenderPositionFollowFactor + offset, -FIELD.sideWallZ + AI.wallClearance, FIELD.sideWallZ - AI.wallClearance);
          const approachDistance = Math.hypot(approachX - position.x, approachZ - position.z);
          const ballDistance = Math.hypot(predictedX - position.x, predictedZ - position.z);
          if (isAttacker && approachDistance < AI.attackerApproachDistance) state.attacking = true;
          if (!isAttacker) state.attacking = false;
          const sidewaysError = Math.abs((position.x - target.x) * directionZ - (position.z - target.z) * directionX);
          if (ballDistance > AI.attackingMaxBallDistance || (position.x - target.x) * directionX + (position.z - target.z) * directionZ > AI.attackingBehindPlane || (ballDistance < AI.attackingMinBallDistance && sidewaysError > AI.attackingSidewaysError)) state.attacking = false;
          const dx = (state.attacking ? target.x - directionX * AI.behindBallDistance : approachX) - position.x;
          const dz = (state.attacking ? target.z - directionZ * AI.behindBallDistance : approachZ) - position.z;
          const desired = Math.atan2(-dx, -dz);
          const difference = Math.atan2(Math.sin(desired - aiHeadings[index]), Math.cos(desired - aiHeadings[index]));
          const velocity = opponent.linvel();
          const tryingToMove = Math.abs(difference) < AI.blockedHeadingTolerance;
          state.blockedTime = tryingToMove && Math.hypot(velocity.x, velocity.z) < AI.blockedSpeed ? state.blockedTime + STEP : 0;
          if (state.blockedTime > AI.blockedSeconds && state.recoveryTime <= 0) {
            state.recoveryTime = AI.recoverySeconds;
            state.blockedTime = 0;
            state.attacking = false;
          }
          const recovering = state.recoveryTime > 0;
          state.recoveryTime = Math.max(0, state.recoveryTime - STEP);
          aiHeadings[index] += recovering ? (index % 2 ? 1 : -1) * AI.recoveryTurnRate * STEP : THREE.MathUtils.clamp(difference, -AI.headingTurnRate * STEP, AI.headingTurnRate * STEP);
          opponent.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aiHeadings[index]), true);
          const aiSpeed = opponent.linvel();
          const aiCap = opponentSpeed(difficulty, round) * AI.speedMultiplier;
          const aiForward = isAttacker ? aiCap : aiCap * AI.defenderSpeedFactor;
          if (!recovering) {
            const steeringFactor = THREE.MathUtils.clamp(1 - Math.abs(difference) / Math.PI, AI.minSteeringFactor, 1);
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
            if (impact >= CAR.impactRecoveryThreshold) impactRecovery[index] = CAR.impactRecoverySeconds;
          }
          const hitCar = first === ballCollider.handle ? second : second === ballCollider.handle ? first : undefined;
          if (hitCar !== undefined && carColliderIndices.has(hitCar)) {
            const velocityAfterHit = ballBody.linvel();
            const strength = Math.hypot(velocityAfterHit.x - before.x, velocityAfterHit.z - before.z);
            if (strength > AI.ballHitSoundThreshold) {
              const position = ballBody.translation();
              onBallHit(new THREE.Vector3(position.x, position.y, position.z), strength);
            }
          }
        });
        for (const body of carBodies) {
          const velocity = body.linvel();
          const speed = Math.hypot(velocity.x, velocity.z);
          if (speed > CAR.maxSpeed && speed > 0) body.setLinvel({ x: velocity.x * CAR.maxSpeed / speed, y: velocity.y, z: velocity.z * CAR.maxSpeed / speed }, true);
        }
        carBodies.forEach((body, index) => {
          if (impactRecovery[index] <= 0) return;
          impactRecovery[index] = Math.max(0, impactRecovery[index] - STEP);
          const velocity = body.linvel();
          const angle = index === AI.playerIndex ? heading : aiHeadings[index];
          const impulse = getLateralRecoveryImpulse(velocity.x, velocity.z, angle, CAR.mass, CAR.impactRecoveryGrip);
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
      keyboard.clear();
    },
    restart() {
      state = { red: 0, blue: 0, redCars: MATCH.startingCars, blueCars: opponentCars(round), message: 'FaÃ§a 3 gols para vencer', finished: false };
      accumulator = 0; resetPositions(); onState({ ...state });
    },
    dispose() {
      keyboard.dispose();
      events.free();
      world.free();
    },
  };
}


