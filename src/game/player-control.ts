import type RAPIER from '@dimforge/rapier3d-compat';
import { CAR } from './config';
import { forwardFromHeading, yawQuaternion } from './math';
import { headingDelta, nextForwardSpeed } from './vehicle-dynamics';

/** Aplica acelerador, direção e aderência lateral do jogador. Devolve o heading atualizado. */
export function applyPlayerControl(
  body: RAPIER.RigidBody,
  heading: number,
  steer: number,
  throttle: number,
  dt: number,
): number {
  const velocity = body.linvel();
  const speed = velocity.x * -Math.sin(heading) + velocity.z * -Math.cos(heading);
  heading += headingDelta(steer, speed, dt);
  body.setRotation(yawQuaternion(heading), true);
  const nextDirection = forwardFromHeading(heading);
  const lateralSpeed = velocity.x * nextDirection.z - velocity.z * nextDirection.x;
  const grip = CAR.lateralGrip * (1 - (1 - CAR.turningGripFactor) * Math.abs(steer));
  body.applyImpulse({ x: -nextDirection.z * lateralSpeed * grip, y: 0, z: nextDirection.x * lateralSpeed * grip }, true);
  const currentSpeed = velocity.x * nextDirection.x + velocity.z * nextDirection.z;
  const nextSpeed = nextForwardSpeed(currentSpeed, throttle, dt);
  body.applyImpulse({
    x: nextDirection.x * (nextSpeed - currentSpeed) * CAR.mass,
    y: 0,
    z: nextDirection.z * (nextSpeed - currentSpeed) * CAR.mass,
  }, true);
  return heading;
}
