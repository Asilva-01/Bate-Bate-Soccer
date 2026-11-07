import { TOUCH } from './config';
import type { ArenaDimensions } from './arena-dimensions';
import { clamp as clampValue, wrapAngle } from './math';

export type StickVector = { x: number; y: number };
export type DriveAxes = { throttle: number; steer: number };
export type Point = { x: number; y: number };
export type Bounds = { left: number; top: number; right: number; bottom: number };
export type TouchStickMode = 'aim' | 'steer';
export type AimStickState = {
  referenceYaw: number | null;
  reverseHoldSeconds: number;
  reversing: boolean;
  filteredX: number;
  filteredZ: number;
  hasFilter: boolean;
};
export type AimStickSample = {
  stick: StickVector;
  carHeading: number;
  cameraYaw: number;
  speed: number;
  wallPressed: boolean;
  dt: number;
};
export type AimStickStep = DriveAxes & {
  targetHeading: number | null;
  targetX: number;
  targetZ: number;
  active: boolean;
  reversing: boolean;
  state: AimStickState;
};
export type TouchStickLive = {
  mode: TouchStickMode;
  stick: StickVector;
  aim: AimStickState;
  targetHeading: number | null;
  targetX: number;
  targetZ: number;
};

const DEG = Math.PI / 180;

const clamp = (value: number, min: number, max: number) => clampValue(value, min, max);
const noNegativeZero = (value: number) => (value === 0 ? 0 : value);

/** `dyPx` segue as coordenadas da tela (positivo = para baixo); o vetor devolvido tem y positivo para cima. */
export function normalizeStick(dxPx: number, dyPx: number, radiusPx: number): StickVector {
  const x = dxPx / radiusPx;
  const y = -dyPx / radiusPx;
  const length = Math.hypot(x, y);
  if (length <= 1) return { x: noNegativeZero(x), y: noNegativeZero(y) };
  return { x: x / length, y: y / length };
}

/** `steer` positivo = direita da tela. A faixa `reverseBlendAngleDeg` suaviza o throttle na fronteira frente/ré. */
export function stickToDrive(stick: StickVector, params: typeof TOUCH.stick = TOUCH.stick): DriveAxes {
  const length = Math.hypot(stick.x, stick.y);
  const magnitude = clamp((length - params.deadzone) / (params.saturation - params.deadzone), 0, 1);
  if (magnitude === 0) return { throttle: 0, steer: 0 };
  const theta = Math.atan2(stick.x, stick.y);
  const absTheta = Math.abs(theta);
  const front = params.frontHalfAngleDeg * DEG;
  const blend = params.reverseBlendAngleDeg * DEG;
  const forwardSteer = clamp(theta / (params.steerFullAngleDeg * DEG), -1, 1);
  const reverseSteer = Math.sign(theta) * clamp((Math.PI - absTheta) / (params.reverseSteerFullAngleDeg * DEG), 0, 1);
  const reverseAmount = blend <= 0
    ? (absTheta <= front ? 0 : 1)
    : clamp((absTheta - (front - blend)) / (2 * blend), 0, 1);
  return {
    throttle: noNegativeZero(magnitude * (1 - 2 * reverseAmount)),
    steer: noNegativeZero(forwardSteer * (1 - reverseAmount) + reverseSteer * reverseAmount),
  };
}

export function followBase(base: Point, pointer: Point, radiusPx: number, followFactor: number): Point {
  const dx = pointer.x - base.x;
  const dy = pointer.y - base.y;
  const distance = Math.hypot(dx, dy);
  const limit = radiusPx * followFactor;
  if (distance <= limit) return { x: base.x, y: base.y };
  return { x: pointer.x - (dx / distance) * limit, y: pointer.y - (dy / distance) * limit };
}

