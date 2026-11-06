import { CAMERA } from './config';
import type { ArenaDimensions } from './arena-dimensions';

export type CameraMode = 'car' | 'ball';
export type CameraPreset = keyof typeof CAMERA.presets;
export type CameraRig = { x: number; y: number; z: number; yaw: number; fovDeg: number };
export type CameraTarget = {
  carX: number; carY: number; carZ: number; carHeading: number; carSpeed: number; boosting: boolean;
  ballX: number; ballY: number; ballZ: number;
  mode: CameraMode;
};
export type CameraStepOptions = { reducedMotion?: boolean };
export type CameraStep = { rig: CameraRig; lookAt: { x: number; y: number; z: number } };

export type ScreenInsets = { left: number; right: number; top: number; bottom: number };
export type IndicatorPosition = { x: number; y: number; angleRad: number };

const DEG = Math.PI / 180;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function verticalFovForAspect(aspect: number, hFovDeg: number, minVDeg: number, maxVDeg: number): number {
  const vertical = 2 * Math.atan(Math.tan((hFovDeg * DEG) / 2) / aspect) / DEG;
  return clamp(vertical, minVDeg, maxVDeg);
}

export function clampCameraToArena(
  pos: { x: number; y: number; z: number },
  arena: ArenaDimensions,
  margin: number,
): { x: number; y: number; z: number; lostDistance: number } {
  const minY = margin;
  const maxY = arena.ceilingY - margin;
  let x = pos.x;
  let y = clamp(pos.y, minY, maxY);
  let z = pos.z;

  const inMouth = Math.abs(z) <= arena.goalHalfWidth - margin;
  const pastGoalLine = Math.abs(x) > arena.goalLineX - margin;
  if (pastGoalLine && inMouth) {
    const end = Math.sign(x) || 1;
    x = clamp(x, -arena.goalBackX + margin, arena.goalBackX - margin);
    if (end > 0) x = Math.max(x, arena.goalLineX - margin);
    else x = Math.min(x, -arena.goalLineX + margin);
    z = clamp(z, -arena.goalHalfWidth + margin, arena.goalHalfWidth - margin);
    y = Math.min(y, arena.goalHeight - margin);
  } else {
    x = clamp(x, -arena.goalLineX + margin, arena.goalLineX - margin);
    z = clamp(z, -arena.sideWallZ + margin, arena.sideWallZ - margin);
    const chamferLimit = arena.goalLineX + arena.sideWallZ - arena.cornerChamfer - margin * Math.SQRT2;
    const extent = Math.abs(x) + Math.abs(z);
    if (extent > chamferLimit) {
      const extra = extent - chamferLimit;
      const ax = Math.abs(x) || 1e-6;
      const az = Math.abs(z) || 1e-6;
      x -= Math.sign(x) * extra * (ax / (ax + az));
      z -= Math.sign(z) * extra * (az / (ax + az));
    }
  }

  y = clamp(y, minY, maxY);
  return {
    x,
    y,
    z,
    lostDistance: Math.hypot(pos.x - x, pos.y - y, pos.z - z),
  };
}

function ballAssist(target: CameraTarget) {
  const assist = CAMERA.ballAssist;
  const dx = target.ballX - target.carX;
  const dz = target.ballZ - target.carZ;
  const distance = Math.hypot(dx, dz);
  if (distance >= assist.maxDistance) return { yawOffset: 0, lookRise: 0 };
  const bearing = Math.atan2(-dx, -dz);
  const difference = wrapAngle(bearing - target.carHeading);
  const cone = assist.coneDeg * DEG;
  const weight = (1 - smoothstep(cone * 0.6, cone, Math.abs(difference)))
    * (1 - smoothstep(assist.maxDistance * 0.6, assist.maxDistance, distance))
    * smoothstep(assist.minDistance * 0.5, assist.minDistance, distance);
  const maxYaw = assist.maxYawDeg * DEG;
  return {
    yawOffset: clamp(difference, -maxYaw, maxYaw) * weight,
    lookRise: target.ballY * assist.lookRisePerBallY * weight,
  };
}

function baseFov(aspect: number) {
  return verticalFovForAspect(aspect, CAMERA.hFovDeg, CAMERA.vFovMinDeg, CAMERA.vFovMaxDeg);
}

function targetFov(target: CameraTarget, aspect: number, options: CameraStepOptions) {
  return baseFov(aspect) + (target.boosting && !options.reducedMotion ? CAMERA.boostFovDeg : 0);
}

function desiredPosition(yaw: number, target: CameraTarget, preset: CameraPreset) {
  const { distance, height } = CAMERA.presets[preset];
  return {
    x: target.carX + Math.sin(yaw) * distance,
    y: target.carY + height,
    z: target.carZ + Math.cos(yaw) * distance,
  };
}

function lookPoint(rig: CameraRig, target: CameraTarget, preset: CameraPreset, lookRise: number) {
  if (target.mode === 'ball') {
    const { lookBallWeight, heightPerBallY } = CAMERA.ballCam;
    const { lookHeight } = CAMERA.presets[preset];
    return {
      x: target.carX + (target.ballX - target.carX) * lookBallWeight,
      y: target.carY + lookHeight + target.ballY * heightPerBallY,
      z: target.carZ + (target.ballZ - target.carZ) * lookBallWeight,
    };
  }
  const { lookAhead, lookHeight } = CAMERA.presets[preset];
  return {
    x: target.carX - Math.sin(rig.yaw) * lookAhead,
    y: target.carY + lookHeight + lookRise,
    z: target.carZ - Math.cos(rig.yaw) * lookAhead,
  };
}

