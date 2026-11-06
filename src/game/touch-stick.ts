import { TOUCH } from './config';

export type StickVector = { x: number; y: number };
export type DriveAxes = { throttle: number; steer: number };
export type Point = { x: number; y: number };
export type Bounds = { left: number; top: number; right: number; bottom: number };

const DEG = Math.PI / 180;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const noNegativeZero = (value: number) => (value === 0 ? 0 : value);

/** `dyPx` segue as coordenadas da tela (positivo = para baixo); o vetor devolvido tem y positivo para cima. */
export function normalizeStick(dxPx: number, dyPx: number, radiusPx: number): StickVector {
  const x = dxPx / radiusPx;
  const y = -dyPx / radiusPx;
  const length = Math.hypot(x, y);
  if (length <= 1) return { x: noNegativeZero(x), y: noNegativeZero(y) };
  return { x: x / length, y: y / length };
}

export function stickToDrive(stick: StickVector, params: typeof TOUCH.stick = TOUCH.stick): DriveAxes {
  const length = Math.hypot(stick.x, stick.y);
  const magnitude = clamp((length - params.deadzone) / (params.saturation - params.deadzone), 0, 1);
  if (magnitude === 0) return { throttle: 0, steer: 0 };
  const theta = Math.atan2(stick.x, stick.y);
  const absTheta = Math.abs(theta);
  if (absTheta <= params.frontHalfAngleDeg * DEG) {
    return {
      throttle: magnitude,
      steer: noNegativeZero(clamp(theta / (params.steerFullAngleDeg * DEG), -1, 1)),
    };
  }
  const sideways = clamp((Math.PI - absTheta) / (params.reverseSteerFullAngleDeg * DEG), 0, 1);
  return { throttle: -magnitude, steer: noNegativeZero(Math.sign(theta) * sideways) };
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
