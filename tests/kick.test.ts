import { afterAll, expect, test } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL, CAR, KICK, SIMULATION } from '../src/game/config.ts';
import { createArenaDimensions } from '../src/game/arena-dimensions.ts';
import { addBallToWorld, addCarToWorld, carBodyHeight, createStaticArena } from '../src/game/physics-world.ts';
import { getScoringSide } from '../src/game/match-rules.ts';
import { yawQuaternion } from '../src/game/math.ts';
import {
  computeKickTarget,
  dashHopSpeed,
  dashImpulse,
  impulseForKickTarget,
  isInKickZone,
  kickDirection,
  kickLift,
  recoilImpulse,
  resolveSimultaneousKicks,
  stepKickTimer,
} from '../src/game/kick.ts';
import { applyKicks, type KickStepState } from '../src/game/kick-step.ts';

const heading = -Math.PI / 2;
const carX = 0;
const carZ = 0;
const STEP = SIMULATION.fixedStep;
const dims = createArenaDimensions();

function ballInFront(gap = 0.5, y = BALL.radius) {
  const forward = { x: -Math.sin(heading), z: -Math.cos(heading) };
  const distance = CAR.hitbox.halfLength + BALL.radius + gap;
  return { x: carX + forward.x * distance, y, z: carZ + forward.z * distance };
}

function emptyTimer() {
  return { cooldown: 0, buffer: 0 };
}

function kickState(): KickStepState {
  return {
    kickTimers: [emptyTimer()],
    zoneTime: new Float32Array(1),
    dashRemaining: new Float32Array(1),
    aiKickLatched: [false],
    lastKickPresses: 0,
  };
}

let world: RAPIER.World | undefined;

afterAll(() => world?.free());

async function makeWorld() {
  await RAPIER.init();
  world?.free();
  const next = new RAPIER.World({ x: 0, y: -SIMULATION.gravity, z: 0 });
  next.timestep = STEP;
  next.integrationParameters.numSolverIterations = SIMULATION.solverIterations;
  createStaticArena(next, dims);
  world = next;
  return next;
}

