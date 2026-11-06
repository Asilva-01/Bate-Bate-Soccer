import type RAPIER from '@dimforge/rapier3d-compat';
import { CAR } from './config';
import { forwardFromHeading, yawQuaternion } from './math';
import { headingDelta, nextForwardSpeed } from './vehicle-dynamics';

const rotation = { x: 0, y: 0, z: 0, w: 1 };
const forward = { x: 0, z: 0 };
const lateralImpulse = { x: 0, y: 0, z: 0 };
const throttleImpulse = { x: 0, y: 0, z: 0 };

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
  body.setRotation(yawQuaternion(heading, rotation), true);
  forwardFromHeading(heading, forward);
  const lateralSpeed = velocity.x * forward.z - velocity.z * forward.x;
  const grip = CAR.lateralGrip * (1 - (1 - CAR.turningGripFactor) * Math.abs(steer));
  lateralImpulse.x = -forward.z * lateralSpeed * grip;
  lateralImpulse.y = 0;
  lateralImpulse.z = forward.x * lateralSpeed * grip;
  body.applyImpulse(lateralImpulse, true);
  const currentSpeed = velocity.x * forward.x + velocity.z * forward.z;
  const nextSpeed = nextForwardSpeed(currentSpeed, throttle, dt);
  const deltaSpeed = (nextSpeed - currentSpeed) * CAR.mass;
  throttleImpulse.x = forward.x * deltaSpeed;
  throttleImpulse.y = 0;
  throttleImpulse.z = forward.z * deltaSpeed;
  body.applyImpulse(throttleImpulse, true);
  return heading;
}
