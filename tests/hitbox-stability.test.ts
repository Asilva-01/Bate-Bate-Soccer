import { afterAll, expect, test } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CAR, SIMULATION } from '../src/game/config.ts';
import { createArenaDimensions } from '../src/game/arena-dimensions.ts';
import { addCarToWorld, carBodyHeight, createStaticArena } from '../src/game/physics-world.ts';
import { yawQuaternion } from '../src/game/math.ts';

const dims = createArenaDimensions();
const STEP = SIMULATION.fixedStep;
let world: RAPIER.World | undefined;

afterAll(() => world?.free());

async function makeWorld() {
  await RAPIER.init();
  const next = new RAPIER.World({ x: 0, y: -SIMULATION.gravity, z: 0 });
  next.timestep = STEP;
  next.integrationParameters.numSolverIterations = SIMULATION.solverIterations;
  createStaticArena(next, dims);
  return next;
}

function pushCar(body: RAPIER.RigidBody, x: number, z: number, vx: number, vz: number, heading: number) {
  body.setTranslation({ x, y: carBodyHeight(), z }, true);
  body.setRotation(yawQuaternion(heading), true);
  body.setLinvel({ x: vx, y: 0, z: vz }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function run(body: RAPIER.RigidBody, seconds: number) {
  let maxY = carBodyHeight();
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    world!.step();
    const p = body.translation();
    const v = body.linvel();
    expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
    expect(Math.abs(p.x)).toBeLessThan(dims.goalBackX + 1);
    expect(Math.abs(p.z)).toBeLessThan(dims.sideWallZ + 1);
    maxY = Math.max(maxY, p.y);
  }
  return maxY;
}

test('roundCuboid a 30 u/s contra a parede e o chanfro: sem NaN, sem atravessar, sem quicar > 0,5 u', async () => {
  world = await makeWorld();
  const { body } = addCarToWorld(world, 0, carBodyHeight(), 0);
  pushCar(body, 0, 20, 0, 30, 0);
  const wallPeak = run(body, 3);
  expect(wallPeak).toBeLessThanOrEqual(carBodyHeight() + 0.5);
  pushCar(body, 34, 22, 20, 20, -Math.PI / 4);
  const chamferPeak = run(body, 3);
  expect(chamferPeak).toBeLessThanOrEqual(carBodyHeight() + 0.5);
}, 20_000);
