import { expect, test } from 'vitest';
import { CAR, TOUCH } from '../src/game/config.ts';
import { createArenaDimensions } from '../src/game/arena-dimensions.ts';
import { wrapAngle } from '../src/game/math.ts';
import {
  carPressedAgainstWall,
  createAimStickState,
  stepAimStick,
  stickWorldDirection,
  type AimStickSample,
  type AimStickState,
} from '../src/game/touch-stick.ts';
import { headingDelta, isGrounded, stepVehicle, type VehicleState } from '../src/game/vehicle-controller.ts';

const STEP = 1 / 60;
const DEG = Math.PI / 180;
const ARENA = createArenaDimensions();

const sample = (overrides: Partial<AimStickSample> = {}): AimStickSample => ({
  stick: { x: 0, y: 1 },
  carHeading: 0,
  cameraYaw: 0,
  speed: 8,
  wallPressed: false,
  dt: STEP,
  ...overrides,
});

function driveAim(overrides: Partial<AimStickSample> = {}, state: AimStickState = createAimStickState()) {
  return stepAimStick(sample(overrides), state);
}

function rest(heading = 0, speed = 8): VehicleState {
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  return {
    vx: fx * speed,
    vy: 0,
    vz: fz * speed,
    y: CAR.hitbox.halfHeight,
    heading,
    grounded: true,
    boost: 100,
    dashTime: 0,
    kickCooldown: 0,
  };
}

test('stickWorldDirection: para cima na tela segue o yaw da câmera; direita vira −90°', () => {
  const up = stickWorldDirection({ x: 0, y: 1 }, 0);
  expect(up.heading).toBeCloseTo(0, 6);
  expect(up.x).toBeCloseTo(0, 6);
  expect(up.z).toBeCloseTo(-1, 6);

  const right = stickWorldDirection({ x: 1, y: 0 }, 0);
  expect(right.heading).toBeCloseTo(-Math.PI / 2, 6);
  expect(right.x).toBeCloseTo(1, 6);
  expect(right.z).toBeCloseTo(0, 6);

  const lookPlusX = stickWorldDirection({ x: 0, y: 1 }, -Math.PI / 2);
  expect(lookPlusX.heading).toBeCloseTo(-Math.PI / 2, 6);
  expect(lookPlusX.x).toBeCloseTo(1, 6);
});

test('alvo à direita da tela gera steer positivo e reduz o erro de heading', () => {
  const { throttle, steer, targetHeading } = driveAim({ stick: { x: 1, y: 0 }, carHeading: 0, cameraYaw: 0 });
  expect(throttle).toBeGreaterThan(0.2);
  expect(steer).toBeGreaterThan(0.5);
  expect(targetHeading).toBeCloseTo(-Math.PI / 2, 5);
  const next = 0 + headingDelta(steer, 8, STEP);
  expect(Math.abs(wrapAngle(next - targetHeading!))).toBeLessThan(Math.abs(wrapAngle(0 - targetHeading!)));
});

test('alvo à esquerda da tela gera steer negativo e reduz o erro de heading', () => {
  const { steer, targetHeading } = driveAim({ stick: { x: -1, y: 0 }, carHeading: 0, cameraYaw: 0 });
  expect(steer).toBeLessThan(-0.5);
  expect(targetHeading).toBeCloseTo(Math.PI / 2, 5);
  const next = 0 + headingDelta(steer, 8, STEP);
  expect(Math.abs(wrapAngle(next - targetHeading!))).toBeLessThan(Math.abs(wrapAngle(0 - targetHeading!)));
});

test('alvo atrás em velocidade vira meia-volta para a frente, sem ré', () => {
  let state = createAimStickState();
  let throttle = 0;
  for (let i = 0; i < 60; i++) {
    const step = driveAim({ stick: { x: 0, y: -1 }, speed: 10, carHeading: 0 }, state);
    state = step.state;
    throttle = step.throttle;
    expect(step.reversing).toBe(false);
    expect(step.throttle).toBeGreaterThan(0);
  }
  expect(throttle).toBeGreaterThan(0);
  expect(throttle).toBeLessThan(1);
});

test('parado com alvo atrás só entra em ré depois do tempo configurado', () => {
  let state = createAimStickState();
  const hold = TOUCH.stick.aimReverseHoldSeconds;
  let elapsed = 0;
  while (elapsed + STEP < hold) {
    const step = driveAim({ stick: { x: 0, y: -1 }, speed: 0, carHeading: 0 }, state);
    state = step.state;
    elapsed += STEP;
    expect(step.reversing).toBe(false);
    expect(step.throttle).toBe(0);
  }

  let reversed = false;
  for (let i = 0; i < 8; i++) {
    const step = driveAim({ stick: { x: 0, y: -1 }, speed: 0, carHeading: 0 }, state);
    state = step.state;
    if (step.reversing && step.throttle < 0) {
      reversed = true;
      expect(step.steer).toBeCloseTo(0, 5);
      break;
    }
  }
  expect(reversed).toBe(true);
});

test('prensado na parede com alvo atrás entra em ré no primeiro passo', () => {
  const step = driveAim({ stick: { x: 0, y: -1 }, speed: 5, wallPressed: true, carHeading: 0 });
  expect(step.reversing).toBe(true);
  expect(step.throttle).toBeLessThan(0);
});

