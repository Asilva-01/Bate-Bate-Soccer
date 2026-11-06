export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Quaternion de yaw em Y, equivalente a `setFromAxisAngle((0,1,0), yaw)`. */
export function yawQuaternion(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export function forwardFromHeading(heading: number): { x: number; z: number } {
  return { x: -Math.sin(heading), z: -Math.cos(heading) };
}
