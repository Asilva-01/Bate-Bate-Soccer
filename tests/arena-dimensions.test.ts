import { expect, test } from 'vitest';
import { BALL, CAR } from '../src/game/config.ts';
import {
  arenaInvariants,
  ballEnteredGoalFromSide,
  ballIsInsideArena,
  createArenaDimensions,
} from '../src/game/arena-dimensions.ts';
import { collisionGroups, COLLISION_GROUP } from '../src/game/physics-world.ts';
import { getScoringSide } from '../src/game/match-rules.ts';

const dims = createArenaDimensions();

test('arenaInvariants vazio para os valores padrão', () => {
  expect(arenaInvariants(dims, BALL, CAR)).toEqual([]);
});

test('gol cabe a bola com folga e o pico do toque fica abaixo do teto', () => {
  const depth = dims.goalBackX - dims.goalLineX;
  const diameter = BALL.radius * 2;
  expect(depth).toBeGreaterThan(diameter);
  expect(dims.goalHeight).toBeGreaterThan(diameter + 1);
});

test('collisionGroups empacota member/filter em 16+16 bits', () => {
  const groups = collisionGroups(COLLISION_GROUP.BALL, COLLISION_GROUP.FLOOR | COLLISION_GROUP.WALL);
  expect(groups >> 16).toBe(COLLISION_GROUP.BALL);
  expect(groups & 0xffff).toBe(COLLISION_GROUP.FLOOR | COLLISION_GROUP.WALL);
  const a = collisionGroups(COLLISION_GROUP.BALL, COLLISION_GROUP.WALL);
  const b = collisionGroups(COLLISION_GROUP.WALL, COLLISION_GROUP.BALL);
  expect(((a >> 16) & b) !== 0 && ((b >> 16) & a) !== 0).toBe(true);
  const floor = collisionGroups(COLLISION_GROUP.FLOOR, COLLISION_GROUP.BALL);
  const car = collisionGroups(COLLISION_GROUP.CAR, COLLISION_GROUP.WALL | COLLISION_GROUP.BALL);
  expect(((car >> 16) & floor) !== 0 && ((floor >> 16) & car) !== 0).toBe(false);
});

test('gol: bola inteira além da linha → gol; bola sobre a linha → não', () => {
  const y = BALL.radius;
  expect(getScoringSide({ x: dims.goalLineX + BALL.radius + 0.05, y, z: 0 }, dims)).toBe('blue');
  expect(getScoringSide({ x: dims.goalLineX, y, z: 0 }, dims)).toBeNull();
  expect(getScoringSide({ x: dims.goalLineX + BALL.radius - 0.2, y, z: 0 }, dims)).toBeNull();
});

test('entrada lateral no gol é ilegal; centro do campo é legal', () => {
  expect(ballIsInsideArena(0, BALL.radius, 0, BALL.radius, dims)).toBe(true);
  expect(ballEnteredGoalFromSide(dims.goalLineX + 2, BALL.radius, dims.goalHalfWidth + 2, BALL.radius, dims)).toBe(true);
  expect(ballEnteredGoalFromSide(dims.goalLineX + 2, BALL.radius, 0, BALL.radius, dims)).toBe(false);
});
