import RAPIER from '@dimforge/rapier3d-compat';
import { aiMaxSpeed, opponentCars, type Difficulty, type ScoreState } from './match-rules';
import { createStuckMonitor } from './stuck-monitor';
import { AI, BALL, CAR, MATCH, SIMULATION } from './config';
import { createKeyboardInput, type ControlFrame } from './input';
import { createPose, type Pose } from './render-interpolation';
import { createArenaDimensions } from './arena-dimensions';
import { addBallToWorld, addCarToWorld, carBodyHeight, createStaticArena } from './physics-world';
import { kickAimDotFor, kickPowerFactorFor, kickReactionFor, type KickTimer } from './kick';
import { setVec3, yawQuaternion } from './math';
import { applyAiControl, createAiOpponents, createAiScratch, resetAiOpponents } from './ai-control';
import { applyKicks, resetKickState, type KickEvent, type KickStepState } from './kick-step';
import { handleCollisionEvents } from './collision-events';
import { applyArenaSafety, clampBodySpeeds } from './arena-safety';
import { applyGoalToState, applyMatchEvents, createMatchScratch } from './match-events';
import { syncVisuals, type VisualObject } from './visual-sync';
import { mulberry32 } from './rng';
import { driveCommandFromFrame, type DriveCommand } from './controls';
import { isGrounded, stepVehicle } from './vehicle-controller';
import { createTurboState, stepTurbo, type TurboState } from './turbo';

const { fixedStep: STEP, maxFrameDelta } = SIMULATION;
const CAR_HEIGHT = carBodyHeight();
let initialization: Promise<void> | undefined;

export type MatchState = ScoreState;
export type { KickEvent };
export type PhysicsOptions = { seed?: number; humanSlots?: number[] };

const translationScratch = { x: 0, y: 0, z: 0 };
const linvelScratch = { x: 0, y: 0, z: 0 };
const angvelScratch = { x: 0, y: 0, z: 0 };
const rotationScratch = { x: 0, y: 0, z: 0, w: 1 };
const impulseScratch = { x: 0, y: 0, z: 0 };

