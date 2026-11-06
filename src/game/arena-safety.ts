import type RAPIER from '@dimforge/rapier3d-compat';
import { BALL, CAR } from './config';
import { containSpatialBody } from './arena-boundaries';
import type { ArenaDimensions } from './arena-dimensions';
import { getLateralRecoveryImpulse } from './vehicle-dynamics';

export function clampBodySpeeds(carBodies: RAPIER.RigidBody[], ballBody: RAPIER.RigidBody) {
  for (const body of carBodies) {
    const velocity = body.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed > CAR.maxSpeed && speed > 0) body.setLinvel({ x: velocity.x * CAR.maxSpeed / speed, y: velocity.y, z: velocity.z * CAR.maxSpeed / speed }, true);
  }
  {
    const velocity = ballBody.linvel();
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed > BALL.maxSpeed && speed > 0) {
      const scale = BALL.maxSpeed / speed;
      ballBody.setLinvel({ x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale }, true);
    }
  }
}

export function applyImpactRecovery(
  carBodies: RAPIER.RigidBody[],
  headings: readonly number[],
  impactRecovery: Float32Array,
  dt: number,
) {
  carBodies.forEach((body, index) => {
    if (impactRecovery[index] <= 0) return;
    impactRecovery[index] = Math.max(0, impactRecovery[index] - dt);
    const velocity = body.linvel();
    const impulse = getLateralRecoveryImpulse(velocity.x, velocity.z, headings[index], CAR.mass, CAR.impactRecoveryGrip);
    body.applyImpulse({ x: impulse.x, y: 0, z: impulse.z }, true);
  });
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
  if (boundedBall.x !== positionBeforeBounds.x || boundedBall.y !== positionBeforeBounds.y || boundedBall.z !== positionBeforeBounds.z) {
    stats.safetyNetActivations += 1;
    ballBody.setTranslation({ x: boundedBall.x, y: boundedBall.y, z: boundedBall.z }, true);
    ballBody.setLinvel({ x: boundedBall.velocityX, y: boundedBall.velocityY, z: boundedBall.velocityZ }, true);
  }
  carBodies.forEach((body) => {
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
    if (bounded.x !== position.x || bounded.y !== position.y || bounded.z !== position.z) {
      stats.safetyNetActivations += 1;
      body.setTranslation({ x: bounded.x, y: bounded.y, z: bounded.z }, true);
      body.setLinvel({ x: bounded.velocityX, y: bounded.velocityY, z: bounded.velocityZ }, true);
    }
  });
}
