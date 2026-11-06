import { expect, test } from 'vitest';
import { BALL, CAR, KICK } from '../src/game/config.ts';
import { createArenaDimensions } from '../src/game/arena-dimensions.ts';
import {
  computeKickTarget,
  impulseForKickTarget,
  isInKickZone,
  kickApex,
  kickDirection,
  resolveSimultaneousKicks,
  stepKickTimer,
} from '../src/game/kick.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import { SIMULATION } from '../src/game/config.ts';

const heading = -Math.PI / 2;
const carX = 0;
const carZ = 0;

test('bola parada na frente do carrinho gera velocidade e direção esperadas', () => {
  const ballX = carX - Math.sin(heading) * (CAR.radius + BALL.radius + 0.5);
  const ballZ = carZ - Math.cos(heading) * (CAR.radius + BALL.radius + 0.5);
  const target = computeKickTarget(heading, carX, carZ, 0, 0, ballX, BALL.radius, ballZ, 0, 0, 0, 1);
  expect(target).not.toBeNull();
  const speed = Math.hypot(target!.x, target!.z);
  expect(speed).toBeGreaterThanOrEqual(13.3);
  expect(speed).toBeLessThanOrEqual(14.7);
  const dir = kickDirection(heading, carX, carZ, ballX, ballZ);
  const angle = Math.acos(Math.min(1, (target!.x * dir.x + target!.z * dir.z) / speed));
  expect(angle).toBeLessThanOrEqual((5 * Math.PI) / 180);
});

test('bola atrás ou alta não chuta e buffer expira com whiff', () => {
  const behindX = carX + Math.sin(heading) * (CAR.radius + BALL.radius + 0.5);
  const behindZ = carZ + Math.cos(heading) * (CAR.radius + BALL.radius + 0.5);
  expect(isInKickZone(carX, carZ, heading, behindX, BALL.radius, behindZ)).toBe(false);
  expect(isInKickZone(carX, carZ, heading, carX, KICK.maxBallHeight + 0.1, carZ)).toBe(false);
  let timer = { cooldown: 0, buffer: 0 };
  ({ timer } = stepKickTimer(timer, 0, true, false));
  expect(timer.buffer).toBeCloseTo(KICK.bufferSeconds);
  ({ timer } = stepKickTimer(timer, KICK.bufferSeconds, false, false));
  expect(timer.cooldown).toBeCloseTo(KICK.whiffCooldownSeconds);
});

test('dois apertos na recarga geram um chute', () => {
  let timer = { cooldown: 0, buffer: 0 };
  const ballX = carX - Math.sin(heading) * (CAR.radius + BALL.radius + 0.5);
  const ballZ = carZ - Math.cos(heading) * (CAR.radius + BALL.radius + 0.5);
  const inZone = isInKickZone(carX, carZ, heading, ballX, BALL.radius, ballZ);
  const first = stepKickTimer(timer, 0, true, inZone);
  expect(first.fire).toBe(true);
  timer = first.timer;
  const second = stepKickTimer(timer, 0, true, inZone);
  expect(second.fire).toBe(false);
});

test('buffer de 0,1 s permite chute quando a bola entra na zona', () => {
  let timer = { cooldown: 0, buffer: 0 };
  ({ timer } = stepKickTimer(timer, 0, true, false));
  const ballX = carX - Math.sin(heading) * (CAR.radius + BALL.radius + 0.5);
  const ballZ = carZ - Math.cos(heading) * (CAR.radius + BALL.radius + 0.5);
  const mid = stepKickTimer(timer, 0.1, false, isInKickZone(carX, carZ, heading, ballX, BALL.radius, ballZ));
  expect(mid.fire).toBe(true);
});

test('contador monotônico consome um aperto por incremento', () => {
  let last = 0;
  let presses = 0;
  const consume = () => {
    const fired = presses > last;
    if (fired) last = presses;
    return fired;
  };
  expect(consume()).toBe(false);
  presses += 1;
  expect(consume()).toBe(true);
  expect(consume()).toBe(false);
  presses += 1;
  expect(consume()).toBe(true);
});

test('apex do chute máximo fica abaixo do travessão', () => {
  expect(kickApex(KICK.maxPower) + BALL.radius).toBeLessThan(createArenaDimensions().goalHeight);
});

test('dividida oposta zera plano e mantém elevação', () => {
  const forward = { x: 14, y: 2, z: 0, power: 14 };
  const backward = { x: -14, y: 2, z: 0, power: 14 };
  const resolved = resolveSimultaneousKicks([forward, backward])!;
  expect(Math.hypot(resolved.x, resolved.z)).toBeLessThan(0.01);
  expect(resolved.y).toBeGreaterThan(0);
  const reversed = resolveSimultaneousKicks([backward, forward])!;
  expect(reversed.x).toBeCloseTo(resolved.x);
  expect(reversed.z).toBeCloseTo(resolved.z);
});


test('integração Rapier: impulso de chute move a bola mais que empurrar', async () => {
  await RAPIER.init();
  const simulatePush = () => {
    const world = new RAPIER.World({ x: 0, y: -SIMULATION.gravity, z: 0 });
    world.timestep = SIMULATION.fixedStep;
    const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(2.5, BALL.radius + BALL.bodyOffset, 0).setCcdEnabled(true).setLinearDamping(BALL.linearDamping));
    world.createCollider(RAPIER.ColliderDesc.ball(BALL.radius).setMass(BALL.mass), ballBody);
    const carBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, CAR.halfHeight + CAR.bodyOffset, 0).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.cylinder(CAR.halfHeight, CAR.radius).setMass(CAR.mass), carBody);
    carBody.setLinvel({ x: 4, y: 0, z: 0 }, true);
    for (let i = 0; i < 60; i++) world.step();
    const pushed = ballBody.translation();
    const pushDistance = Math.hypot(pushed.x - 2.5, pushed.z);
    world.free();
    return pushDistance;
  };
  const simulateKick = () => {
    const world = new RAPIER.World({ x: 0, y: -SIMULATION.gravity, z: 0 });
    world.timestep = SIMULATION.fixedStep;
    const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(2.5, BALL.radius + BALL.bodyOffset, 0).setCcdEnabled(true).setLinearDamping(BALL.linearDamping));
    world.createCollider(RAPIER.ColliderDesc.ball(BALL.radius).setMass(BALL.mass), ballBody);
    const target = computeKickTarget(heading, carX, carZ, 0, 0, 2.5, BALL.radius, 0, 0, 0, 0, 1)!;
    const impulse = impulseForKickTarget(target, 0, 0, 0);
    ballBody.applyImpulse(impulse, true);
    for (let i = 0; i < 60; i++) world.step();
    const kicked = ballBody.translation();
    const kickDistance = Math.hypot(kicked.x - 2.5, kicked.z);
    world.free();
    return kickDistance;
  };
  const pushDistance = simulatePush();
  const kickDistance = simulateKick();
  expect(kickDistance).toBeGreaterThan(pushDistance * 2);
});
