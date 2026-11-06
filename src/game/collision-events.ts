import type RAPIER from '@dimforge/rapier3d-compat';
import { AI, CAR } from './config';
import type { Vec3 } from './math';

export function handleCollisionEvents(
  events: RAPIER.EventQueue,
  carBodies: RAPIER.RigidBody[],
  carColliderIndices: Map<number, number>,
  ballBody: RAPIER.RigidBody,
  ballColliderHandle: number,
  carVelocitiesBefore: ReadonlyArray<{ x: number; y: number; z: number }>,
  ballVelocityBefore: { x: number; y: number; z: number },
  impactRecovery: Float32Array,
  stats: { playerBallTouches: number },
  onBallHit: (position: Vec3, strength: number) => void,
) {
  events.drainCollisionEvents((first, second, started) => {
    if (!started) return;
    const firstIndex = carColliderIndices.get(first);
    const secondIndex = carColliderIndices.get(second);
    for (const index of [firstIndex, secondIndex]) {
      if (index === undefined) continue;
      const after = carBodies[index].linvel();
      const beforeCar = carVelocitiesBefore[index];
      const impact = Math.hypot(after.x - beforeCar.x, after.y - beforeCar.y, after.z - beforeCar.z);
      if (impact >= CAR.impactRecoveryThreshold) impactRecovery[index] = CAR.impactRecoverySeconds;
    }
    const hitCar = first === ballColliderHandle ? second : second === ballColliderHandle ? first : undefined;
    if (hitCar !== undefined && carColliderIndices.has(hitCar)) {
      if (carColliderIndices.get(hitCar) === AI.playerIndex) stats.playerBallTouches += 1;
      const velocityAfterHit = ballBody.linvel();
      const strength = Math.hypot(velocityAfterHit.x - ballVelocityBefore.x, velocityAfterHit.z - ballVelocityBefore.z);
      if (strength > AI.ballHitSoundThreshold) {
        const position = ballBody.translation();
        onBallHit({ x: position.x, y: position.y, z: position.z }, strength);
      }
    }
  });
}
