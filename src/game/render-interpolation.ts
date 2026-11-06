/** Pose = [x, y, z, qx, qy, qz, qw]. */
export type Pose = Float32Array;

export const POSE_LENGTH = 7;

export function createPose(): Pose {
  const pose = new Float32Array(POSE_LENGTH);
  pose[6] = 1;
  return pose;
}

export function interpolatePose(previous: Pose, current: Pose, alpha: number, out: Pose = createPose()): Pose {
  const t = Math.min(1, Math.max(0, alpha));
  for (let i = 0; i < 3; i++) out[i] = previous[i] + (current[i] - previous[i]) * t;

  let dot = previous[3] * current[3] + previous[4] * current[4] + previous[5] * current[5] + previous[6] * current[6];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let weightPrevious = 1 - t;
  let weightCurrent = t;
  if (dot < 0.9995) {
    const angle = Math.acos(Math.min(1, dot));
    const sine = Math.sin(angle);
    weightPrevious = Math.sin((1 - t) * angle) / sine;
    weightCurrent = Math.sin(t * angle) / sine;
  }
  let length = 0;
  for (let i = 3; i < POSE_LENGTH; i++) {
    out[i] = previous[i] * weightPrevious + current[i] * sign * weightCurrent;
    length += out[i] * out[i];
  }
  length = Math.sqrt(length) || 1;
  for (let i = 3; i < POSE_LENGTH; i++) out[i] /= length;
  return out;
}

/** Ângulo em torno de Y (convenção do jogo: frente = (-sin h, -cos h)), válido para qualquer rotação só em Y. */
export function yawFromQuaternion(y: number, w: number): number {
  return 2 * Math.atan2(y, w);
}
