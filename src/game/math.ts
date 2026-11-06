export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Quaternion de yaw em Y, equivalente a `setFromAxisAngle((0,1,0), yaw)`. */
export function yawQuaternion(yaw: number, out: Quat = { x: 0, y: 0, z: 0, w: 1 }): Quat {
  out.x = 0;
  out.y = Math.sin(yaw / 2);
  out.z = 0;
  out.w = Math.cos(yaw / 2);
  return out;
}

export function forwardFromHeading(heading: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  out.x = -Math.sin(heading);
  out.z = -Math.cos(heading);
  return out;
}

export function setVec3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}
