import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { GAME_CONFIG } from '../src/game/game-config.ts';
import { createPhysics } from '../src/game/physics.ts';
import { awardGoal, getScoringSide, opponentCars, opponentSpeed, selectAttacker } from '../src/game/match-rules.ts';
import { createStuckMonitor } from '../src/game/stuck-monitor.ts';

const handlers = new Map<string, (event: unknown) => void>();
let physics: Awaited<ReturnType<typeof createPhysics>> | undefined;
let states: Array<{ red: number; blue: number; finished: boolean }> = [];

before(() => Object.assign(globalThis, {
  window: globalThis,
  addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
  removeEventListener: (name: string) => handlers.delete(name),
}));
after(() => physics?.dispose());

test('gol exige a bola inteira dentro da abertura e da profundidade da trave', () => {
  const { arena, ball, goals } = GAME_CONFIG;
  const x = arena.goalLineX + ball.radius + goals.scoreMargin + 0.01;
  assert.equal(getScoringSide({ x, y: 0.96, z: 0 }), 'blue');
  assert.equal(getScoringSide({ x: -x, y: 0.96, z: 0 }), 'red');
  assert.equal(getScoringSide({ x: arena.goalLineX, y: 0.96, z: 0 }), null);
  assert.equal(getScoringSide({ x, y: 0.96, z: arena.goalHalfWidth }), null);
  assert.equal(getScoringSide({ x, y: arena.goalHeight, z: 0 }), null);
});

test('dificuldade, escalacao e selecao de atacante progridem', () => {
  assert.ok(opponentSpeed('easy', 1) < opponentSpeed('medium', 1));
  assert.ok(opponentSpeed('medium', 1) < opponentSpeed('hard', 1));
  assert.ok(opponentSpeed('easy', 2) > opponentSpeed('easy', 1));
  assert.deepEqual([1, 2, 4, 6, 10].map(opponentCars), [1, 2, 3, 4, 4]);
  assert.equal(selectAttacker([{ x: 12, y: 0, z: 0 }, { x: 2, y: 0, z: 1 }], { x: 0, y: 0, z: 0 }), 1);
  assert.equal(selectAttacker([], { x: 0, y: 0, z: 0 }), -1);
});

test('placar encerra aos tres gols e libera reforco a partir da segunda rodada', () => {
  const initial = { red: 0, blue: 0, redCars: 1, blueCars: 1, finished: false, message: '' };
  const first = awardGoal(initial, 'red', 1);
  assert.deepEqual([first.red, first.redCars, first.finished], [1, 1, false]);
  const second = awardGoal(first, 'red', 2);
  assert.deepEqual([second.red, second.redCars, second.finished], [2, 2, false]);
  const victory = awardGoal(second, 'red', 2);
  assert.deepEqual([victory.red, victory.finished], [3, true]);
  assert.equal(awardGoal(first, 'blue', 1).redCars, 1);
});

test('detector recupera quique preso e preserva bola em movimento', () => {
  const monitor = createStuckMonitor();
  let recovered = false;
  for (let i = 0; i < 300; i++) recovered ||= monitor.update(38 + Math.sin(i / 8), 19, 1 / 60);
  assert.equal(recovered, true);
  monitor.reset();
  for (let i = 0; i < 600; i++) assert.equal(monitor.update(36, 16 + i / 60, 1 / 60), false);
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
  send('keydown', 'ArrowUp');
  for (let i = 0; i < 120; i++) physics?.update(1 / 60, () => {});
  send('keyup', 'ArrowUp');
  assert.ok(cars[0].position.x > -18);
  for (let i = 0; i < 300; i++) physics.update(1 / 60, () => {});
  assert.ok(cars[1].position.x < 18, 'adversary should move toward the ball during the opening');
  physics.restart();
  assert.deepEqual([states.at(-1)?.red, states.at(-1)?.blue, states.at(-1)?.finished], [0, 0, false]);
  physics.dispose(); physics = undefined;
});
