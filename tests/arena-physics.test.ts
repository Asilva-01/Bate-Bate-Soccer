import { afterAll, expect, test } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL, SIMULATION } from '../src/game/config.ts';
import {
  ballEnteredGoalFromSide,
  createArenaDimensions,
} from '../src/game/arena-dimensions.ts';
import { addBallToWorld, createStaticArena } from '../src/game/physics-world.ts';
import { containSpatialBody } from '../src/game/arena-boundaries.ts';

const dims = createArenaDimensions();
const STEP = SIMULATION.fixedStep;
let world: RAPIER.World | undefined;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

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

test('bola lançada a 45 u/s em 200 direções (semente fixa) permanece na arena', async () => {
  world = await arenaWorld();
  const { body } = addBallToWorld(world);
  const rng = mulberry32(20261106);
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
      world.step();
      const velocity = body.linvel();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      if (speed > BALL.maxSpeed && speed > 0) {
        const scale = BALL.maxSpeed / speed;
        body.setLinvel({ x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale }, true);
      }
      const position = body.translation();
      const bounded = containSpatialBody(
        position.x,
        position.y,
        position.z,
        velocity.x,
        velocity.y,
        velocity.z,
          dims.goalBackX - BALL.radius + 0.8,
          dims.sideWallZ - BALL.radius + 0.8,
          BALL.radius - 0.8,
          dims.ceilingY - BALL.radius + 0.8,
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
  expect(outside).toBe(0);
  expect(sideEntries).toBe(0);
  expect(safety).toBe(0);
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
