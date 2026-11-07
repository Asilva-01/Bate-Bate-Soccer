import { afterAll, beforeAll, expect, test } from 'vitest';
import * as THREE from 'three';
import { BALL, CAR, SIMULATION } from '../src/game/config.ts';
import { createArenaDimensions } from '../src/game/arena-dimensions.ts';
import { createControlFrame } from '../src/game/input.ts';
import { createPhysics } from '../src/game/physics-runtime.ts';

const STEP = SIMULATION.fixedStep;
const MAX_SECONDS = 5;
const MAX_STUCK_SECONDS = 2.5;
const TOUCH_DISTANCE = CAR.hitbox.halfLength + BALL.radius + 1.2;
const dims = createArenaDimensions();
const handlers = new Map<string, (event: unknown) => void>();

beforeAll(() => Object.assign(globalThis, {
  window: globalThis,
  addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
  removeEventListener: (name: string) => handlers.delete(name),
}));

afterAll(() => handlers.clear());

function nearWall(x: number, z: number, margin = 3.2) {
  return Math.abs(z) > dims.sideWallZ - margin
    || Math.abs(x) > dims.goalLineX - margin
    || Math.abs(x) + Math.abs(z) > dims.goalLineX + dims.sideWallZ - dims.cornerChamfer - margin;
}

function carsAt(aiHeading: number) {
  return [[-18, 0, -Math.PI / 2], [18, 0, aiHeading]].map(([x, z, heading]) => {
    const car = new THREE.Group();
    car.position.set(x, 0, z);
    car.rotation.y = heading;
    return car;
  });
}

const ballPositions = [
  { name: 'centro', x: 0, z: 0 },
  { name: 'canto +x+z', x: 32, z: 20 },
  { name: 'canto +x-z', x: 32, z: -20 },
  { name: 'canto -x+z', x: -32, z: 20 },
  { name: 'canto -x-z', x: -32, z: -20 },
  { name: 'lateral +z', x: 0, z: 24 },
  { name: 'lateral -z', x: 0, z: -24 },
] as const;

const headings = [
  { name: 'frente ao gol', heading: Math.PI / 2 },
  { name: 'de lado', heading: 0 },
  { name: 'de costas', heading: -Math.PI / 2 },
] as const;

const cases = ballPositions.flatMap((ball, ballIndex) => headings.map((facing, headingIndex) => ({
  name: `${ball.name}, ${facing.name}`,
  ball,
  heading: facing.heading,
  seed: 17 + ballIndex * 10 + headingIndex,
})));

test.each(cases)('IA azul toca a bola e não cola na parede ($name)', async ({ ball, heading, seed }) => {
  const cars = carsAt(heading);
  const ballMesh = new THREE.Group();
  ballMesh.position.set(ball.x, 0, ball.z);
  const frame = createControlFrame();
  let scored = false;
  const game = await createPhysics(
    ballMesh,
    cars,
    frame,
    (state) => { if (state.red > 0 || state.blue > 0) scored = true; },
    'hard',
    1,
    () => true,
    { humanSlots: [0], seed },
  );

  let touched = false;
  let stuckSeconds = 0;
  let maxStuck = 0;
  const steps = Math.round(MAX_SECONDS / STEP);
  for (let i = 0; i < steps; i++) {
    game.update(STEP, () => {});
    if (scored) touched = true;
    const ai = cars[1].position;
    const distance = Math.hypot(ai.x - ballMesh.position.x, ai.z - ballMesh.position.z);
    if (distance <= TOUCH_DISTANCE) touched = true;
    const glued = nearWall(ai.x, ai.z) && distance > TOUCH_DISTANCE;
    stuckSeconds = glued ? stuckSeconds + STEP : 0;
    maxStuck = Math.max(maxStuck, stuckSeconds);
    if (touched && maxStuck > MAX_STUCK_SECONDS) break;
  }
  game.dispose();
  expect(touched).toBe(true);
  expect(maxStuck).toBeLessThanOrEqual(MAX_STUCK_SECONDS);
}, 20_000);
