import { expect, test } from 'vitest';
import { CAR, KEYBOARD } from '../src/game/config.ts';
import { keyboardTarget, rampAxis } from '../src/game/input.ts';
import { isShotOnGoal } from '../src/game/kick.ts';
import { headingDelta, nextForwardSpeed } from '../src/game/vehicle-dynamics.ts';

const STEP = 1 / 60;
const simulate = (seconds: number, throttle: number, start = 0) => {
  let speed = start;
  for (let i = 0; i < Math.round(seconds / STEP); i++) speed = nextForwardSpeed(speed, throttle, STEP);
  return speed;
};

test('acelerador cheio chega a 90% da velocidade máxima em ~0,6 s', () => {
  expect(simulate(0.6, 1)).toBeGreaterThanOrEqual(0.89 * CAR.maxSpeed);
  expect(simulate(1, 1)).toBeLessThanOrEqual(CAR.maxSpeed);
});

test('meio acelerador estabiliza na metade da velocidade máxima', () => {
  expect(simulate(4, 0.5)).toBeCloseTo(CAR.maxSpeed / 2, 1);
  expect(simulate(4, -0.5)).toBeCloseTo(-CAR.reverseMaxSpeed / 2, 1);
});

test('freio contra o movimento é mais forte que a inércia', () => {
  const coast = simulate(0.5, 0, CAR.maxSpeed);
  const brake = simulate(0.5, -1, CAR.maxSpeed);
  expect(coast).toBeGreaterThan(0.6 * CAR.maxSpeed);
  expect(brake).toBeLessThan(0);
});

test('o resultado não depende da taxa de passos', () => {
  let coarse = 0;
  for (let i = 0; i < 30; i++) coarse = nextForwardSpeed(coarse, 1, 1 / 60);
  let fine = 0;
  for (let i = 0; i < 60; i++) fine = nextForwardSpeed(fine, 1, 1 / 120);
  expect(fine).toBeCloseTo(coarse, 6);
});

test('steer positivo vira para a direita (heading diminui) e inverte em ré', () => {
  expect(headingDelta(1, 8, STEP)).toBeLessThan(0);
  expect(headingDelta(-1, 8, STEP)).toBeGreaterThan(0);
  expect(headingDelta(1, -4, STEP)).toBeGreaterThan(0);
  expect(headingDelta(0, 8, STEP)).toBeCloseTo(0, 12);
  expect(Math.abs(headingDelta(0.5, 8, STEP))).toBeCloseTo(Math.abs(headingDelta(1, 8, STEP)) / 2, 9);
});

test('a direção fica menos ágil em alta velocidade', () => {
  expect(Math.abs(headingDelta(1, CAR.maxSpeed, STEP))).toBeCloseTo(CAR.steeringRateAtMaxSpeed * STEP, 9);
  expect(Math.abs(headingDelta(1, CAR.steeringReferenceSpeed, STEP))).toBeGreaterThan(Math.abs(headingDelta(1, CAR.maxSpeed, STEP)));
});

test('teclado sobe em rampa em vez de dar tranco', () => {
  expect(rampAxis(0, 1, KEYBOARD.steerRampPerSecond, STEP)).toBeCloseTo(KEYBOARD.steerRampPerSecond * STEP, 9);
  let value = 0;
  let steps = 0;
  while (value < 1) {
    value = rampAxis(value, 1, KEYBOARD.steerRampPerSecond, STEP);
    steps += 1;
  }
  expect(steps * STEP).toBeCloseTo(0.125, 1);
  expect(rampAxis(1, 0, KEYBOARD.steerRampPerSecond, 1)).toBe(0);
});

test('keyboardTarget combina teclas opostas e aceita WASD e setas', () => {
  expect(keyboardTarget(new Set(['KeyW', 'KeyD']))).toEqual({ throttle: 1, steer: 1 });
  expect(keyboardTarget(new Set(['ArrowDown', 'ArrowLeft']))).toEqual({ throttle: -1, steer: -1 });
  expect(keyboardTarget(new Set(['KeyW', 'ArrowDown']))).toEqual({ throttle: 0, steer: 0 });
});

test('isShotOnGoal só conta chutes que cruzam a boca do gol', () => {
  expect(isShotOnGoal(0, 0, 20, 0, 38, 7)).toBe(true);
  expect(isShotOnGoal(0, 0, 20, 10, 38, 7)).toBe(false);
  expect(isShotOnGoal(0, 0, -20, 0, 38, 7)).toBe(false);
  expect(isShotOnGoal(0, 0, 0, 20, 38, 7)).toBe(false);
});
