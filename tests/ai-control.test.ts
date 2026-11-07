import { expect, test } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { AI, SIMULATION } from '../src/game/config.ts';
import { applyAiControl, createAiOpponents, createAiScratch } from '../src/game/ai-control.ts';
import { createArenaDimensions } from '../src/game/arena-dimensions.ts';
import type { DriveCommand } from '../src/game/controls.ts';
import { forwardFromHeading, wrapAngle } from '../src/game/math.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { headingDelta } from '../src/game/vehicle-controller.ts';

const STEP = SIMULATION.fixedStep;
const dims = createArenaDimensions();

function fakeBody(x: number, z: number, vx = 0, vz = 0): RAPIER.RigidBody {
  return {
    translation: () => ({ x, y: 1, z }),
    linvel: () => ({ x: vx, y: 0, z: vz }),
  } as unknown as RAPIER.RigidBody;
}

function runAi(args: {
  carX: number;
  carZ: number;
  heading: number;
  ballX: number;
  ballZ: number;
  vx?: number;
  vz?: number;
  playerX?: number;
  playerZ?: number;
  opponents?: ReturnType<typeof createAiOpponents>;
  rng?: () => number;
}) {
  const bodies = [
    fakeBody(args.playerX ?? -30, args.playerZ ?? 20),
    fakeBody(args.carX, args.carZ, args.vx ?? 0, args.vz ?? 0),
  ];
  const headings = [0, args.heading];
  const commands: DriveCommand[] = [
    { throttle: 0, steer: 0, boost: false, kick: false },
    { throttle: 0, steer: 0, boost: false, kick: false },
  ];
  const isActiveAttacker = [false, false];
  const opponents = args.opponents ?? createAiOpponents(2);
  applyAiControl(
    bodies,
    fakeBody(args.ballX, args.ballZ),
    dims,
    (index) => index === 0 || index === 1,
    headings,
    opponents,
    isActiveAttacker,
    commands,
    'hard',
    1,
    STEP,
    args.rng ?? mulberry32(11),
    createAiScratch(2),
  );
  return { command: commands[1], headings, opponents, isActiveAttacker };
}

test('desired = atan2(-dx,-dz) aponta a frente (-sin h, -cos h) para o alvo', () => {
  const dx = 4;
  const dz = -9;
  const desired = Math.atan2(-dx, -dz);
  const forward = forwardFromHeading(desired);
  expect(forward.x * dx + forward.z * dz).toBeGreaterThan(0);
  expect(Math.abs(forward.x * dz - forward.z * dx)).toBeLessThan(1e-10);
});

test('carro virado para +x: alvo à esquerda/direita gera steer que aproxima o heading', () => {
  const heading = -Math.PI / 2;
  const forward = forwardFromHeading(heading);
  const speed = 8;
  const vx = forward.x * speed;
  const vz = forward.z * speed;

  const left = runAi({ carX: 0, carZ: 0, heading, ballX: 0, ballZ: -25, vx, vz });
  const right = runAi({ carX: 0, carZ: 0, heading, ballX: 0, ballZ: 25, vx, vz });

  const leftDesired = Math.atan2(-AI.attackRange, 25);
  const rightDesired = Math.atan2(-AI.attackRange, -25);
  const leftAfter = heading + headingDelta(left.command.steer, speed, STEP);
  const rightAfter = heading + headingDelta(right.command.steer, speed, STEP);

  expect(left.command.steer).toBeLessThan(0);
  expect(right.command.steer).toBeGreaterThan(0);
  expect(Math.abs(wrapAngle(leftDesired - leftAfter))).toBeLessThan(Math.abs(wrapAngle(leftDesired - heading)));
  expect(Math.abs(wrapAngle(rightDesired - rightAfter))).toBeLessThan(Math.abs(wrapAngle(rightDesired - heading)));
});

test('recuperação usa ré + steer e não teleporta o heading', () => {
  const heading = Math.PI / 2;
  const opponents = createAiOpponents(2);
  opponents[1].blockedTime = AI.blockedSeconds + STEP;
  const before = [0, heading];
  const result = runAi({
    carX: 18,
    carZ: 0,
    heading,
    ballX: 0,
    ballZ: 0,
    opponents,
    rng: mulberry32(3),
  });
  expect(result.headings[1]).toBe(before[1]);
  expect(result.command.throttle).toBeLessThan(0);
  expect(Math.abs(result.command.steer)).toBe(1);
  const reverseDelta = headingDelta(result.command.steer, -4, STEP);
  expect(Math.sign(reverseDelta)).toBe(Math.sign(result.command.steer));
});
