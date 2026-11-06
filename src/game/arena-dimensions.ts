import { ARENA, BALL, CAR, KICK, SIMULATION } from './config';

export type ArenaDimensions = {
  goalLineX: number;
  sideWallZ: number;
  ceilingY: number;
  cornerChamfer: number;
  goalHalfWidth: number;
  goalHeight: number;
  goalBackX: number;
  wallThickness: number;
};

export function createArenaDimensions(params = ARENA): ArenaDimensions {
  return {
    goalLineX: params.goalLineX,
    sideWallZ: params.sideWallZ,
    ceilingY: params.ceilingY,
    cornerChamfer: params.cornerChamfer,
    goalHalfWidth: params.goal.halfWidth,
    goalHeight: params.goal.height,
    goalBackX: params.goalLineX + params.goal.depth,
    wallThickness: params.wallThickness,
  };
}

export function arenaInvariants(
  dims: ArenaDimensions,
  ball: { radius: number; gravityScale?: number } = BALL,
  _car: { radius: number } = CAR,
): string[] {
  const errors: string[] = [];
  const diameter = ball.radius * 2;
  const depth = dims.goalBackX - dims.goalLineX;
  if (!(depth > diameter)) errors.push(`goal depth ${depth} must exceed ball diameter ${diameter}`);
  if (!(dims.goalHeight > diameter + 1)) errors.push(`goal height ${dims.goalHeight} must exceed ball diameter + 1 (${diameter + 1})`);
  if (!(dims.goalHalfWidth * 2 > diameter)) errors.push(`goal width ${dims.goalHalfWidth * 2} must exceed ball diameter ${diameter}`);
  if (!(dims.cornerChamfer > 0)) errors.push('corner chamfer must be positive');
  if (!(dims.sideWallZ - dims.cornerChamfer > dims.goalHalfWidth)) {
    errors.push('chamfer must not close the goal mouth');
  }
  const lift = 'liftHigh' in KICK ? Number((KICK as { liftHigh: number }).liftHigh) : KICK.lift;
  const vy = KICK.maxPower * lift;
  const gravity = SIMULATION.gravity * (ball.gravityScale ?? 1);
  const peak = ball.radius + (vy * vy) / (2 * gravity);
  if (!(peak < dims.ceilingY)) errors.push(`strongest touch peak ${peak.toFixed(2)} must stay below ceiling ${dims.ceilingY}`);
  return errors;
}

export function ballEnteredGoalFromSide(
  x: number,
  y: number,
  z: number,
  radius: number,
  dims: ArenaDimensions,
  epsilon = 0.05,
): boolean {
  const pastLine = Math.abs(x) > dims.goalLineX + epsilon;
  const beforeBack = Math.abs(x) < dims.goalBackX + radius;
  const besideMouth = Math.abs(z) > dims.goalHalfWidth + epsilon;
  const belowCrossbar = y - radius < dims.goalHeight + epsilon;
  return pastLine && beforeBack && besideMouth && belowCrossbar;
}

export function ballIsInsideArena(
  x: number,
  y: number,
  z: number,
  radius: number,
  dims: ArenaDimensions,
  epsilon = 0.12,
): boolean {
  if (y < radius - epsilon || y > dims.ceilingY - radius + epsilon) return false;
  if (Math.abs(z) > dims.sideWallZ - radius + epsilon) return false;
  if (Math.abs(x) > dims.goalBackX - radius + epsilon) return false;

  const inGoal = Math.abs(x) >= dims.goalLineX - radius
    && Math.abs(z) <= dims.goalHalfWidth - radius + epsilon
    && y + radius <= dims.goalHeight + epsilon;
  if (inGoal) return true;

  if (Math.abs(x) > dims.goalLineX - radius + epsilon) return false;
  const chamferLimit = dims.goalLineX + dims.sideWallZ - dims.cornerChamfer - radius * Math.SQRT2;
  return Math.abs(x) + Math.abs(z) <= chamferLimit + epsilon;
}
