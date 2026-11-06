import { AI, BALL, CAR, FIELD, KICK } from './config';
import type { Difficulty } from './match-rules';

export type KickTimer = { cooldown: number; buffer: number };

export type KickVelocityTarget = { x: number; y: number; z: number; power: number };

const DEG = Math.PI / 180;
const CONE_HALF = KICK.coneHalfAngleDeg * DEG;

export function isInKickZone(
  carX: number,
  carZ: number,
  heading: number,
  ballX: number,
  ballY: number,
  ballZ: number,
): boolean {
  if (ballY > KICK.maxBallHeight) return false;
  const dx = ballX - carX;
  const dz = ballZ - carZ;
  const centerDistance = Math.hypot(dx, dz);
  const gap = centerDistance - CAR.radius - BALL.radius;
  if (gap > KICK.reach) return false;
  if (centerDistance < 1e-6) return false;
  const forwardX = -Math.sin(heading);
  const forwardZ = -Math.cos(heading);
  const dot = (dx / centerDistance) * forwardX + (dz / centerDistance) * forwardZ;
  return Math.acos(Math.min(1, Math.max(-1, dot))) <= CONE_HALF;
}

export function kickApex(power: number): number {
  const vy = power * KICK.lift;
  if (vy <= 0) return 0;
  return (vy * vy) / (2 * 9.81);
}

function forwardVector(heading: number) {
  return { x: -Math.sin(heading), z: -Math.cos(heading) };
}

export function kickDirection(
  heading: number,
  carX: number,
  carZ: number,
  ballX: number,
  ballZ: number,
): { x: number; z: number } {
  const dx = ballX - carX;
  const dz = ballZ - carZ;
  const distance = Math.hypot(dx, dz) || 1;
  const normalX = dx / distance;
  const normalZ = dz / distance;
  const forward = forwardVector(heading);
  let mixX = forward.x * KICK.headingWeight + normalX * (1 - KICK.headingWeight);
  let mixZ = forward.z * KICK.headingWeight + normalZ * (1 - KICK.headingWeight);
  const length = Math.hypot(mixX, mixZ) || 1;
  mixX /= length;
  mixZ /= length;
  return applyWallGuard(mixX, mixZ, ballX, ballZ);
}

export function applyWallGuard(dirX: number, dirZ: number, ballX: number, ballZ: number): { x: number; z: number } {
  let x = dirX;
  let z = dirZ;
  const limitX = FIELD.goalBackX - BALL.radius;
  const limitZ = FIELD.sideWallZ - BALL.radius;
  if (ballX > limitX - KICK.wallGuard && x > 0) x = 0;
  if (ballX < -limitX + KICK.wallGuard && x < 0) x = 0;
  if (ballZ > limitZ - KICK.wallGuard && z > 0) z = 0;
  if (ballZ < -limitZ + KICK.wallGuard && z < 0) z = 0;
  const length = Math.hypot(x, z);
  if (length < 1e-6) return { x: dirX, z: dirZ };
  return { x: x / length, z: z / length };
}

export function kickPower(forwardSpeed: number, powerFactor: number): number {
  const raw = KICK.basePower + KICK.speedTransfer * Math.max(0, forwardSpeed);
  return Math.min(KICK.maxPower, raw) * powerFactor;
}

export function computeKickTarget(
  heading: number,
  carX: number,
  carZ: number,
  carVelX: number,
  carVelZ: number,
  ballX: number,
  ballY: number,
  ballZ: number,
  ballVelX: number,
  ballVelY: number,
  ballVelZ: number,
  powerFactor: number,
): KickVelocityTarget | null {
  if (!isInKickZone(carX, carZ, heading, ballX, ballY, ballZ)) return null;
  const forward = forwardVector(heading);
  const forwardSpeed = Math.max(0, carVelX * forward.x + carVelZ * forward.z);
  const power = kickPower(forwardSpeed, powerFactor);
  const dir = kickDirection(heading, carX, carZ, ballX, ballZ);
  return {
    x: dir.x * power,
    y: Math.max(ballVelY, power * KICK.lift),
    z: dir.z * power,
    power,
  };
}

export function impulseForKickTarget(
  target: KickVelocityTarget,
  ballVelX: number,
  ballVelY: number,
  ballVelZ: number,
): { x: number; y: number; z: number } {
  return {
    x: BALL.mass * (target.x - ballVelX),
    y: BALL.mass * (target.y - ballVelY),
    z: BALL.mass * (target.z - ballVelZ),
  };
}

export function resolveSimultaneousKicks(targets: KickVelocityTarget[]): KickVelocityTarget | null {
  if (!targets.length) return null;
  if (targets.length === 1) return targets[0];
  let x = 0;
  let z = 0;
  let y = 0;
  let power = 0;
  for (const target of targets) {
    x += target.x;
    z += target.z;
    y = Math.max(y, target.y);
    power += target.power;
  }
  x /= targets.length;
  z /= targets.length;
  power /= targets.length;
  return { x, y, z, power };
}

export function stepKickTimer(
  timer: KickTimer,
  delta: number,
  pressed: boolean,
  inZone: boolean,
): { timer: KickTimer; fire: boolean; whiff: boolean } {
  let cooldown = Math.max(0, timer.cooldown - delta);
  let buffer = Math.max(0, timer.buffer - delta);
  let fire = false;
  let whiff = false;
  const hadBuffer = timer.buffer > 0;

  if (pressed && cooldown <= 0) {
    if (inZone) {
      fire = true;
      cooldown = KICK.cooldownSeconds;
      buffer = 0;
    } else {
      buffer = KICK.bufferSeconds;
    }
  } else if (!fire && hadBuffer) {
    if (inZone && cooldown <= 0) {
      fire = true;
      cooldown = KICK.cooldownSeconds;
      buffer = 0;
    } else if (buffer <= 0 && !inZone) {
      whiff = true;
      cooldown = KICK.whiffCooldownSeconds;
    }
  }

  return { timer: { cooldown, buffer }, fire, whiff };
}

export function kickAimDotFor(difficulty: Difficulty, round: number): number {
  return Math.min(AI.kickAimDotMax, AI.kickAimDot[difficulty] + (round - 1) * AI.kickAimDotPerRound);
}

export function kickPowerFactorFor(difficulty: Difficulty, round: number): number {
  return Math.min(AI.kickPowerFactorMax, AI.kickPowerFactor[difficulty] + (round - 1) * AI.kickPowerFactorPerRound);
}

export function kickReactionFor(difficulty: Difficulty, round: number): number {
  return Math.max(AI.kickReactionMin, AI.kickReaction[difficulty] + (round - 1) * AI.kickReactionPerRound);
}

export function shouldAiKick(
  dirX: number,
  dirZ: number,
  attackDirX: number,
  ballX: number,
  ballZ: number,
  ownGoalX: number,
  kickAimDot: number,
): boolean {
  const toGoalX = attackDirX;
  const toGoalZ = 0;
  const toGoalLen = Math.hypot(toGoalX, toGoalZ) || 1;
  const aimDot = (dirX * toGoalX + dirZ * toGoalZ) / toGoalLen;
  const defendingThird = (ballX - ownGoalX) * attackDirX < FIELD.goalLineX / 3;
  if (defendingThird) {
    const awayX = -Math.sign(ownGoalX) || 1;
    return dirX * awayX >= 0;
  }
  return aimDot >= kickAimDot;
}