export async function createPhysics(
  ball: VisualObject,
  cars: VisualObject[],
  input: ControlFrame,
  onState: (state: MatchState) => void,
  difficulty: Difficulty,
  round: number,
  isPlaying: () => boolean,
  options?: PhysicsOptions,
) {
  initialization ??= RAPIER.init();
  await initialization;
  const dims = createArenaDimensions();
  const world = new RAPIER.World({ x: 0, y: -SIMULATION.gravity, z: 0 });
  world.timestep = STEP;
  world.integrationParameters.numSolverIterations = SIMULATION.solverIterations;
  createStaticArena(world, dims);
  const { body: ballBody, collider: ballCollider } = addBallToWorld(world);
  ballBody.setTranslation(setVec3(translationScratch, ball.position.x, BALL.radius + BALL.bodyOffset, ball.position.z), true);
  const events = new RAPIER.EventQueue(true);
  const carColliderIndices = new Map<number, number>();
  const carBodies = cars.map((car, index) => {
    const { body, collider } = addCarToWorld(world, car.position.x, CAR_HEIGHT, car.position.z);
    carColliderIndices.set(collider.handle, index);
    return body;
  });
  const impactRecovery = new Float32Array(cars.length);
  let state: MatchState = { red: 0, blue: 0, redCars: MATCH.startingCars, blueCars: opponentCars(round), message: 'Faça 3 gols para vencer', finished: false };
  const enabled = (index: number) => index === AI.playerIndex || index === AI.opponentIndex || (index === AI.redAllyIndex ? state.redCars > MATCH.startingCars : index - AI.redAllyIndex < state.blueCars);
  const spawn = CAR.spawnPositions;
  const setTeams = () => carBodies.forEach((body, index) => { const active = enabled(index); body.setEnabled(active); cars[index].visible = active; });
  const headings = cars.map((car) => car.rotation.y);
  const opponents = createAiOpponents(cars.length);
  const aiScratch = createAiScratch(cars.length);
  const matchScratch = createMatchScratch(cars.length);
  const rng = mulberry32(options?.seed ?? AI.seed);
  const humanSlots = new Set(options?.humanSlots ?? [AI.playerIndex]);
  const commands: DriveCommand[] = cars.map(() => ({ throttle: 0, steer: 0, boost: false, kick: false }));
  const turboStates: TurboState[] = cars.map(() => createTurboState());
  const carVelocitiesBefore = Array.from({ length: cars.length }, () => ({ x: 0, y: 0, z: 0 }));
  const ballVelocityBefore = { x: 0, y: 0, z: 0 };
  const keyboard = createKeyboardInput(isPlaying);
  const kickState: KickStepState = {
    kickTimers: cars.map((): KickTimer => ({ cooldown: 0, buffer: 0 })),
    zoneTime: new Float32Array(cars.length),
    dashRemaining: new Float32Array(cars.length),
    aiKickLatched: new Array(cars.length).fill(false),
    lastKickPresses: input.kickPresses,
  };
  const isActiveAttacker = new Array(cars.length).fill(false);
  const kickAimDot = kickAimDotFor(difficulty, round);
  const kickReaction = kickReactionFor(difficulty, round);
  const aiPowerFactor = kickPowerFactorFor(difficulty, round);
  let accumulator = 0;
  let writingLimits = false;
  let playerBoosting = false;
  let playerTurboMeter = turboStates[0].meter;
  let playerGrounded = true;
  let turboEmptyPulse = false;
  const stats = { safetyNetActivations: 0, stuckResets: 0, playerBallTouches: 0, playerShotsOnGoal: 0, carSetLinvel: 0 };
  for (const body of carBodies) {
    const original = body.setLinvel.bind(body);
    body.setLinvel = ((vel: { x: number; y: number; z: number }, wake?: boolean) => {
      if (!writingLimits) stats.carSetLinvel += 1;
      original(vel, wake ?? true);
    }) as typeof body.setLinvel;
  }
  const withLimits = (fn: () => void) => {
    writingLimits = true;
    fn();
    writingLimits = false;
  };
  const stuck = createStuckMonitor();
  const resetTurbo = () => {
    turboStates.forEach((_, index) => { turboStates[index] = createTurboState(); });
    playerTurboMeter = turboStates[0].meter;
    playerBoosting = false;
    turboEmptyPulse = false;
  };
  const resetPositions = () => {
    stuck.reset();
    impactRecovery.fill(0);
    resetAiOpponents(opponents);
    resetKickState(kickState);
    resetTurbo();
    kickState.lastKickPresses = keyboard.read(input).kickPresses;
    withLimits(() => {
      ballBody.setTranslation(setVec3(translationScratch, 0, BALL.radius + BALL.bodyOffset, 0), true);
      ballBody.setLinvel(setVec3(linvelScratch, 0, 0, 0), true);
      ballBody.setAngvel(setVec3(angvelScratch, 0, 0, 0), true);
      carBodies.forEach((body, index) => {
        headings[index] = index === AI.playerIndex || index === AI.redAllyIndex ? -Math.PI / 2 : Math.PI / 2;
        body.setRotation(yawQuaternion(headings[index], rotationScratch), true);
        body.setTranslation(setVec3(translationScratch, spawn[index].x, CAR_HEIGHT, spawn[index].z), true);
        body.setLinvel(setVec3(linvelScratch, 0, 0, 0), true);
        body.setAngvel(setVec3(angvelScratch, 0, 0, 0), true);
      });
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
    pose[0] = p.x; pose[1] = p.y; pose[2] = p.z;
    pose[3] = q.x; pose[4] = q.y; pose[5] = q.z; pose[6] = q.w;
  };
  const snapshotVelocities = () => {
    const ballVel = ballBody.linvel();
    setVec3(ballVelocityBefore, ballVel.x, ballVel.y, ballVel.z);
    for (let index = 0; index < carBodies.length; index++) {
      const velocity = carBodies[index].linvel();
      setVec3(carVelocitiesBefore[index], velocity.x, velocity.y, velocity.z);
    }
  };
  const aiMax = aiMaxSpeed(difficulty, round);
  const aiDriveParams = { ...CAR, maxSpeed: aiMax, boostMaxSpeed: aiMax, reverseMaxSpeed: Math.min(CAR.reverseMaxSpeed, aiMax) };
  const applyDrive = (index: number, command: DriveCommand) => {
    const body = carBodies[index];
    const velocity = body.linvel();
    const position = body.translation();
    const turbo = stepTurbo(turboStates[index], command.boost, STEP);
    turboStates[index] = turbo.state;
    const grounded = isGrounded(position.y, velocity.y);
    const driveParams = humanSlots.has(index) ? CAR : aiDriveParams;
    const step = stepVehicle({
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
      y: position.y,
      heading: headings[index],
      grounded,
      boost: turbo.state.meter,
      dashTime: 0,
      kickCooldown: 0,
    }, { ...command, boost: humanSlots.has(index) && turbo.active }, STEP, driveParams);
    headings[index] = step.heading;
    body.setRotation(yawQuaternion(step.heading, rotationScratch), true);
    setVec3(impulseScratch, step.impulse.x, step.impulse.y, step.impulse.z);
    body.applyImpulse(impulseScratch, true);
    if (index === AI.playerIndex) {
      if (playerTurboMeter > 0 && turbo.state.meter <= 0) turboEmptyPulse = true;
      playerTurboMeter = turbo.state.meter;
      playerBoosting = turbo.active;
      playerGrounded = grounded;
    }
  };
  const snapPoses = () => bodies.forEach((body, index) => {
    capturePose(body, currentPoses[index]);
    previousPoses[index].set(currentPoses[index]);
  });
  const commitPoses = () => bodies.forEach((body, index) => {
    previousPoses[index].set(currentPoses[index]);
    capturePose(body, currentPoses[index]);
  });
  const sync = (alpha: number) => syncVisuals(ball, cars, previousPoses, currentPoses, interpolated, alpha, CAR_HEIGHT);
  carBodies.forEach((body, index) => {
    body.setRotation(yawQuaternion(cars[index].rotation.y, rotationScratch), true);
  });
  snapPoses();
  sync(1);
  return {
    update(delta: number, onBallHit: (position: KickEvent['position'], strength: number) => void, onKick?: (event: KickEvent) => void) {
      if (state.finished) return;
      accumulator += Math.min(delta, maxFrameDelta);
      while (accumulator >= STEP) {
        // 5.9: 1. ler ControlFrame e consumir apertos
        const keys = keyboard.read(input, STEP);
        const { command: playerCommand } = driveCommandFromFrame(keys, kickState.lastKickPresses);
        // 5.9: 2. IA produz DriveCommand
        applyAiControl(carBodies, ballBody, dims, enabled, headings, opponents, isActiveAttacker, commands, difficulty, round, STEP, rng, aiScratch);
        // 5.9: 3. stepTurbo e stepVehicle para todos
        for (let index = 0; index < carBodies.length; index++) {
          if (!enabled(index)) continue;
          applyDrive(index, humanSlots.has(index) ? playerCommand : commands[index]);
        }
        // 5.9: 4. toques / chute
        applyKicks(
          carBodies,
          ballBody,
          headings,
          enabled,
          isActiveAttacker,
          kickState,
          keys.kickPresses,
          dims,
          kickAimDot,
          kickReaction,
          aiPowerFactor,
          STEP,
          stats,
          onKick,
        );
        // 5.9: 5. world.step
        snapshotVelocities();
        world.step(events);
        // 5.9: 6. colisões, limites, rede de segurança
        handleCollisionEvents(events, carBodies, carColliderIndices, ballBody, ballCollider.handle, carVelocitiesBefore, ballVelocityBefore, impactRecovery, stats, onBallHit);
        withLimits(() => {
          clampBodySpeeds(carBodies, ballBody);
          applyArenaSafety(carBodies, ballBody, dims, stats);
        });
        // 5.9: 7. gol e bola presa
        const matchEvent = applyMatchEvents(carBodies, ballBody, dims, enabled, stuck, STEP, stats, matchScratch);
        if (matchEvent?.kind === 'goal') {
          state = applyGoalToState(state, matchEvent.scoringSide, round);
          resetPositions();
          onState({ ...state });
          accumulator = 0;
          break;
        }
        if (matchEvent?.kind === 'stuck') {
          resetPositions();
          state.message = 'Bola presa: jogada reiniciada no centro.';
          onState({ ...state });
          accumulator = 0;
          break;
        }
        // 5.9: 8. poses para interpolação
        commitPoses();
        accumulator -= STEP;
      }
      sync(accumulator / STEP);
    },
    stats,
    carSpeed(index: number) {
      const velocity = carBodies[index].linvel();
      return Math.hypot(velocity.x, velocity.z);
    },
    playerSpeed() {
      const velocity = carBodies[AI.playerIndex].linvel();
      return Math.hypot(velocity.x, velocity.z);
    },
    playerKinematics() {
      const body = carBodies[AI.playerIndex];
      const velocity = body.linvel();
      const position = body.translation();
      return {
        x: position.x,
        z: position.z,
        heading: headings[AI.playerIndex],
        vx: velocity.x,
        vz: velocity.z,
        speed: Math.hypot(velocity.x, velocity.z),
      };
    },
    playerTurbo() {
      const pulse = turboEmptyPulse;
      turboEmptyPulse = false;
      return { meter: playerTurboMeter, active: playerBoosting, grounded: playerGrounded, emptyPulse: pulse };
    },
    dashRemaining() {
      return kickState.dashRemaining;
    },
    resetAccumulator() {
      accumulator = 0;
      keyboard.clear();
      kickState.lastKickPresses = keyboard.read(input).kickPresses;
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
