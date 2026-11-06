import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { awardGoal, getScoringSide, opponentCars, opponentSpeed, selectAttacker, type Difficulty } from './match-rules';
import { createStuckMonitor } from './stuck-monitor';
import { AI, BALL, CAR, FIELD, KICK, MATCH, SIMULATION } from './config';
import { createKeyboardInput, type ControlFrame } from './input';
import { getLateralRecoveryImpulse, headingDelta, nextForwardSpeed } from './vehicle-dynamics';
import { createPose, interpolatePose, type Pose } from './render-interpolation';
import { containPlanarBody } from './arena-boundaries';
import {
  computeKickTarget,
  impulseForKickTarget,
  isInKickZone,
  isShotOnGoal,
  kickAimDotFor,
  kickDirection,
  kickPowerFactorFor,
  kickReactionFor,
  resolveSimultaneousKicks,
  shouldAiKick,
  stepKickTimer,
  type KickTimer,
  type KickVelocityTarget,
} from './kick';

const { fixedStep: STEP, maxFrameDelta } = SIMULATION;
const CAR_HEIGHT = CAR.halfHeight + CAR.bodyOffset;
let initialization: Promise<void> | undefined;

export type MatchState = { red: number; blue: number; redCars: number; blueCars: number; message: string; finished: boolean };
export type KickEvent = { position: THREE.Vector3; power: number; team: 'red' | 'blue'; isPlayer: boolean };
export async function createPhysics(ball: THREE.Group, cars: THREE.Group[], input: ControlFrame, onState: (state: MatchState) => void, difficulty: Difficulty, round: number, isPlaying: () => boolean) {
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
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(car.position.x, CAR_HEIGHT, car.position.z).setCcdEnabled(true).setLinearDamping(CAR.bodyLinearDamping).setAngularDamping(CAR.angularDamping));
    body.setEnabledRotations(false, true, false, true);
    const collider = world.createCollider(RAPIER.ColliderDesc.cylinder(CAR.halfHeight, CAR.radius).setMass(CAR.mass).setFriction(CAR.friction).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(CAR.restitution).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    carColliderIndices.set(collider.handle, index);
    return body;
  });
  const impactRecovery = new Float32Array(cars.length);
  let state: MatchState = { red: 0, blue: 0, redCars: MATCH.startingCars, blueCars: opponentCars(round), message: 'Faça 3 gols para vencer', finished: false };
  const enabled = (index: number) => index === AI.playerIndex || index === AI.opponentIndex || (index === AI.redAllyIndex ? state.redCars > MATCH.startingCars : index - AI.redAllyIndex < state.blueCars);
  const spawn = CAR.spawnPositions;
  const setTeams = () => carBodies.forEach((body, index) => { const active = enabled(index); body.setEnabled(active); cars[index].visible = active; });
  let heading = cars[0].rotation.y;
  const aiHeadings = cars.map((car) => car.rotation.y);
  const opponents = cars.map(() => ({ blockedTime: 0, recoveryTime: 0, attacking: false }));
  const keyboard = createKeyboardInput(isPlaying);
  let lastKickPresses = input.kickPresses;
  const kickTimers: KickTimer[] = cars.map(() => ({ cooldown: 0, buffer: 0 }));
  const zoneTime = new Float32Array(cars.length);
  const aiKickLatched = new Array(cars.length).fill(false);
  const isActiveAttacker = new Array(cars.length).fill(false);
  const kickAimDot = kickAimDotFor(difficulty, round);
  const kickReaction = kickReactionFor(difficulty, round);
  const aiPowerFactor = kickPowerFactorFor(difficulty, round);
  let accumulator = 0;
  const stats = { safetyNetActivations: 0, stuckResets: 0, playerBallTouches: 0, playerShotsOnGoal: 0 };
  const stuck = createStuckMonitor();
  const resetPositions = () => {
    stuck.reset();
    impactRecovery.fill(0);
    opponents.forEach((opponent) => { opponent.blockedTime = 0; opponent.recoveryTime = 0; opponent.attacking = false; });
    kickTimers.forEach((timer) => { timer.cooldown = 0; timer.buffer = 0; });
    zoneTime.fill(0);
    aiKickLatched.fill(false);
    lastKickPresses = keyboard.read(input).kickPresses;
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
    snapPoses();
  };
  setTeams();
  onState({ ...state });
  const bodies = [ballBody, ...carBodies];
  const previousPoses: Pose[] = bodies.map(() => createPose());
  const currentPoses: Pose[] = bodies.map(() => createPose());
  const interpolated = createPose();
  const capturePose = (body: RAPIER.RigidBody, pose: Pose) => {
    const p = body.translation();
    const q = body.rotation();
    pose.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w]);
  };
  const snapPoses = () => bodies.forEach((body, index) => {
    capturePose(body, currentPoses[index]);
    previousPoses[index].set(currentPoses[index]);
  });
  const commitPoses = () => bodies.forEach((body, index) => {
    previousPoses[index].set(currentPoses[index]);
    capturePose(body, currentPoses[index]);
  });
  const sync = (alpha: number) => {
    interpolatePose(previousPoses[0], currentPoses[0], alpha, interpolated);
    ball.position.set(interpolated[0], interpolated[1], interpolated[2]);
    ball.quaternion.set(interpolated[3], interpolated[4], interpolated[5], interpolated[6]);
    cars.forEach((car, index) => {
      interpolatePose(previousPoses[index + 1], currentPoses[index + 1], alpha, interpolated);
      car.position.set(interpolated[0], interpolated[1] - CAR_HEIGHT, interpolated[2]);
      car.quaternion.set(interpolated[3], interpolated[4], interpolated[5], interpolated[6]);
    });
  };
  // Align the collision bodies with the cars' initial visual headings.
  carBodies.forEach((body, index) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cars[index].rotation.y);
    body.setRotation(q, true);
  });
  snapPoses();
  sync(1);
  return {
    update(delta: number, onBallHit: (position: THREE.Vector3, strength: number) => void, onKick?: (event: KickEvent) => void) {
      if (state.finished) return;
      accumulator += Math.min(delta, maxFrameDelta);
      while (accumulator >= STEP) {
        const keys = keyboard.read(input, STEP);
        const car = carBodies[AI.playerIndex];
        const velocity = car.linvel();
        const speed = velocity.x * -Math.sin(heading) + velocity.z * -Math.cos(heading);
        heading += headingDelta(keys.steer, speed, STEP);
        car.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading), true);
        const nextDirectionX = -Math.sin(heading);
        const nextDirectionZ = -Math.cos(heading);
        const lateralSpeed = velocity.x * nextDirectionZ - velocity.z * nextDirectionX;
        const grip = CAR.lateralGrip * (1 - (1 - CAR.turningGripFactor) * Math.abs(keys.steer));
        car.applyImpulse({ x: -nextDirectionZ * lateralSpeed * grip, y: 0, z: nextDirectionX * lateralSpeed * grip }, true);
        const currentSpeed = velocity.x * nextDirectionX + velocity.z * nextDirectionZ;
        const nextSpeed = nextForwardSpeed(currentSpeed, keys.throttle, STEP);
        car.applyImpulse({ x: nextDirectionX * (nextSpeed - currentSpeed) * CAR.mass, y: 0, z: nextDirectionZ * (nextSpeed - currentSpeed) * CAR.mass }, true);
        // Approach from behind the ball, then push it away from the nearest wall.
        const target = ballBody.translation();
        const ballVelocity = ballBody.linvel();
        const predictedX = THREE.MathUtils.clamp(target.x + ballVelocity.x * AI.predictionSeconds, -FIELD.goalLineX, FIELD.goalLineX);
        const predictedZ = THREE.MathUtils.clamp(target.z + ballVelocity.z * AI.predictionSeconds, -FIELD.sideWallZ + AI.wallClearance, FIELD.sideWallZ - AI.wallClearance);
        for (let index = 1; index < carBodies.length; index++) {
          isActiveAttacker[index] = false;
          if (!enabled(index)) continue;
          const opponent = carBodies[index];
          const opponentState = opponents[index];
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
          }), { x: predictedX, y: target.y, z: predictedZ }, goalX);
          const isAttacker = sameTeamCars[attackerIndex]?.carIndex === index;
          isActiveAttacker[index] = isAttacker;
          const defendX = index === AI.redAllyIndex ? -FIELD.goalLineX + AI.defenseDepth : FIELD.goalLineX - AI.defenseDepth;
          const ballThreatX = (predictedX - defendX) * (index === AI.redAllyIndex ? -1 : 1);
          const defenseDynamic = ballThreatX > 0 ? THREE.MathUtils.clamp(ballThreatX / (FIELD.goalLineX * 2), 0, AI.defenseDynamicFactor) : 0;
          const defendTargetX = defendX + (predictedX - defendX) * defenseDynamic;
          const approachX = THREE.MathUtils.clamp(isAttacker ? predictedX - directionX * AI.attackRange - directionZ * offset : defendTargetX, -FIELD.goalLineX + AI.goalClampMargin, FIELD.goalLineX - AI.goalClampMargin);
          const approachZ = THREE.MathUtils.clamp(isAttacker ? predictedZ - directionZ * AI.attackRange + directionX * offset : predictedZ * AI.defenderPositionFollowFactor + offset, -FIELD.sideWallZ + AI.wallClearance, FIELD.sideWallZ - AI.wallClearance);
          const approachDistance = Math.hypot(approachX - position.x, approachZ - position.z);
          const ballDistance = Math.hypot(predictedX - position.x, predictedZ - position.z);
          if (isAttacker && approachDistance < AI.attackerApproachDistance) opponentState.attacking = true;
          if (!isAttacker) opponentState.attacking = false;
          const sidewaysError = Math.abs((position.x - target.x) * directionZ - (position.z - target.z) * directionX);
          if (ballDistance > AI.attackingMaxBallDistance || (position.x - target.x) * directionX + (position.z - target.z) * directionZ > AI.attackingBehindPlane || (ballDistance < AI.attackingMinBallDistance && sidewaysError > AI.attackingSidewaysError)) opponentState.attacking = false;
          const dx = (opponentState.attacking ? target.x - directionX * AI.behindBallDistance : approachX) - position.x;
          const dz = (opponentState.attacking ? target.z - directionZ * AI.behindBallDistance : approachZ) - position.z;
          const desired = Math.atan2(-dx, -dz);
          const difference = Math.atan2(Math.sin(desired - aiHeadings[index]), Math.cos(desired - aiHeadings[index]));
          const velocity = opponent.linvel();
          const tryingToMove = Math.abs(difference) < AI.blockedHeadingTolerance;
          opponentState.blockedTime = tryingToMove && Math.hypot(velocity.x, velocity.z) < AI.blockedSpeed ? opponentState.blockedTime + STEP : 0;
          if (opponentState.blockedTime > AI.blockedSeconds && opponentState.recoveryTime <= 0) {
            opponentState.recoveryTime = AI.recoverySeconds;
            opponentState.blockedTime = 0;
            opponentState.attacking = false;
            const recoveryAngle = aiHeadings[index] + (Math.random() > 0.5 ? 1 : -1) * (AI.recoveryAngleRange / 2 + Math.random() * AI.recoveryAngleRange / 2);
            aiHeadings[index] = recoveryAngle;
          }
          const recovering = opponentState.recoveryTime > 0;
          opponentState.recoveryTime = Math.max(0, opponentState.recoveryTime - STEP);
          if (!recovering) aiHeadings[index] += THREE.MathUtils.clamp(difference, -AI.headingTurnRate * STEP, AI.headingTurnRate * STEP);
          opponent.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aiHeadings[index]), true);
          const aiCap = opponentSpeed(difficulty, round) * AI.speedMultiplier;
          const aggressionFactor = isAttacker ? AI.difficultyAggression[difficulty] : 1;
          const aiForward = isAttacker ? aiCap * aggressionFactor : aiCap * AI.defenderSpeedFactor;
          const steeringFactor = THREE.MathUtils.clamp(1 - Math.abs(difference) / Math.PI, AI.minSteeringFactor, 1);
          const recoveryDirection = recovering ? -1 : 1;
          const recoverySpeed = recovering ? aiCap * 0.55 : aiForward;
          const commandedSpeed = recoverySpeed * steeringFactor * recoveryDirection;
          opponent.setLinvel({
            x: -Math.sin(aiHeadings[index]) * commandedSpeed,
            y: velocity.y,
            z: -Math.cos(aiHeadings[index]) * commandedSpeed,
          }, true);
        }
        isActiveAttacker[AI.playerIndex] = true;
        const ballPos = ballBody.translation();
        const ballVel = ballBody.linvel();
        const playerPressed = keys.kickPresses > lastKickPresses;
        if (playerPressed) lastKickPresses = keys.kickPresses;
        const kickTargets: KickVelocityTarget[] = [];
        const kickEvents: KickEvent[] = [];
        for (let index = 0; index < carBodies.length; index++) {
          if (!enabled(index)) continue;
          const body = carBodies[index];
          const position = body.translation();
          const velocity = body.linvel();
          const angle = index === AI.playerIndex ? heading : aiHeadings[index];
          const inZone = isInKickZone(position.x, position.z, angle, ballPos.x, ballPos.y, ballPos.z);
          if (inZone) zoneTime[index] += STEP;
          else {
            zoneTime[index] = 0;
            aiKickLatched[index] = false;
          }
          let pressed = false;
          if (index === AI.playerIndex) {
            pressed = playerPressed;
          } else if (isActiveAttacker[index]) {
            const dir = kickDirection(angle, position.x, position.z, ballPos.x, ballPos.z);
            const attackDirX = index === AI.redAllyIndex ? 1 : -1;
            const ownGoalX = attackDirX > 0 ? -FIELD.goalLineX : FIELD.goalLineX;
            const wantsKick = zoneTime[index] >= kickReaction && shouldAiKick(
              dir.x,
              dir.z,
              attackDirX,
              ballPos.x,
              ballPos.z,
              ownGoalX,
              kickAimDot,
            );
            pressed = wantsKick && !aiKickLatched[index];
            if (wantsKick) aiKickLatched[index] = true;
          }
          const kickStep = stepKickTimer(kickTimers[index], STEP, pressed, inZone);
          kickTimers[index] = kickStep.timer;
          if (!kickStep.fire) continue;
          const powerFactor = index === AI.playerIndex ? 1 : aiPowerFactor;
          const target = computeKickTarget(
            angle,
            position.x,
            position.z,
            velocity.x,
            velocity.z,
            ballPos.x,
            ballPos.y,
            ballPos.z,
            ballVel.x,
            ballVel.y,
            ballVel.z,
            powerFactor,
          );
          if (!target) continue;
          kickTargets.push(target);
          kickEvents.push({
            position: new THREE.Vector3(ballPos.x, ballPos.y, ballPos.z),
            power: target.power,
            team: index === AI.playerIndex || index === AI.redAllyIndex ? 'red' : 'blue',
            isPlayer: index === AI.playerIndex,
          });
        }
        const resolved = resolveSimultaneousKicks(kickTargets);
        if (resolved) {
          const impulse = impulseForKickTarget(resolved, ballVel.x, ballVel.y, ballVel.z);
          ballBody.applyImpulse(impulse, true);
          if (KICK.recoil > 0) {
            // reservado para recuo futuro
          }
          const event = kickEvents.find((entry) => entry.isPlayer) ?? kickEvents[0];
          if (event?.isPlayer && isShotOnGoal(ballPos.x, ballPos.z, resolved.x, resolved.z, FIELD.goalLineX, FIELD.goalHalfWidth)) stats.playerShotsOnGoal += 1;
          if (event && onKick) onKick({ ...event, power: resolved.power });
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
            if (carColliderIndices.get(hitCar) === AI.playerIndex) stats.playerBallTouches += 1;
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
        {
          const velocity = ballBody.linvel();
          const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
          if (speed > BALL.maxSpeed && speed > 0) {
            const scale = BALL.maxSpeed / speed;
            ballBody.setLinvel({ x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale }, true);
          }
        }
        carBodies.forEach((body, index) => {
          if (impactRecovery[index] <= 0) return;
          impactRecovery[index] = Math.max(0, impactRecovery[index] - STEP);
          const velocity = body.linvel();
          const angle = index === AI.playerIndex ? heading : aiHeadings[index];
          const impulse = getLateralRecoveryImpulse(velocity.x, velocity.z, angle, CAR.mass, CAR.impactRecoveryGrip);
          body.applyImpulse({ x: impulse.x, y: 0, z: impulse.z }, true);
        });
        const positionBeforeBounds = ballBody.translation();
        const velocityBeforeBounds = ballBody.linvel();
        const boundedBall = containPlanarBody(
          positionBeforeBounds.x,
          positionBeforeBounds.z,
          velocityBeforeBounds.x,
          velocityBeforeBounds.z,
          FIELD.goalBackX - BALL.radius,
          FIELD.sideWallZ - BALL.radius,
          BALL.restitution,
        );
        if (boundedBall.x !== positionBeforeBounds.x || boundedBall.z !== positionBeforeBounds.z) {
          stats.safetyNetActivations += 1;
          ballBody.setTranslation({ x: boundedBall.x, y: positionBeforeBounds.y, z: boundedBall.z }, true);
          ballBody.setLinvel({ x: boundedBall.velocityX, y: velocityBeforeBounds.y, z: boundedBall.velocityZ }, true);
        }
        carBodies.forEach((body) => {
          const position = body.translation();
          const velocity = body.linvel();
          const bounded = containPlanarBody(
            position.x,
            position.z,
            velocity.x,
            velocity.z,
            FIELD.goalBackX - CAR.radius,
            FIELD.sideWallZ - CAR.radius,
            CAR.restitution,
          );
          if (bounded.x !== position.x || bounded.z !== position.z) {
            stats.safetyNetActivations += 1;
            body.setTranslation({ x: bounded.x, y: position.y, z: bounded.z }, true);
            body.setLinvel({ x: bounded.velocityX, y: velocity.y, z: bounded.velocityZ }, true);
          }
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
          stats.stuckResets += 1;
          resetPositions();
          state.message = 'Bola presa: jogada reiniciada no centro.';
          onState({ ...state });
          accumulator = 0;
          break;
        }
        commitPoses();
        accumulator -= STEP;
      }
      sync(accumulator / STEP);
    },
    stats,
    playerSpeed() {
      const velocity = carBodies[AI.playerIndex].linvel();
      return Math.hypot(velocity.x, velocity.z);
    },
    resetAccumulator() {
      accumulator = 0;
      keyboard.clear();
      lastKickPresses = keyboard.read(input).kickPresses;
    },
    restart() {
      state = { red: 0, blue: 0, redCars: MATCH.startingCars, blueCars: opponentCars(round), message: 'Faça 3 gols para vencer', finished: false };
      accumulator = 0; resetPositions(); sync(0); onState({ ...state });
    },
    dispose() {
      keyboard.dispose();
      events.free();
      world.free();
    },
  };
}


