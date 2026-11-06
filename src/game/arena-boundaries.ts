import { BALL, CAR, SAFETY } from './config';
import type { ArenaDimensions } from './arena-dimensions';

export type SafetyBounds = { maxX: number; maxZ: number; minY: number; maxY: number };

export function ballSafetyBounds(
  dims: ArenaDimensions,
  ball: { radius: number } = BALL,
  tolerance = SAFETY.tolerance,
): SafetyBounds {
  return {
    maxX: dims.goalBackX - ball.radius + tolerance,
    maxZ: dims.sideWallZ - ball.radius + tolerance,
    minY: ball.radius - tolerance,
    maxY: dims.ceilingY - ball.radius + tolerance,
  };
}

export function carSafetyBounds(
  dims: ArenaDimensions,
  car: { radius: number; halfHeight: number; hitbox: { halfWidth: number; halfHeight: number; halfLength: number } } = CAR,
  tolerance = SAFETY.tolerance,
): SafetyBounds {
  const planar = Math.max(car.hitbox.halfWidth, car.hitbox.halfLength);
  return {
    maxX: dims.goalBackX - planar + tolerance,
    maxZ: dims.sideWallZ - planar + tolerance,
    minY: car.hitbox.halfHeight - tolerance,
    maxY: dims.ceilingY - car.hitbox.halfHeight + tolerance,
  };
}

export function containPlanarBody(
  x: number,
  z: number,
  velocityX: number,
  velocityZ: number,
  maxX: number,
  maxZ: number,
  restitution: number,
) {
  const outsideX = Math.abs(x) > maxX;
  const outsideZ = Math.abs(z) > maxZ;
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    z: Math.max(-maxZ, Math.min(maxZ, z)),
    velocityX: outsideX ? -Math.sign(x) * Math.abs(velocityX) * restitution : velocityX,
    velocityZ: outsideZ ? -Math.sign(z) * Math.abs(velocityZ) * restitution : velocityZ,
  };
}

export function containSpatialBody(
  x: number,
  y: number,
  z: number,
  velocityX: number,
  velocityY: number,
  velocityZ: number,
  maxX: number,
  maxZ: number,
  minY: number,
  maxY: number,
  restitution: number,
) {
  const planar = containPlanarBody(x, z, velocityX, velocityZ, maxX, maxZ, restitution);
  const below = y < minY;
  const above = y > maxY;
  return {
    ...planar,
    y: Math.max(minY, Math.min(maxY, y)),
    velocityY: below ? Math.abs(velocityY) * restitution : above ? -Math.abs(velocityY) * restitution : velocityY,
  };
}

export function containWithSafetyBounds(
  x: number,
  y: number,
  z: number,
  velocityX: number,
  velocityY: number,
  velocityZ: number,
  bounds: SafetyBounds,
  restitution: number,
) {
  return containSpatialBody(x, y, z, velocityX, velocityY, velocityZ, bounds.maxX, bounds.maxZ, bounds.minY, bounds.maxY, restitution);
}