/** Mantém a base do stick a pelo menos `radiusPx` de cada borda da área segura. */
export function clampStickBase(point: Point, bounds: Bounds, radiusPx: number): Point {
  const minX = bounds.left + radiusPx;
  const maxX = Math.max(minX, bounds.right - radiusPx);
  const minY = bounds.top + radiusPx;
  const maxY = Math.max(minY, bounds.bottom - radiusPx);
  return { x: clamp(point.x, minX, maxX), y: clamp(point.y, minY, maxY) };
}

export function createAimStickState(): AimStickState {
  return {
    referenceYaw: null,
    reverseHoldSeconds: 0,
    reversing: false,
    filteredX: 0,
    filteredZ: -1,
    hasFilter: false,
  };
}

export function createTouchStickLive(mode: TouchStickMode = 'aim'): TouchStickLive {
  return {
    mode,
    stick: { x: 0, y: 0 },
    aim: createAimStickState(),
    targetHeading: null,
    targetX: 0,
    targetZ: 0,
  };
}

export function resetTouchStickLive(live: TouchStickLive) {
  live.stick = { x: 0, y: 0 };
  live.aim = createAimStickState();
  live.targetHeading = null;
  live.targetX = 0;
  live.targetZ = 0;
}

function idleAimStep(state: AimStickState = createAimStickState()): AimStickStep {
  return {
    throttle: 0,
    steer: 0,
    targetHeading: null,
    targetX: 0,
    targetZ: 0,
    active: false,
    reversing: false,
    state,
  };
}

/** Direção no chão relativa ao yaw da câmera: para cima na tela = para onde a câmera olha. */
export function stickWorldDirection(stick: StickVector, cameraYaw: number): { x: number; z: number; heading: number } {
  const length = Math.hypot(stick.x, stick.y);
  if (length < 1e-8) return { x: 0, z: 0, heading: 0 };
  const nx = stick.x / length;
  const ny = stick.y / length;
  const sinYaw = Math.sin(cameraYaw);
  const cosYaw = Math.cos(cameraYaw);
  const x = cosYaw * nx - sinYaw * ny;
  const z = -sinYaw * nx - cosYaw * ny;
  return { x, z, heading: Math.atan2(-x, -z) };
}

function aimMagnitude(stick: StickVector, params: typeof TOUCH.stick): number {
  const length = Math.hypot(stick.x, stick.y);
  const span = params.saturation - params.aimDeadzone;
  if (span <= 1e-6) return length > params.aimDeadzone ? 1 : 0;
  return clamp((length - params.aimDeadzone) / span, 0, 1);
}

function filterDirection(
  rawX: number,
  rawZ: number,
  state: AimStickState,
  dt: number,
  timeConstant: number,
): { x: number; z: number } {
  if (!state.hasFilter || timeConstant <= 0 || dt <= 0) return { x: rawX, z: rawZ };
  const alpha = 1 - Math.exp(-dt / timeConstant);
  const x = state.filteredX + (rawX - state.filteredX) * alpha;
  const z = state.filteredZ + (rawZ - state.filteredZ) * alpha;
  const length = Math.hypot(x, z);
  if (length < 1e-8) return { x: rawX, z: rawZ };
  return { x: x / length, z: z / length };
}

/** Perto da parede e olhando para ela — usado para liberar ré no modo apontar sem esperar o timer. */
export function carPressedAgainstWall(
  x: number,
  z: number,
  heading: number,
  dims: Pick<ArenaDimensions, 'goalLineX' | 'sideWallZ' | 'cornerChamfer' | 'goalHalfWidth' | 'goalBackX'>,
  clearance: number,
  facingDot: number,
): boolean {
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const inMouth = az <= dims.goalHalfWidth;
  const distEnd = (inMouth ? dims.goalBackX : dims.goalLineX) - ax;
  const distSide = dims.sideWallZ - az;
  const chamferLimit = dims.goalLineX + dims.sideWallZ - dims.cornerChamfer;
  const distChamfer = (chamferLimit - ax - az) / Math.SQRT2;
  const endSign = Math.sign(x);
  const sideSign = Math.sign(z);
  if (distEnd < clearance && endSign !== 0 && fx * endSign > facingDot) return true;
  if (distSide < clearance && sideSign !== 0 && fz * sideSign > facingDot) return true;
  if (distChamfer < clearance && endSign !== 0 && sideSign !== 0 && fx * endSign + fz * sideSign > facingDot * Math.SQRT2) {
    return true;
  }
  return false;
}

