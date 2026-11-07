import { afterAll, beforeAll, expect, test } from 'vitest';
import * as THREE from 'three';
import { AI, CAR, SIMULATION } from '../src/game/config.ts';
import { createControlFrame } from '../src/game/input.ts';
import { aiMaxSpeed } from '../src/game/match-rules.ts';
import { createPhysics } from '../src/game/physics-runtime.ts';
import type { Difficulty } from '../src/game/match-rules.ts';

const STEP = SIMULATION.fixedStep;
const handlers = new Map<string, (event: unknown) => void>();

beforeAll(() => Object.assign(globalThis, {
  window: globalThis,
  addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
  removeEventListener: (name: string) => handlers.delete(name),
}));

afterAll(() => handlers.clear());

function carsForSpeedRun() {
  return [[-30, 20, -Math.PI / 2], [18, 0, Math.PI / 2]].map(([x, z, heading]) => {
    const car = new THREE.Group();
    car.position.set(x, 0, z);
    car.rotation.y = heading;
    return car;
  });
}

async function peakAiSpeed(difficulty: Difficulty) {
  const cars = carsForSpeedRun();
  const ball = new THREE.Group();
  const game = await createPhysics(ball, cars, createControlFrame(), () => {}, difficulty, 1, () => true, {
    humanSlots: [0],
    seed: 21,
  });
  let peak = 0;
  for (let i = 0; i < Math.round(0.75 / STEP); i++) {
    game.update(STEP, () => {});
    peak = Math.max(peak, game.carSpeed(AI.opponentIndex));
  }
  game.dispose();
  return peak;
}

test('no fácil a velocidade máxima da IA fica abaixo do limite configurado', async () => {
  const peak = await peakAiSpeed('easy');
  expect(peak).toBeGreaterThan(4);
  expect(peak).toBeLessThanOrEqual(aiMaxSpeed('easy') + 0.15);
}, 20_000);

test('difícil > médio > fácil em velocidade de ponta da IA', async () => {
  const easy = await peakAiSpeed('easy');
  const medium = await peakAiSpeed('medium');
  const hard = await peakAiSpeed('hard');
  expect(hard).toBeGreaterThan(medium);
  expect(medium).toBeGreaterThan(easy);
  expect(hard).toBeLessThanOrEqual(CAR.maxSpeed + 0.2);
  expect(hard).toBeGreaterThan(0.7 * CAR.maxSpeed);
}, 20_000);
