import { CAMERA } from './config';

export type CameraPreset = keyof typeof CAMERA.presets;
export type CameraRig = { x: number; y: number; z: number; yaw: number; fovDeg: number };
export type CameraTarget = {
  carX: number; carY: number; carZ: number; carHeading: number; carSpeed: number; boosting: boolean;
  ballX: number; ballY: number; ballZ: number;
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
  const { lookAhead, lookHeight } = CAMERA.presets[preset];
  return {
    x: target.carX - Math.sin(rig.yaw) * lookAhead,
    y: target.carY + lookHeight + lookRise,
    z: target.carZ - Math.cos(rig.yaw) * lookAhead,
  };
}

export function createChaseRig(target: CameraTarget, aspect: number, preset: CameraPreset): CameraStep {
  const yaw = target.carHeading;
  const position = desiredPosition(yaw, target, preset);
  const rig: CameraRig = { ...position, yaw, fovDeg: targetFov(target, aspect, {}) };
  return { rig, lookAt: lookPoint(rig, target, preset, 0) };
}

export function stepChaseCamera(
  rig: CameraRig,
  target: CameraTarget,
  dt: number,
  aspect: number,
  preset: CameraPreset,
  options: CameraStepOptions = {},
): CameraStep {
  const assist = ballAssist(target);
  if (dt <= 0) return { rig, lookAt: lookPoint(rig, target, preset, assist.lookRise) };

  const responseScale = options.reducedMotion ? CAMERA.reducedMotionResponseScale : 1;
  const yawBlend = 1 - Math.exp(-CAMERA.yawResponse * responseScale * dt);
  const positionBlend = 1 - Math.exp(-CAMERA.positionResponse * responseScale * dt);
  const fovBlend = 1 - Math.exp(-CAMERA.positionResponse * dt);

  const desiredYaw = target.carHeading + assist.yawOffset;
  let yaw = wrapAngle(rig.yaw + wrapAngle(desiredYaw - rig.yaw) * yawBlend);
  const maxLag = CAMERA.maxYawLagDeg * DEG;
  yaw = wrapAngle(target.carHeading + clamp(wrapAngle(yaw - target.carHeading), -maxLag, maxLag));

  const desired = desiredPosition(yaw, target, preset);
  const jump = Math.hypot(desired.x - rig.x, desired.z - rig.z);
  const snap = jump > CAMERA.snapDistance;
  const next: CameraRig = {
    x: snap ? desired.x : rig.x + (desired.x - rig.x) * positionBlend,
    y: snap ? desired.y : rig.y + (desired.y - rig.y) * positionBlend,
    z: snap ? desired.z : rig.z + (desired.z - rig.z) * positionBlend,
    yaw,
    fovDeg: rig.fovDeg + (targetFov(target, aspect, options) - rig.fovDeg) * fovBlend,
  };
  return { rig: next, lookAt: lookPoint(next, target, preset, assist.lookRise) };
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
