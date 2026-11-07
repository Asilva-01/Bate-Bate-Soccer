import { expect, test } from 'vitest';
import { CAR, TOUCH } from '../src/game/config.ts';
import { createArenaDimensions } from '../src/game/arena-dimensions.ts';
import { createChaseRig, stepChaseCamera, type CameraTarget } from '../src/game/chase-camera.ts';
import { driveCommandFromFrame } from '../src/game/controls.ts';
import { createControlFrame, keyboardTarget, readGamepadMapping } from '../src/game/input.ts';
import { normalizeStick, stickToDrive } from '../src/game/touch-stick.ts';
import { isGrounded, stepVehicle, type VehicleState } from '../src/game/vehicle-controller.ts';

const STEP = 1 / 60;
const ARENA = createArenaDimensions();
const ASPECT = 844 / 390;

/** Direita da câmera no plano XZ (lookDir × up), com lookDir = (-sin yaw, -cos yaw). */
const cameraRight = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

const rest = (heading: number, speed: number): VehicleState & { x: number; z: number } => ({
  vx: -Math.sin(heading) * speed,
  vy: 0,
  vz: -Math.cos(heading) * speed,
  y: CAR.hitbox.halfHeight,
  heading,
  grounded: true,
  boost: 100,
  dashTime: 0,
  kickCooldown: 0,
  x: 0,
  z: 0,
});

const farBall = (car: { x: number; z: number; heading: number }): CameraTarget => ({
  carX: car.x,
  carY: 0,
  carZ: car.z,
  carHeading: car.heading,
  carSpeed: 8,
  boosting: false,
  ballX: car.x + Math.sin(car.heading) * 80,
  ballY: 0.96,
  ballZ: car.z + Math.cos(car.heading) * 80,
  mode: 'car',
});

function driveWithSteer(steer: number, heading: number, steps: number) {
  const command = { throttle: 1, steer, boost: false, kick: false };
  let state = rest(heading, 8);
  let { rig } = createChaseRig(farBall(state), ASPECT, ARENA, 'perto');
  const initialRight = cameraRight(rig.yaw);
  let minInitialRight = Infinity;
  for (let i = 0; i < steps; i++) {
    const step = stepVehicle(state, command, STEP);
    const vx = state.vx + step.impulse.x / CAR.mass;
    const vy = state.vy + step.impulse.y / CAR.mass;
    const vz = state.vz + step.impulse.z / CAR.mass;
    state = {
      ...state,
      heading: step.heading,
      vx,
      vy,
      vz,
      grounded: isGrounded(state.y, vy),
      x: state.x + vx * STEP,
      z: state.z + vz * STEP,
    };
    rig = stepChaseCamera(rig, farBall(state), STEP, ASPECT, ARENA, 'perto').rig;
    minInitialRight = Math.min(minInitialRight, state.x * initialRight.x + state.z * initialRight.z);
  }
  return { state, rig, initialRight, minInitialRight, startHeading: heading };
}

test('stick à direita da tela, teclado D e gamepad têm o mesmo sinal de steer', () => {
  const fromPixels = stickToDrive(normalizeStick(40, -10, TOUCH.stick.radiusPx));
  const fromStick = stickToDrive({ x: 0.7, y: 0.5 });
  const keys = keyboardTarget(new Set(['KeyW', 'KeyD']));
  const arrows = keyboardTarget(new Set(['ArrowRight']));
  const pad = readGamepadMapping({ axes: [0.8, 0], buttons: [] });
  const frame = createControlFrame();
  frame.steer = fromStick.steer;
  const { command } = driveCommandFromFrame(frame, 0);

  expect(fromPixels.steer).toBeGreaterThan(0);
  expect(fromPixels.throttle).toBeGreaterThan(0);
  expect(fromStick.steer).toBeGreaterThan(0);
  expect(keys.steer).toBeGreaterThan(0);
  expect(arrows.steer).toBeGreaterThan(0);
  expect(pad.steer).toBeGreaterThan(0);
  expect(command.steer).toBeGreaterThan(0);
  expect(Math.sign(fromStick.steer)).toBe(Math.sign(keys.steer));
  expect(Math.sign(fromStick.steer)).toBe(Math.sign(pad.steer));
});

test.each([
  ['heading 0 (frente −Z)', 0],
  ['saída do jogador (−π/2, frente +X)', -Math.PI / 2],
] as const)('stick à direita: depois de 20 passos o carro está à direita da câmera (%s)', (_name, heading) => {
  const drive = stickToDrive({ x: 0.85, y: 0.5 });
  expect(drive.throttle).toBeGreaterThan(0.5);
  expect(drive.steer).toBeGreaterThan(0.5);
  const { state, initialRight, minInitialRight, startHeading } = driveWithSteer(drive.steer, heading, 20);
  const alongInitialRight = state.x * initialRight.x + state.z * initialRight.z;
  expect(alongInitialRight).toBeGreaterThan(0.6);
  expect(minInitialRight).toBeGreaterThan(0);
  expect(Math.atan2(Math.sin(state.heading - startHeading), Math.cos(state.heading - startHeading))).toBeLessThan(0);
});

test('câmera atrás do carro: direita do mundo em heading 0 é +X; o atraso de yaw não inverte esquerda/direita', () => {
  expect(cameraRight(0).x).toBeCloseTo(1, 9);
  expect(cameraRight(0).z).toBeCloseTo(0, 9);
  expect(cameraRight(-Math.PI / 2).x).toBeCloseTo(0, 9);
  expect(cameraRight(-Math.PI / 2).z).toBeCloseTo(1, 9);
  const { minInitialRight, rig, state } = driveWithSteer(1, 0, 20);
  expect(minInitialRight).toBeGreaterThan(0);
  const lag = Math.atan2(Math.sin(rig.yaw - state.heading), Math.cos(rig.yaw - state.heading));
  expect(Math.abs(lag)).toBeLessThan(35 * Math.PI / 180 + 1e-6);
});
