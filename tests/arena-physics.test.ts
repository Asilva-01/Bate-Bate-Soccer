import { afterAll, expect, test } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL, SAFETY, SIMULATION } from '../src/game/config.ts';
import {
  ballEnteredGoalFromSide,
  createArenaDimensions,
} from '../src/game/arena-dimensions.ts';
import { addBallToWorld, createStaticArena } from '../src/game/physics-world.ts';
import { ballSafetyBounds, containWithSafetyBounds } from '../src/game/arena-boundaries.ts';
import { mulberry32 } from '../src/game/rng.ts';

const dims = createArenaDimensions();
const STEP = SIMULATION.fixedStep;

test('ballSafetyBounds usa o knob SAFETY.tolerance', () => {
  const loose = ballSafetyBounds(dims);
  const same = ballSafetyBounds(dims, BALL, SAFETY.tolerance);
  const tight = ballSafetyBounds(dims, BALL, 0);
  expect(loose).toEqual(same);
  expect(tight.maxX).toBe(loose.maxX - SAFETY.tolerance);
  expect(tight.minY).toBe(loose.minY + SAFETY.tolerance);
});
let world: RAPIER.World | undefined;

async function arenaWorld() {
  await RAPIER.init();
  const next = new RAPIER.World({ x: 0, y: -SIMULATION.gravity, z: 0 });
  next.timestep = STEP;
  next.integrationParameters.numSolverIterations = SIMULATION.solverIterations;
  createStaticArena(next, dims);
  return next;
}

afterAll(() => {
  world?.free();
});

async function launchBalls(tolerance: number) {
  const launchWorld = await arenaWorld();
  const { body } = addBallToWorld(launchWorld);
  const rng = mulberry32(20261106);
  const bounds = ballSafetyBounds(dims, BALL, tolerance);
  let sideEntries = 0;
  let outside = 0;
  let safety = 0;
  const samples = 200;
  const steps = Math.round(5 / STEP);
  for (let sample = 0; sample < samples; sample++) {
    const z = 2 * rng() - 1;
    const theta = 2 * Math.PI * rng();
    const planar = Math.sqrt(Math.max(0, 1 - z * z));
    const dirX = planar * Math.cos(theta);
    const dirY = z;
    const dirZ = planar * Math.sin(theta);
    body.setTranslation({ x: 0, y: 8, z: 0 }, true);
    body.setLinvel({ x: dirX * BALL.maxSpeed, y: dirY * BALL.maxSpeed, z: dirZ * BALL.maxSpeed }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let step = 0; step < steps; step++) {
      launchWorld.step();
      const velocity = body.linvel();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      if (speed > BALL.maxSpeed && speed > 0) {
        const scale = BALL.maxSpeed / speed;
        body.setLinvel({ x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale }, true);
      }
      const position = body.translation();
      const bounded = containWithSafetyBounds(
        position.x,
        position.y,
        position.z,
        velocity.x,
        velocity.y,
        velocity.z,
        bounds,
        BALL.restitution,
      );
      if (bounded.x !== position.x || bounded.y !== position.y || bounded.z !== position.z) safety += 1;
      const inBox = Math.abs(position.x) <= dims.goalBackX + 0.6
        && Math.abs(position.z) <= dims.sideWallZ + 0.6
        && position.y >= -0.5
        && position.y <= dims.ceilingY + 0.6;
      if (!inBox) outside += 1;
      if (ballEnteredGoalFromSide(position.x, position.y, position.z, BALL.radius, dims)) sideEntries += 1;
    }
  }
  launchWorld.free();
  return { outside, sideEntries, safety };
}

test('bola lançada a 45 u/s em 200 direções (semente fixa) permanece na arena', async () => {
  const result = await launchBalls(SAFETY.tolerance);
  world = undefined;
  expect(result.outside).toBe(0);
  expect(result.sideEntries).toBe(0);
  expect(result.safety).toBe(0);
}, 60_000);

test('com tolerância 0 a rede registra overshoot real, com teto explícito', async () => {
  const result = await launchBalls(0);
  expect(result.outside).toBe(0);
  expect(result.sideEntries).toBe(0);
  expect(result.safety).toBeGreaterThan(0);
  expect(result.safety).toBeLessThan(2000);
}, 60_000);

test('bola solta do centro a 10 u quica a ≥ 5,4 u', async () => {
  const bounceWorld = await arenaWorld();
  const { body } = addBallToWorld(bounceWorld);
  body.setTranslation({ x: 0, y: 10, z: 0 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  let falling = false;
  let rising = false;
  let peak = 0;
  for (let step = 0; step < 240; step++) {
    bounceWorld.step();
    const y = body.translation().y;
    const vy = body.linvel().y;
    if (!falling && vy < -0.5) falling = true;
    if (falling && !rising && vy > 0.2) {
      rising = true;
      peak = y;
    }
    if (rising) {
      peak = Math.max(peak, y);
      if (vy < 0) break;
    }
  }
  bounceWorld.free();
  expect(rising).toBe(true);
  expect(peak).toBeGreaterThanOrEqual(5.4);
});
