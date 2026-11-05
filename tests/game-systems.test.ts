import { afterAll, beforeAll, expect, test } from 'vitest';
import * as THREE from 'three';
import { BALL, CAR, FIELD } from '../src/game/config.ts';
import { createPhysics } from '../src/game/physics-runtime.ts';
import { awardGoal, getScoringSide, opponentCars, opponentSpeed, selectAttacker } from '../src/game/match-rules.ts';
import { createStuckMonitor } from '../src/game/stuck-monitor.ts';
import { getLateralRecoveryImpulse } from '../src/game/vehicle-dynamics.ts';
import { containPlanarBody } from '../src/game/arena-boundaries.ts';

const handlers = new Map<string, (event: unknown) => void>();
let physics: Awaited<ReturnType<typeof createPhysics>> | undefined;
let states: Array<{ red: number; blue: number; finished: boolean }> = [];

beforeAll(() => Object.assign(globalThis, {
  window: globalThis,
  addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
  removeEventListener: (name: string) => handlers.delete(name),
}));
afterAll(() => physics?.dispose());

test('gol exige a bola inteira dentro da abertura e da profundidade da trave', () => {
  const x = FIELD.goalLineX + BALL.radius + FIELD.scoreMargin + 0.01;
  expect(getScoringSide({ x, y: BALL.radius + BALL.bodyOffset, z: 0 })).toBe('blue');
  expect(getScoringSide({ x: -x, y: BALL.radius + BALL.bodyOffset, z: 0 })).toBe('red');
  expect(getScoringSide({ x: FIELD.goalLineX, y: BALL.radius + BALL.bodyOffset, z: 0 })).toBeNull();
  expect(getScoringSide({ x, y: BALL.radius + BALL.bodyOffset, z: FIELD.goalHalfWidth })).toBeNull();
  expect(getScoringSide({ x, y: FIELD.goalHeight, z: 0 })).toBeNull();
});

test('opponentSpeed preserva os valores por dificuldade e sobe ate o limite', () => {
  expect(opponentSpeed('easy', 1)).toBe(0.75);
  expect(opponentSpeed('medium', 1)).toBe(0.95);
  expect(opponentSpeed('hard', 1)).toBe(1.15);
  expect(opponentSpeed('easy', 10)).toBe(1.4);
});

test('opponentCars cresce a cada duas rodadas e respeita o limite', () => {
  expect([1, 2, 4, 6, 10].map(opponentCars)).toEqual([1, 2, 3, 4, 4]);
});

test('dificuldade e selecao de atacante progridem', () => {
  expect(selectAttacker([{ x: 12, y: 0, z: 0 }, { x: 2, y: 0, z: 1 }], { x: 0, y: 0, z: 0 }, -40)).toBe(1);
  expect(selectAttacker([], { x: 0, y: 0, z: 0 }, -40)).toBe(-1);
});

test('placar encerra aos tres gols e libera reforco a partir da segunda rodada', () => {
  const initial = { red: 0, blue: 0, redCars: 1, blueCars: 1, finished: false, message: '' };
  const first = awardGoal(initial, 'red', 1);
  expect([first.red, first.redCars, first.finished]).toEqual([1, 1, false]);
  const second = awardGoal(first, 'red', 2);
  expect([second.red, second.redCars, second.finished]).toEqual([2, 2, false]);
  const victory = awardGoal(second, 'red', 2);
  expect([victory.red, victory.finished]).toEqual([3, true]);
  expect(awardGoal(first, 'blue', 1).redCars).toBe(1);
});

test('detector recupera quique preso e preserva bola em movimento', () => {
  const monitor = createStuckMonitor();
  let recovered = false;
  for (let i = 0; i < 300; i++) recovered ||= monitor.update(38 + Math.sin(i / 8), 19, 1 / 60);
  expect(recovered).toBe(true);
  monitor.reset();
  for (let i = 0; i < 600; i++) expect(monitor.update(36, 16 + i / 60, 1 / 60)).toBe(false);
});

test('recuperacao apos impacto reduz derrapagem sem frear o movimento para frente', () => {
  const lateral = getLateralRecoveryImpulse(4, 0, 0, CAR.mass, CAR.impactRecoveryGrip);
  const forward = getLateralRecoveryImpulse(0, 4, 0, CAR.mass, CAR.impactRecoveryGrip);
  expect(4 * lateral.x).toBeLessThan(0);
  expect(Math.hypot(forward.x, forward.z)).toBe(0);
});

test('limites do campo mantem corpos dentro e rebate a velocidade para dentro', () => {
  expect(containPlanarBody(45, -25, 8, -4, 40, 19, 0.4)).toEqual({
    x: 40,
    z: -19,
    velocityX: -3.2,
    velocityZ: 1.6,
  });
  expect(containPlanarBody(10, 5, 2, 1, 40, 19, 0.4)).toEqual({
    x: 10,
    z: 5,
    velocityX: 2,
    velocityZ: 1,
  });
});

test('setas movem o carrinho, IA aproxima e reiniciar zera o placar', async () => {
  const ball = new THREE.Group();
  const positions = [[-18, 0], [18, 0], [-18, 9], [18, -9], [18, 9], [24, 0]];
  const cars = positions.map(([x, z], index) => {
    const car = new THREE.Group(); car.position.set(x, 0, z); car.rotation.y = index % 2 ? Math.PI / 2 : -Math.PI / 2; return car;
  });
  states = [];
  physics = await createPhysics(ball, cars, { forward: false, reverse: false, left: false, right: false }, (state) => states.push(state), 'easy', 1, () => true);
  const send = (type: string, code: string) => handlers.get(type)?.({ code, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
  send('keydown', 'ArrowLeft');
  for (let i = 0; i < 30; i++) physics?.update(1 / 60, () => {});
  send('keyup', 'ArrowLeft');
  expect(Math.abs(cars[0].rotation.y + Math.PI / 2)).toBeGreaterThan(0.1);
  send('keydown', 'ArrowUp');
  for (let i = 0; i < 120; i++) physics?.update(1 / 60, () => {});
  send('keyup', 'ArrowUp');
  expect(Math.hypot(cars[0].position.x + 18, cars[0].position.z)).toBeGreaterThan(2);
  for (let i = 0; i < 300; i++) physics.update(1 / 60, () => {});
  expect(Math.hypot(cars[1].position.x - 18, cars[1].position.z)).toBeGreaterThan(1);
  expect(Math.abs(cars[1].position.x)).toBeLessThanOrEqual(FIELD.goalBackX - CAR.radius);
  expect(Math.abs(cars[1].position.z)).toBeLessThanOrEqual(FIELD.sideWallZ - CAR.radius);
  expect(Math.abs(ball.position.x)).toBeLessThanOrEqual(FIELD.goalBackX - BALL.radius);
  expect(Math.abs(ball.position.z)).toBeLessThanOrEqual(FIELD.sideWallZ - BALL.radius);
  physics.restart();
  expect([states.at(-1)?.red, states.at(-1)?.blue, states.at(-1)?.finished]).toEqual([0, 0, false]);
  physics.dispose(); physics = undefined;
});
