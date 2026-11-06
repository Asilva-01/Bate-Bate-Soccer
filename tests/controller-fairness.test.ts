import { afterAll, beforeAll, expect, test } from 'vitest';
import * as THREE from 'three';
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

test('o carro da IA, com o mesmo comando do jogador, tem velocidade igual (±1%) em 2 s', async () => {
  const cars = carsAt([[-18, -10, -Math.PI / 2], [-18, 10, -Math.PI / 2]]);
  const frame = createControlFrame();
  const game = await createPhysics(new THREE.Group(), cars, frame, () => {}, 'easy', 1, () => true, { humanSlots: [0, 1], seed: 1 });
  frame.throttle = 1;
  for (let i = 0; i < 120; i++) game.update(1 / 60, () => {});
  const playerTravel = Math.hypot(cars[0].position.x + 18, cars[0].position.z + 10);
  const otherTravel = Math.hypot(cars[1].position.x + 18, cars[1].position.z - 10);
  expect(game.playerSpeed()).toBeGreaterThan(15);
  expect(Math.abs(playerTravel - otherTravel) / playerTravel).toBeLessThanOrEqual(0.01);
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