test('referência de yaw congelada: câmera colada no carro não faz o heading girar sem parar', () => {
  const stick = { x: 1, y: 0 };
  const target = stickWorldDirection(stick, 0).heading;
  let aim = createAimStickState();
  let vehicle = rest(0, 8);
  const headings: number[] = [];
  for (let i = 0; i < 180; i++) {
    const step = stepAimStick(sample({
      stick,
      carHeading: vehicle.heading,
      cameraYaw: vehicle.heading,
      speed: Math.hypot(vehicle.vx, vehicle.vz),
    }), aim);
    aim = step.state;
    const next = stepVehicle(vehicle, { throttle: step.throttle, steer: step.steer, boost: false, kick: false }, STEP);
    vehicle = {
      ...vehicle,
      heading: next.heading,
      vx: vehicle.vx + next.impulse.x / CAR.mass,
      vy: vehicle.vy + next.impulse.y / CAR.mass,
      vz: vehicle.vz + next.impulse.z / CAR.mass,
      grounded: isGrounded(vehicle.y, vehicle.vy + next.impulse.y / CAR.mass),
    };
    headings.push(vehicle.heading);
  }
  expect(aim.referenceYaw).toBeCloseTo(0, 6);
  expect(Math.abs(wrapAngle(vehicle.heading - target))).toBeLessThan(8 * DEG);
  const spun = headings.some((heading, index) => index > 0 && Math.abs(heading - headings[0]) > Math.PI * 1.2);
  expect(spun).toBe(false);
  const tail = headings.slice(-30);
  const tailSpread = Math.max(...tail.map((heading) => Math.abs(wrapAngle(heading - target))));
  expect(tailSpread).toBeLessThan(8 * DEG);
});

test('filtro exponencial responde a um degrau dentro da constante de tempo', () => {
  const tau = TOUCH.stick.aimFilterTimeConstant;
  let state = driveAim({ stick: { x: 0, y: 1 } }).state;
  expect(state.hasFilter).toBe(true);

  const stepsInTau = Math.round(tau / STEP);
  let heading = 0;
  for (let i = 0; i < stepsInTau; i++) {
    const step = driveAim({ stick: { x: 1, y: 0 } }, state);
    state = step.state;
    heading = step.targetHeading ?? 0;
  }
  const atTau = Math.abs(wrapAngle(heading));
  expect(atTau).toBeGreaterThan(35 * DEG);
  expect(atTau).toBeLessThan(80 * DEG);

  for (let i = 0; i < stepsInTau * 4; i++) {
    const step = driveAim({ stick: { x: 1, y: 0 } }, state);
    state = step.state;
    heading = step.targetHeading ?? 0;
  }
  expect(Math.abs(wrapAngle(heading + Math.PI / 2))).toBeLessThan(8 * DEG);
});

test('integração: stick 90° à direita alinha o carro em menos de 1,5 s sem oscilar', () => {
  const stick = { x: 1, y: 0 };
  const frozenYaw = 0;
  const target = stickWorldDirection(stick, frozenYaw).heading;
  let aim = createAimStickState();
  let vehicle = rest(0, 6);
  let crossed = false;
  let maxAfterCross = 0;
  const limit = Math.round(1.5 / STEP);
  let alignedAt = Infinity;
  for (let i = 0; i < limit; i++) {
    const step = stepAimStick(sample({
      stick,
      carHeading: vehicle.heading,
      cameraYaw: vehicle.heading,
      speed: Math.hypot(vehicle.vx, vehicle.vz),
    }), aim);
    aim = step.state;
    const next = stepVehicle(vehicle, { throttle: step.throttle, steer: step.steer, boost: false, kick: false }, STEP);
    vehicle = {
      ...vehicle,
      heading: next.heading,
      vx: vehicle.vx + next.impulse.x / CAR.mass,
      vy: vehicle.vy + next.impulse.y / CAR.mass,
      vz: vehicle.vz + next.impulse.z / CAR.mass,
      grounded: isGrounded(vehicle.y, vehicle.vy + next.impulse.y / CAR.mass),
    };
    const error = wrapAngle(vehicle.heading - target);
    if (Math.abs(error) < 10 * DEG) {
      crossed = true;
      if (alignedAt === Infinity) alignedAt = i * STEP;
    }
    if (crossed) maxAfterCross = Math.max(maxAfterCross, Math.abs(error));
  }
  expect(alignedAt).toBeLessThanOrEqual(1.5);
  expect(Math.abs(wrapAngle(vehicle.heading - target))).toBeLessThan(8 * DEG);
  expect(maxAfterCross).toBeLessThan(12 * DEG);
});

test('carPressedAgainstWall exige estar perto e olhando para a parede', () => {
  const clearance = TOUCH.stick.aimWallPressClearance;
  const facing = TOUCH.stick.aimWallFacingDot;
  expect(carPressedAgainstWall(0, 0, 0, ARENA, clearance, facing)).toBe(false);
  expect(carPressedAgainstWall(ARENA.goalLineX - 0.8, 0, 0, ARENA, clearance, facing)).toBe(false);
  expect(carPressedAgainstWall(ARENA.goalLineX - 0.8, 16, -Math.PI / 2, ARENA, clearance, facing)).toBe(true);
  expect(carPressedAgainstWall(0, ARENA.sideWallZ - 0.5, 0, ARENA, clearance, facing)).toBe(false);
  expect(carPressedAgainstWall(0, ARENA.sideWallZ - 0.5, Math.PI, ARENA, clearance, facing)).toBe(true);
});