function desiredYaw(target: CameraTarget, currentYaw: number) {
  if (target.mode !== 'ball') return target.carHeading + ballAssist(target).yawOffset;
  const dx = target.ballX - target.carX;
  const dz = target.ballZ - target.carZ;
  const planar = Math.hypot(dx, dz);
  if (planar < CAMERA.ballCam.minPlanarDistance) return currentYaw;
  return Math.atan2(-dx, -dz);
}

function applyArena(position: { x: number; y: number; z: number }, target: CameraTarget, arena: ArenaDimensions) {
  const clamped = clampCameraToArena(position, arena, CAMERA.wallMargin);
  let x = clamped.x;
  let y = clamped.y + CAMERA.heightGainPerLostDistance * clamped.lostDistance;
  let z = clamped.z;
  y = Math.min(y, arena.ceilingY - CAMERA.wallMargin);
  const dx = x - target.carX;
  const dy = y - target.carY;
  const dz = z - target.carZ;
  const planar = Math.hypot(dx, dz);
  const minDist = CAMERA.minDistanceNearWall;
  if (planar * planar + dy * dy < minDist * minDist) {
    const needed = Math.sqrt(Math.max(0, minDist * minDist - planar * planar));
    y = Math.max(y, target.carY + needed);
    y = Math.min(y, arena.ceilingY - CAMERA.wallMargin);
  }
  const settled = clampCameraToArena({ x, y, z }, arena, CAMERA.wallMargin);
  return { x: settled.x, y: settled.y, z: settled.z, lostDistance: clamped.lostDistance };
}

export function createChaseRig(
  target: CameraTarget,
  aspect: number,
  arena: ArenaDimensions,
  preset: CameraPreset,
): CameraStep {
  const yaw = desiredYaw(target, target.carHeading);
  const position = applyArena(desiredPosition(yaw, target, preset), target, arena);
  const rig: CameraRig = { ...position, yaw, fovDeg: targetFov(target, aspect, {}) };
  return { rig, lookAt: lookPoint(rig, target, preset, target.mode === 'car' ? ballAssist(target).lookRise : 0) };
}

export function stepChaseCamera(
  rig: CameraRig,
  target: CameraTarget,
  dt: number,
  aspect: number,
  arena: ArenaDimensions,
  preset: CameraPreset,
  options: CameraStepOptions = {},
): CameraStep {
  const assist = target.mode === 'car' ? ballAssist(target) : { yawOffset: 0, lookRise: 0 };
  if (dt <= 0) return { rig, lookAt: lookPoint(rig, target, preset, assist.lookRise) };

  const responseScale = options.reducedMotion ? CAMERA.reducedMotionResponseScale : 1;
  const yawBlend = 1 - Math.exp(-CAMERA.yawResponse * responseScale * dt);
  const positionBlend = 1 - Math.exp(-CAMERA.positionResponse * responseScale * dt);
  const fovBlend = 1 - Math.exp(-CAMERA.positionResponse * dt);

  const wantedYaw = desiredYaw(target, rig.yaw);
  let yaw = wrapAngle(rig.yaw + wrapAngle(wantedYaw - rig.yaw) * yawBlend);
  if (target.mode === 'car') {
    const maxLag = CAMERA.maxYawLagDeg * DEG;
    yaw = wrapAngle(target.carHeading + clamp(wrapAngle(yaw - target.carHeading), -maxLag, maxLag));
  }

  const placed = applyArena(desiredPosition(yaw, target, preset), target, arena);
  const jump = Math.hypot(placed.x - rig.x, placed.z - rig.z);
  const snap = jump > CAMERA.snapDistance;
  const next: CameraRig = {
    x: snap ? placed.x : rig.x + (placed.x - rig.x) * positionBlend,
    y: snap ? placed.y : rig.y + (placed.y - rig.y) * positionBlend,
    z: snap ? placed.z : rig.z + (placed.z - rig.z) * positionBlend,
    yaw,
    fovDeg: rig.fovDeg + (targetFov(target, aspect, options) - rig.fovDeg) * fovBlend,
  };
  const settled = applyArena(next, target, arena);
  const clamped: CameraRig = { ...next, x: settled.x, y: settled.y, z: settled.z };
  return { rig: clamped, lookAt: lookPoint(clamped, target, preset, assist.lookRise) };
}

/** `ndc.y` positivo = para cima. Devolve a posição em px (origem no canto superior esquerdo) ou `null` com a bola visível. */
export function offscreenIndicator(
  ndc: { x: number; y: number },
  behind: boolean,
  insets: ScreenInsets,
  viewport: { width: number; height: number },
): IndicatorPosition | null {
  const limit = CAMERA.indicatorNdcLimit;
  if (!behind && Math.abs(ndc.x) <= limit && Math.abs(ndc.y) <= limit) return null;

  let dx = (behind ? -ndc.x : ndc.x) * (viewport.width / 2);
  let dy = -(behind ? -ndc.y : ndc.y) * (viewport.height / 2);
  if (behind) dy = Math.max(Math.abs(dy), 2 * Math.abs(dx));
  if (Math.hypot(dx, dy) < 1e-6) dy = 1;

  const halfWidth = Math.max(1, (viewport.width - insets.left - insets.right) / 2);
  const halfHeight = Math.max(1, (viewport.height - insets.top - insets.bottom) / 2);
  const centerX = insets.left + halfWidth;
  const centerY = insets.top + halfHeight;
  const scale = 1 / Math.hypot(dx / halfWidth, dy / halfHeight);
  return { x: centerX + dx * scale, y: centerY + dy * scale, angleRad: Math.atan2(dy, dx) };
}
