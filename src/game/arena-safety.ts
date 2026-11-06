import type RAPIER from '@dimforge/rapier3d-compat';
import { BALL, CAR } from './config';
import { containSpatialBody } from './arena-boundaries';
import type { ArenaDimensions } from './arena-dimensions';
import { setVec3, type Vec3 } from './math';
import { getLateralRecoveryImpulse } from './vehicle-dynamics';

const linvel = { x: 0, y: 0, z: 0 };
const translation = { x: 0, y: 0, z: 0 };
const recoveryImpulse = { x: 0, y: 0, z: 0 };

export function clampBodySpeeds(carBodies: RAPIER.RigidBody[], ballBody: RAPIER.RigidBody) {
  for (const body of carBodies) {
    const velocity = body.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed > CAR.maxSpeed && speed > 0) {
      const scale = CAR.maxSpeed / speed;
      body.setLinvel(setVec3(linvel, velocity.x * scale, velocity.y, velocity.z * scale), true);
    }
  }
  {
    const velocity = ballBody.linvel();
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed > BALL.maxSpeed && speed > 0) {
      const scale = BALL.maxSpeed / speed;
      ballBody.setLinvel(setVec3(linvel, velocity.x * scale, velocity.y * scale, velocity.z * scale), true);
    }
  }
}

export function applyImpactRecovery(
  carBodies: RAPIER.RigidBody[],
  headings: readonly number[],
  impactRecovery: Float32Array,
  dt: number,
) {
  for (let index = 0; index < carBodies.length; index++) {
    if (impactRecovery[index] <= 0) continue;
    impactRecovery[index] = Math.max(0, impactRecovery[index] - dt);
    const velocity = carBodies[index].linvel();
    const impulse = getLateralRecoveryImpulse(velocity.x, velocity.z, headings[index], CAR.mass, CAR.impactRecoveryGrip);
    setVec3(recoveryImpulse, impulse.x, 0, impulse.z);
    carBodies[index].applyImpulse(recoveryImpulse, true);
  }
}

function applyBounded(
  body: RAPIER.RigidBody,
  bounded: { x: number; y: number; z: number; velocityX: number; velocityY: number; velocityZ: number },
  position: Vec3,
) {
  if (bounded.x === position.x && bounded.y === position.y && bounded.z === position.z) return false;
  body.setTranslation(setVec3(translation, bounded.x, bounded.y, bounded.z), true);
  body.setLinvel(setVec3(linvel, bounded.velocityX, bounded.velocityY, bounded.velocityZ), true);
  return true;
}

export function applyArenaSafety(
  carBodies: RAPIER.RigidBody[],
  ballBody: RAPIER.RigidBody,
  dims: ArenaDimensions,
  carHeight: number,
  stats: { safetyNetActivations: number },
) {
  const positionBeforeBounds = ballBody.translation();
  const velocityBeforeBounds = ballBody.linvel();
  const boundedBall = containSpatialBody(
    positionBeforeBounds.x,
    positionBeforeBounds.y,
    positionBeforeBounds.z,
    velocityBeforeBounds.x,
    velocityBeforeBounds.y,
    velocityBeforeBounds.z,
    dims.goalBackX - BALL.radius + 0.8,
    dims.sideWallZ - BALL.radius + 0.8,
    BALL.radius - 0.8,
    dims.ceilingY - BALL.radius + 0.8,
    BALL.restitution,
  );
  if (applyBounded(ballBody, boundedBall, positionBeforeBounds)) stats.safetyNetActivations += 1;
  for (const body of carBodies) {
    const position = body.translation();
    const velocity = body.linvel();
    const bounded = containSpatialBody(
      position.x,
      position.y,
      position.z,
      velocity.x,
      velocity.y,
      velocity.z,
      dims.goalBackX - CAR.radius + 0.8,
      dims.sideWallZ - CAR.radius + 0.8,
      carHeight - 0.8,
      dims.ceilingY - CAR.halfHeight + 0.8,
      CAR.restitution,
    );
    if (applyBounded(body, bounded, position)) stats.safetyNetActivations += 1;
  }
}
