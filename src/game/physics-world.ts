import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA, BALL, CAR } from './config';
import type { ArenaDimensions } from './arena-dimensions';

export const COLLISION_GROUP = {
  FLOOR: 1 << 0,
  WALL: 1 << 1,
  CAR: 1 << 2,
  BALL: 1 << 3,
  CAR_GROUND: 1 << 4,
} as const;

export function collisionGroups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

function yawRotation(yaw: number) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function staticCuboid(
  world: RAPIER.World,
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  groups: number,
  restitution: number,
  friction: number,
  rotation?: { x: number; y: number; z: number; w: number },
) {
  const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setTranslation(x, y, z)
    .setRestitution(restitution)
    .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
    .setFriction(friction)
    .setCollisionGroups(groups)
    .setSolverGroups(groups);
  if (rotation) desc.setRotation(rotation);
  world.createCollider(desc);
}

export function createStaticArena(world: RAPIER.World, dims: ArenaDimensions): void {
  const thickness = dims.wallThickness;
  const halfThick = thickness / 2;
  const wallGroups = collisionGroups(COLLISION_GROUP.WALL, COLLISION_GROUP.BALL | COLLISION_GROUP.CAR);
  const floorGroups = collisionGroups(COLLISION_GROUP.FLOOR, COLLISION_GROUP.BALL | COLLISION_GROUP.CAR_GROUND);
  const wallRestitution = ARENA.wallRestitution;
  const floorRestitution = ARENA.floorRestitution;
  const wallFriction = ARENA.wallFriction;
  const floorFriction = ARENA.floorFriction;
  const wallHeight = dims.ceilingY;
  const wallCenterY = wallHeight / 2;
  const backSegment = dims.sideWallZ - dims.cornerChamfer - dims.goalHalfWidth;
  const outerX = dims.goalBackX + thickness;
  const outerZ = dims.sideWallZ + thickness;

  staticCuboid(world, 0, -halfThick, 0, outerX, halfThick, outerZ, floorGroups, floorRestitution, floorFriction);
  staticCuboid(world, 0, dims.ceilingY + halfThick, 0, outerX, halfThick, outerZ, wallGroups, wallRestitution, wallFriction);

  for (const side of [-1, 1]) {
    staticCuboid(
      world,
      0,
      wallCenterY,
      side * (dims.sideWallZ + halfThick),
      dims.goalBackX + thickness,
      wallCenterY,
      halfThick,
      wallGroups,
      wallRestitution,
      wallFriction,
    );
  }

  for (const end of [-1, 1]) {
    for (const lane of [-1, 1]) {
      const segmentCenterZ = lane * (dims.goalHalfWidth + backSegment / 2);
      staticCuboid(
        world,
        end * (dims.goalLineX + halfThick),
        wallCenterY,
        segmentCenterZ,
        halfThick,
        wallCenterY,
        backSegment / 2,
        wallGroups,
        wallRestitution,
        wallFriction,
      );
    }
    const aboveHeight = dims.ceilingY - dims.goalHeight;
    staticCuboid(
      world,
      end * (dims.goalLineX + halfThick),
      dims.goalHeight + aboveHeight / 2,
      0,
      halfThick,
      aboveHeight / 2,
      dims.goalHalfWidth,
      wallGroups,
      wallRestitution,
      wallFriction,
    );
    staticCuboid(
      world,
      end * (dims.goalBackX + halfThick),
      wallCenterY,
      0,
      halfThick,
      wallCenterY,
      dims.sideWallZ + thickness,
      wallGroups,
      wallRestitution,
      wallFriction,
    );
    for (const lane of [-1, 1]) {
      staticCuboid(
        world,
        end * (dims.goalLineX + ARENA.goal.depth / 2),
        dims.goalHeight / 2,
        lane * (dims.goalHalfWidth + halfThick),
        ARENA.goal.depth / 2,
        dims.goalHeight / 2,
        halfThick,
        wallGroups,
        wallRestitution,
        wallFriction,
      );
    }
    staticCuboid(
      world,
      end * (dims.goalLineX + ARENA.goal.depth / 2),
      dims.goalHeight + halfThick,
      0,
      ARENA.goal.depth / 2,
      halfThick,
      dims.goalHalfWidth,
      wallGroups,
      wallRestitution,
      wallFriction,
    );
  }

  const chamferOffset = halfThick / Math.SQRT2;
  const corners = [
    { sx: 1, sz: 1, yaw: -Math.PI / 4 },
    { sx: 1, sz: -1, yaw: Math.PI / 4 },
    { sx: -1, sz: 1, yaw: (-3 * Math.PI) / 4 },
    { sx: -1, sz: -1, yaw: (3 * Math.PI) / 4 },
  ] as const;
  for (const { sx, sz, yaw } of corners) {
    staticCuboid(
      world,
      sx * (dims.goalLineX - dims.cornerChamfer / 2) + sx * chamferOffset,
      wallCenterY,
      sz * (dims.sideWallZ - dims.cornerChamfer / 2) + sz * chamferOffset,
      halfThick,
      wallCenterY,
      (dims.cornerChamfer * Math.SQRT2) / 2 + thickness,
      wallGroups,
      wallRestitution,
      wallFriction,
      yawRotation(yaw),
    );
  }
}

export function addBallToWorld(world: RAPIER.World): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const groups = collisionGroups(
    COLLISION_GROUP.BALL,
    COLLISION_GROUP.FLOOR | COLLISION_GROUP.WALL | COLLISION_GROUP.CAR,
  );
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, BALL.radius + BALL.bodyOffset, 0)
      .setCcdEnabled(true)
      .setLinearDamping(BALL.linearDamping)
      .setAngularDamping(BALL.angularDamping)
      .setGravityScale(BALL.gravityScale),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.ball(BALL.radius)
      .setMass(BALL.mass)
      .setRestitution(BALL.restitution)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setFriction(BALL.friction)
      .setCollisionGroups(groups)
      .setSolverGroups(groups)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );
  return { body, collider };
}

export function addCarToWorld(
  world: RAPIER.World,
  x: number,
  y: number,
  z: number,
): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const bodyGroups = collisionGroups(
    COLLISION_GROUP.CAR,
    COLLISION_GROUP.WALL | COLLISION_GROUP.BALL | COLLISION_GROUP.CAR,
  );
  const groundGroups = collisionGroups(COLLISION_GROUP.CAR_GROUND, COLLISION_GROUP.FLOOR);
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setCcdEnabled(true)
      .setLinearDamping(CAR.bodyLinearDamping)
      .setAngularDamping(CAR.angularDamping),
  );
  body.setEnabledRotations(false, true, false, true);
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cylinder(CAR.halfHeight, CAR.radius)
      .setMass(CAR.mass)
      .setFriction(CAR.contactFriction)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setRestitution(CAR.restitution)
      .setCollisionGroups(bodyGroups)
      .setSolverGroups(bodyGroups)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );
  const skateHalfHeight = 0.04;
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(skateHalfHeight, CAR.radius)
      .setTranslation(0, skateHalfHeight - y, 0)
      .setDensity(0)
      .setFriction(CAR.friction)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0)
      .setCollisionGroups(groundGroups)
      .setSolverGroups(groundGroups),
    body,
  );
  return { body, collider };
}
