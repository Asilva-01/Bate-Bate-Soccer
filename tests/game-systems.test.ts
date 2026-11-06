import { afterAll, beforeAll, expect, test } from 'vitest';
import * as THREE from 'three';
import { BALL, CAR } from '../src/game/config.ts';
import { createPhysics } from '../src/game/physics-runtime.ts';
import { awardGoal, getScoringSide, opponentCars, opponentSpeed, selectAttacker } from '../src/game/match-rules.ts';
import { createStuckMonitor } from '../src/game/stuck-monitor.ts';
import { containPlanarBody, containSpatialBody } from '../src/game/arena-boundaries.ts';
import { createArenaDimensions } from '../src/game/arena-dimensions.ts';
import { createControlFrame } from '../src/game/input.ts';

const arena = createArenaDimensions();

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
  const x = arena.goalLineX + BALL.radius + 0.01;
  expect(getScoringSide({ x, y: BALL.radius + BALL.bodyOffset, z: 0 }, arena)).toBe('blue');
  expect(getScoringSide({ x: -x, y: BALL.radius + BALL.bodyOffset, z: 0 }, arena)).toBe('red');
  expect(getScoringSide({ x: arena.goalLineX, y: BALL.radius + BALL.bodyOffset, z: 0 }, arena)).toBeNull();
  expect(getScoringSide({ x, y: BALL.radius + BALL.bodyOffset, z: arena.goalHalfWidth }, arena)).toBeNull();
  expect(getScoringSide({ x, y: arena.goalHeight, z: 0 }, arena)).toBeNull();
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
  const monitor = createStuckMonitor(arena);
  let recovered = false;
  for (let i = 0; i < 300; i++) recovered ||= monitor.update(36 + Math.sin(i / 8), 25, 1 / 60);
  expect(recovered).toBe(true);
  monitor.reset();
  for (let i = 0; i < 600; i++) expect(monitor.update(20, 10 + i / 60, 1 / 60)).toBe(false);
});

test('bola imprensada entre os dois times dispara depois de 2,5 s', () => {
  const monitor = createStuckMonitor(arena);
  const cars = [
    { x: 1, z: 0, team: 'red' as const },
    { x: -1, z: 0, team: 'blue' as const },
  ];
  let lifted = false;
  for (let i = 0; i < 160; i++) lifted ||= monitor.updatePinch({ x: 0, z: 0, speed: 0.2 }, cars, 1 / 60);
  expect(lifted).toBe(true);
  monitor.reset();
  for (let i = 0; i < 200; i++) {
    expect(monitor.updatePinch({ x: 0, z: 0, speed: 0.2 }, [{ x: 1, z: 0, team: 'red' }], 1 / 60)).toBe(false);
  }
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
  expect(containSpatialBody(0, 22, 0, 0, 4, 0, 40, 28, 1.7, 18.3, 0.72)).toMatchObject({
    y: 18.3,
    velocityY: -4 * 0.72,
  });
});

test('setas movem o carrinho, IA aproxima e reiniciar zera o placar', async () => {
  const ball = new THREE.Group();
  const positions = [[-18, 0], [18, 0], [-18, 9], [18, -9], [18, 9], [24, 0]];
  const cars = positions.map(([x, z], index) => {
    const car = new THREE.Group(); car.position.set(x, 0, z); car.rotation.y = index % 2 ? Math.PI / 2 : -Math.PI / 2; return car;
  });
  states = [];
  physics = await createPhysics(ball, cars, createControlFrame(), (state) => states.push(state), 'easy', 1, () => true);
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
  expect(Math.abs(cars[1].position.x)).toBeLessThanOrEqual(arena.goalBackX - CAR.radius + 0.3);
  expect(Math.abs(cars[1].position.z)).toBeLessThanOrEqual(arena.sideWallZ - CAR.radius + 0.3);
  expect(Math.abs(ball.position.x)).toBeLessThanOrEqual(arena.goalBackX - BALL.radius + 0.3);
  expect(Math.abs(ball.position.z)).toBeLessThanOrEqual(arena.sideWallZ - BALL.radius + 0.3);
  physics.restart();
  expect([states.at(-1)?.red, states.at(-1)?.blue, states.at(-1)?.finished]).toEqual([0, 0, false]);
  physics.dispose(); physics = undefined;
});

test('acelerador cheio em linha reta passa de 13,5 u/s em até 1 s', async () => {
  const ball = new THREE.Group();
  const cars = [[-18, 0], [18, 0]].map(([x, z], index) => {
    const car = new THREE.Group(); car.position.set(x, 0, z); car.rotation.y = index % 2 ? Math.PI / 2 : -Math.PI / 2; return car;
  });
  const frame = createControlFrame();
  const game = await createPhysics(ball, cars, frame, () => {}, 'easy', 1, () => true);
  frame.throttle = 1;
  let reachedAt = Infinity;
  let peak = 0;
  for (let step = 1; step <= 120; step++) {
    game.update(1 / 60, () => {});
    const speed = game.playerSpeed();
    peak = Math.max(peak, speed);
    if (speed >= 13.5 && reachedAt === Infinity) reachedAt = step / 60;
  }
  expect(reachedAt).toBeLessThanOrEqual(1);
  expect(peak).toBeLessThanOrEqual(CAR.maxSpeed + 1e-6);
  expect(Math.abs(cars[0].position.z)).toBeLessThan(0.05);
  game.dispose();
});

test('direção analógica: steer parcial gira menos que o total e para a direita diminui o heading', async () => {
  const turned = async (steer: number) => {
    const cars = [[-18, 0], [18, 0]].map(([x, z], index) => {
      const car = new THREE.Group(); car.position.set(x, 0, z); car.rotation.y = index % 2 ? Math.PI / 2 : -Math.PI / 2; return car;
    });
    const frame = createControlFrame();
    const game = await createPhysics(new THREE.Group(), cars, frame, () => {}, 'easy', 1, () => true);
    frame.throttle = 0.6;
    frame.steer = steer;
    for (let step = 0; step < 45; step++) game.update(1 / 60, () => {});
    const q = cars[0].quaternion;
    game.dispose();
    return 2 * Math.atan2(q.y, q.w) + Math.PI / 2;
  };
  const half = await turned(0.5);
  const full = await turned(1);
  expect(full).toBeLessThan(-0.3);
  expect(Math.abs(half)).toBeLessThan(Math.abs(full));
  expect(half).toBeLessThan(0);
});

test('interpolação entre passos: a pose visual fica entre o passo anterior e o atual', async () => {
  const cars = [[-18, 0], [18, 0]].map(([x, z], index) => {
    const car = new THREE.Group(); car.position.set(x, 0, z); car.rotation.y = index % 2 ? Math.PI / 2 : -Math.PI / 2; return car;
  });
  const frame = createControlFrame();
  const game = await createPhysics(new THREE.Group(), cars, frame, () => {}, 'easy', 1, () => true);
  frame.throttle = 1;
  for (let step = 0; step < 30; step++) game.update(1 / 60, () => {});
  const whole = cars[0].position.x;
  game.update(1 / 60 * 0.5, () => {});
  const half = cars[0].position.x;
  game.update(1 / 60 * 0.5, () => {});
  const next = cars[0].position.x;
  expect(half).toBeGreaterThan(whole);
  expect(half).toBeLessThan(next);
  game.dispose();
});