/**
 * Converte o stick em throttle/steer no modo apontar.
 * Congela o yaw da câmera enquanto o dedo fica fora da zona morta, para não entrar no laço da câmera de perseguição.
 */
export function stepAimStick(
  sample: AimStickSample,
  state: AimStickState,
  params: typeof TOUCH.stick = TOUCH.stick,
): AimStickStep {
  const magnitude = aimMagnitude(sample.stick, params);
  if (magnitude === 0) return idleAimStep();

  const referenceYaw = state.referenceYaw ?? sample.cameraYaw;
  const raw = stickWorldDirection(sample.stick, referenceYaw);
  const filtered = filterDirection(raw.x, raw.z, state, sample.dt, params.aimFilterTimeConstant);
  const targetHeading = Math.atan2(-filtered.x, -filtered.z);
  const headingError = wrapAngle(targetHeading - sample.carHeading);
  const absError = Math.abs(headingError);
  const behind = absError >= params.aimReverseBehindAngleDeg * DEG;
  const slow = sample.speed < params.aimReverseEngageSpeed;

  let reverseHoldSeconds = state.reverseHoldSeconds;
  let reversing = state.reversing;
  if (reversing) {
    if (absError <= params.aimReverseExitAngleDeg * DEG) reversing = false;
  } else if (behind && (sample.wallPressed || slow)) {
    if (sample.wallPressed) {
      reversing = true;
      reverseHoldSeconds = 0;
    } else {
      reverseHoldSeconds += Math.max(0, sample.dt);
      if (reverseHoldSeconds >= params.aimReverseHoldSeconds) reversing = true;
    }
  } else {
    reverseHoldSeconds = 0;
  }

  const waitingToReverse = behind && slow && !reversing && !sample.wallPressed;
  const cut = params.aimThrottleCutAngleDeg * DEG;
  const turnAmount = cut <= 0 ? 0 : clamp(absError / cut, 0, 1);
  const forwardThrottle = magnitude * (1 - turnAmount * (1 - params.aimMinTurnThrottle));
  const fullSteer = params.aimSteerFullAngleDeg * DEG;
  const reverseError = wrapAngle(headingError - Math.PI);
  const rawSteer = reversing ? reverseError / Math.max(fullSteer, 1e-6) : -headingError / Math.max(fullSteer, 1e-6);
  const steer = waitingToReverse ? 0 : noNegativeZero(clamp(rawSteer, -1, 1));

  let throttle = 0;
  if (waitingToReverse) throttle = 0;
  else if (reversing) throttle = noNegativeZero(-magnitude);
  else throttle = noNegativeZero(forwardThrottle);

  return {
    throttle,
    steer,
    targetHeading,
    targetX: filtered.x,
    targetZ: filtered.z,
    active: true,
    reversing,
    state: {
      referenceYaw,
      reverseHoldSeconds: reversing ? 0 : reverseHoldSeconds,
      reversing,
      filteredX: filtered.x,
      filteredZ: filtered.z,
      hasFilter: true,
    },
  };
}

export function applyTouchStickLive(
  live: TouchStickLive,
  sample: Omit<AimStickSample, 'stick'>,
  params: typeof TOUCH.stick = TOUCH.stick,
): AimStickStep {
  if (live.mode !== 'aim') {
    live.targetHeading = null;
    live.targetX = 0;
    live.targetZ = 0;
    return idleAimStep(live.aim);
  }
  const step = stepAimStick({ ...sample, stick: live.stick }, live.aim, params);
  live.aim = step.state;
  live.targetHeading = step.targetHeading;
  live.targetX = step.targetX;
  live.targetZ = step.targetZ;
  return step;
}
