import { afterAll, beforeAll, expect, test } from 'vitest';
import * as THREE from 'three';
import { CAR } from '../src/game/config.ts';
import { createPhysics } from '../src/game/physics-runtime.ts';
import { createControlFrame } from '../src/game/input.ts';

const handlers = new Map<string, (event: unknown) => void>();

beforeAll(() => Object.assign(globalThis, {
  window: globalThis,
  addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
  removeEventListener: (name: string) => handlers.delete(name),
}));

afterAll(() => handlers.clear());

function carsAt(positions: Array<[number, number, number]>) {
  return positions.map(([x, z, heading]) => {
    const car = new THREE.Group();
    car.position.set(x, 0, z);
    car.rotation.y = heading;
    return car;
  });
}

test('o caminho real da IA usa o mesmo controlador: vira para a bola e não passa da velocidade máxima', async () => {
  const cars = carsAt([[-18, 0, -Math.PI / 2], [18, 0, 0]]);
  const frame = createControlFrame();
  const game = await createPhysics(new THREE.Group(), cars, frame, () => {}, 'easy', 1, () => true, { humanSlots: [0], seed: 1 });
  const startX = cars[1].position.x;
  const startZ = cars[1].position.z;
  for (let i = 0; i < 120; i++) game.update(1 / 60, () => {});
  const travel = Math.hypot(cars[1].position.x - startX, cars[1].position.z - startZ);
  expect(travel).toBeGreaterThan(6);
  expect(travel).toBeLessThanOrEqual(CAR.maxSpeed * 2 + 0.5);
  expect(cars[1].position.x).toBeLessThan(startX);
  expect(game.stats.carSetLinvel).toBe(0);
  game.dispose();
}, 20_000);

test('justiça: 5 s de IA em campo aberto não chamam setLinvel nos carros', async () => {
  const cars = carsAt([[-8, 0, -Math.PI / 2], [8, 0, Math.PI / 2]]);
  const frame = createControlFrame();
  const game = await createPhysics(new THREE.Group(), cars, frame, () => {}, 'medium', 1, () => true, { seed: 7 });
  for (let i = 0; i < 300; i++) game.update(1 / 60, () => {});
  expect(game.stats.carSetLinvel).toBe(0);
  game.dispose();
}, 20_000);