function placeCar(body: RAPIER.RigidBody, x: number, z: number, yaw: number) {
  body.setTranslation({ x, y: carBodyHeight(), z }, true);
  body.setRotation(yawQuaternion(yaw), true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

test('isInKickZone usa a frente da hitbox e o raio da bola, não valores fixos internos', () => {
  expect(isInKickZone(0, 0, heading, 10, BALL.radius, 0, { carFront: 0, ballRadius: 0, reach: 10.05 })).toBe(true);
  expect(isInKickZone(0, 0, heading, 10, BALL.radius, 0, { carFront: 0, ballRadius: 0, reach: 9.95 })).toBe(false);
  expect(isInKickZone(0, 0, heading, 3, KICK.maxBallHeight + 0.05, 0)).toBe(false);
  const behind = ballInFront(0.5);
  expect(isInKickZone(carX, carZ, heading, -behind.x, BALL.radius, behind.z)).toBe(false);
});

test('apertar sem bola: +8 u/s, pulinho e recarga de 0,9 s, sem impulso na bola', () => {
  const rest = dashImpulse(heading, 0, 0, 0, KICK.hopSpeed);
  expect(rest.x / CAR.mass).toBeCloseTo(KICK.dashSpeed, 5);
  expect(rest.z / CAR.mass).toBeCloseTo(0, 5);
  expect(rest.y / CAR.mass).toBeCloseTo(KICK.hopSpeed, 5);

  const turbo = dashImpulse(heading, CAR.boostMaxSpeed, 0, 0, KICK.hopSpeed);
  expect(turbo.x / CAR.mass).toBeCloseTo(KICK.dashMaxExtra, 5);

  const first = stepKickTimer(emptyTimer(), 0, true, false);
  expect(first.dashStarted).toBe(true);
  expect(first.fire).toBe(false);
  expect(first.timer.cooldown).toBeCloseTo(KICK.cooldownSeconds, 5);
  const second = stepKickTimer(first.timer, 0, true, false);
  expect(second.dashStarted).toBe(false);
  const ready = stepKickTimer(first.timer, KICK.cooldownSeconds, true, false);
  expect(ready.dashStarted).toBe(true);
});

test('integração: dash sem bola sobe ≥ 0,4 u e não move a bola', async () => {
  const arena = await makeWorld();
  const { body: car } = addCarToWorld(arena, 0, carBodyHeight(), 0);
  const { body: ball } = addBallToWorld(arena);
  placeCar(car, 0, 0, heading);
  ball.setTranslation({ x: 22, y: BALL.radius + BALL.bodyOffset, z: 18 }, true);
  ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  const startY = car.translation().y;
  const startBall = { ...ball.linvel() };
  applyKicks(
    [car],
    ball,
    [heading],
    () => true,
    [true],
    kickState(),
    1,
    dims,
    1,
    0,
    1,
    STEP,
    { playerShotsOnGoal: 0 },
  );
  const speed = Math.hypot(car.linvel().x, car.linvel().z);
  expect(speed).toBeGreaterThanOrEqual(KICK.dashSpeed - 0.5);
  expect(speed).toBeLessThanOrEqual(KICK.dashSpeed + 0.5);
  expect(Math.hypot(ball.linvel().x - startBall.x, ball.linvel().y - startBall.y, ball.linvel().z - startBall.z)).toBeLessThan(1e-6);
  let peak = startY;
  for (let i = 0; i < 45; i++) {
    arena.step();
    peak = Math.max(peak, car.translation().y);
  }
  expect(peak - startY).toBeGreaterThanOrEqual(0.4);
  expect(Math.hypot(ball.linvel().x, ball.linvel().z)).toBeLessThan(0.05);
}, 20_000);

test('bola parada a 0,5 u na frente, carro parado: 16 ± 0,8 u/s rasteira a ≤ 5°', () => {
  const ball = ballInFront(0.5, BALL.radius);
  const target = computeKickTarget(heading, carX, carZ, 0, 0, ball.x, ball.y, ball.z, 0, 0, 0, 1);
  expect(target).not.toBeNull();
  const speed = Math.hypot(target!.x, target!.z);
  expect(speed).toBeGreaterThanOrEqual(KICK.basePower - 0.8);
  expect(speed).toBeLessThanOrEqual(KICK.basePower + 0.8);
  expect(speed).toBeGreaterThanOrEqual(15.2);
  expect(speed).toBeLessThanOrEqual(16.8);
  const dir = kickDirection(heading, carX, carZ, ball.x, ball.z);
  const angle = Math.acos(Math.min(1, (target!.x * dir.x + target!.z * dir.z) / speed));
  expect(angle).toBeLessThanOrEqual((5 * Math.PI) / 180);
  expect(kickLift(ball.y)).toBeCloseTo(KICK.liftGround, 5);
  expect(target!.y).toBeCloseTo(target!.power * KICK.liftGround, 5);
});

test('bola a 3,5 u de altura na zona: lift ≥ 0,35 e pulinho maior', () => {
  const ball = ballInFront(0.5, 3.5);
  expect(isInKickZone(carX, carZ, heading, ball.x, ball.y, ball.z)).toBe(true);
  const ground = computeKickTarget(heading, carX, carZ, 0, 0, ball.x, BALL.radius, ball.z, 0, 0, 0, 1);
  const header = computeKickTarget(heading, carX, carZ, 0, 0, ball.x, 3.5, ball.z, 0, 0, 0, 1);
  expect(header).not.toBeNull();
  expect(ground).not.toBeNull();
  const lift = header!.y / header!.power;
  expect(lift).toBeGreaterThanOrEqual(0.35);
  expect(header!.y).toBeGreaterThan(ground!.y);
  expect(kickLift(KICK.liftBlendFromY)).toBeCloseTo(KICK.liftGround, 5);
  expect(kickLift(KICK.liftBlendToY)).toBeCloseTo(KICK.liftHigh, 5);
  expect(dashHopSpeed(3.5, true)).toBe(KICK.highBallHopSpeed);
  expect(dashHopSpeed(BALL.radius, true)).toBe(KICK.hopSpeed);
  expect(dashImpulse(heading, 0, 0, 0, dashHopSpeed(3.5, true)).y).toBeGreaterThan(dashImpulse(heading, 0, 0, 0, dashHopSpeed(BALL.radius, true)).y);
});

test('a bola entra na zona aos 0,2 s do dash → toca uma vez; aos 0,3 s → não toca', () => {
  const start = stepKickTimer(emptyTimer(), 0, true, false);
  expect(start.dashStarted).toBe(true);
  expect(start.fire).toBe(false);
  expect(start.timer.buffer).toBeCloseTo(KICK.dashSeconds, 5);

  const connect = stepKickTimer(start.timer, 0.2, false, true);
  expect(connect.fire).toBe(true);
  expect(connect.dashStarted).toBe(false);
  const again = stepKickTimer(connect.timer, STEP, false, true);
  expect(again.fire).toBe(false);

  const lateStart = stepKickTimer(emptyTimer(), 0, true, false);
  const miss = stepKickTimer(lateStart.timer, 0.3, false, true);
  expect(miss.fire).toBe(false);
  expect(miss.timer.buffer).toBe(0);
});

test('dois apertos na recarga geram um toque', () => {
  const ball = ballInFront();
  const inZone = isInKickZone(carX, carZ, heading, ball.x, ball.y, ball.z);
  const first = stepKickTimer(emptyTimer(), 0, true, inZone);
  expect(first.fire).toBe(true);
  expect(first.dashStarted).toBe(true);
  const second = stepKickTimer(first.timer, 0, true, inZone);
  expect(second.fire).toBe(false);
  expect(second.dashStarted).toBe(false);
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

test('dividida simétrica → igual com a ordem invertida', () => {
  const forward = { x: 16, y: 2, z: 0, power: 16 };
  const backward = { x: -16, y: 2, z: 0, power: 16 };
  const resolved = resolveSimultaneousKicks([forward, backward])!;
  expect(Math.hypot(resolved.x, resolved.z)).toBeLessThan(0.01);
  expect(resolved.y).toBeGreaterThan(0);
  const reversed = resolveSimultaneousKicks([backward, forward])!;
  expect(reversed.x).toBeCloseTo(resolved.x);
  expect(reversed.z).toBeCloseTo(resolved.z);
  expect(reversed.y).toBeCloseTo(resolved.y);
  expect(reversed.power).toBeCloseTo(resolved.power);
});

test('recuo empurra o carro contra a direção do toque', () => {
  const impulse = recoilImpulse(1, 0, KICK.basePower);
  expect(impulse.x).toBeCloseTo(-CAR.mass * KICK.basePower * KICK.recoil, 5);
  expect(impulse.y).toBeCloseTo(0, 10);
  expect(impulse.z).toBeCloseTo(0, 10);
});

test('integração: o toque leva a bola ao gol vazio a partir de 25 u em linha reta', async () => {
  const arena = await makeWorld();
  const ballX = dims.goalLineX - 25;
  const gap = 0.5;
  const carX0 = ballX - (CAR.hitbox.halfLength + BALL.radius + gap);
  const { body: car } = addCarToWorld(arena, carX0, carBodyHeight(), 0);
  const { body: ball } = addBallToWorld(arena);
  placeCar(car, carX0, 0, heading);
  ball.setTranslation({ x: ballX, y: BALL.radius + BALL.bodyOffset, z: 0 }, true);
  ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  expect(isInKickZone(carX0, 0, heading, ballX, BALL.radius + BALL.bodyOffset, 0)).toBe(true);
  applyKicks(
    [car],
    ball,
    [heading],
    () => true,
    [true],
    kickState(),
    1,
    dims,
    1,
    0,
    1,
    STEP,
    { playerShotsOnGoal: 0 },
  );
  const kicked = ball.linvel();
  expect(Math.hypot(kicked.x, kicked.z)).toBeGreaterThanOrEqual(KICK.basePower - 0.8);
  let scored: ReturnType<typeof getScoringSide> = null;
  const steps = Math.round(4 / STEP);
  for (let i = 0; i < steps; i++) {
    arena.step();
    const position = ball.translation();
    scored = getScoringSide({ x: position.x, y: position.y, z: position.z }, dims);
    if (scored) break;
  }
  expect(scored).toBe('blue');
}, 20_000);

test('integração Rapier: impulso de toque move a bola mais que empurrar', async () => {
  await RAPIER.init();
  const simulatePush = () => {
    const pushWorld = new RAPIER.World({ x: 0, y: -SIMULATION.gravity, z: 0 });
    pushWorld.timestep = STEP;
    const ballBody = pushWorld.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(2.5, BALL.radius + BALL.bodyOffset, 0).setCcdEnabled(true).setLinearDamping(BALL.linearDamping));
    pushWorld.createCollider(RAPIER.ColliderDesc.ball(BALL.radius).setMass(BALL.mass), ballBody);
    const carBody = pushWorld.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, CAR.halfHeight + CAR.bodyOffset, 0).setCcdEnabled(true));
    pushWorld.createCollider(RAPIER.ColliderDesc.cylinder(CAR.halfHeight, CAR.radius).setMass(CAR.mass), carBody);
    carBody.setLinvel({ x: 4, y: 0, z: 0 }, true);
    for (let i = 0; i < 60; i++) pushWorld.step();
    const pushed = ballBody.translation();
    const pushDistance = Math.hypot(pushed.x - 2.5, pushed.z);
    pushWorld.free();
    return pushDistance;
  };
  const simulateKick = () => {
    const kickWorld = new RAPIER.World({ x: 0, y: -SIMULATION.gravity, z: 0 });
    kickWorld.timestep = STEP;
    const ballBody = kickWorld.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(2.5, BALL.radius + BALL.bodyOffset, 0).setCcdEnabled(true).setLinearDamping(BALL.linearDamping));
    kickWorld.createCollider(RAPIER.ColliderDesc.ball(BALL.radius).setMass(BALL.mass), ballBody);
    const target = computeKickTarget(heading, carX, carZ, 0, 0, 2.5, BALL.radius, 0, 0, 0, 0, 1)!;
    const impulse = impulseForKickTarget(target, 0, 0, 0);
    ballBody.applyImpulse(impulse, true);
    for (let i = 0; i < 60; i++) kickWorld.step();
    const kicked = ballBody.translation();
    const kickDistance = Math.hypot(kicked.x - 2.5, kicked.z);
    kickWorld.free();
    return kickDistance;
  };
  expect(simulateKick()).toBeGreaterThan(simulatePush() * 2);
});
