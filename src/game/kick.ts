import { AI, BALL, CAR, KICK, SIMULATION } from './config';
import { createArenaDimensions } from './arena-dimensions';
import { clamp, forwardFromHeading, lerp, smoothstep } from './math';
import type { Difficulty } from './match-rules';

export type KickTimer = { cooldown: number; buffer: number };

export type KickVelocityTarget = { x: number; y: number; z: number; power: number };

export type KickZoneGeom = {
  carFront?: number;
  ballRadius?: number;
  maxBallHeight?: number;
  reach?: number;
  coneHalfAngleDeg?: number;
  ignoreHeight?: boolean;
};

const DEG = Math.PI / 180;

export function isInKickZone(
  carX: number,
  carZ: number,
  heading: number,
  ballX: number,
  ballY: number,
  ballZ: number,
  geom: KickZoneGeom = {},
): boolean {
  const maxHeight = geom.maxBallHeight ?? KICK.maxBallHeight;
  if (!geom.ignoreHeight && ballY > maxHeight) return false;
  const dx = ballX - carX;
  const dz = ballZ - carZ;
  const centerDistance = Math.hypot(dx, dz);
  const carFront = geom.carFront ?? CAR.hitbox.halfLength;
  const ballRadius = geom.ballRadius ?? BALL.radius;
  const reach = geom.reach ?? KICK.reach;
  const gap = centerDistance - carFront - ballRadius;
  if (gap > reach) return false;
  if (centerDistance < 1e-6) return false;
  const forward = forwardFromHeading(heading);
  const dot = (dx / centerDistance) * forward.x + (dz / centerDistance) * forward.z;
  const cone = (geom.coneHalfAngleDeg ?? KICK.coneHalfAngleDeg) * DEG;
  return Math.acos(Math.min(1, Math.max(-1, dot))) <= cone;
}

export function isInPlanarKickZone(
  carX: number,
  carZ: number,
  heading: number,
  ballX: number,
  ballZ: number,
  geom: KickZoneGeom = {},
): boolean {
  return isInKickZone(carX, carZ, heading, ballX, 0, ballZ, { ...geom, ignoreHeight: true });
}

/** Elevação contextual: rasteira no chão, cabeçada com a bola alta.
 * `lerp(liftGround, liftHigh, curva(y))` entre `liftBlendFromY` e `liftBlendToY`.
 * Ease-out no parâmetro normalizado (a 3,5 u o lift fica ≥ 0,35, como o PR 4 pede;
 * o hermite clássico do GLSL fica em ~0,32 no mesmo ponto). */
export function kickLift(ballY: number, params = KICK): number {
  const t = clamp((ballY - params.liftBlendFromY) / (params.liftBlendToY - params.liftBlendFromY), 0, 1);
  const curved = 1 - (1 - t) * (1 - t);
  return lerp(params.liftGround, params.liftHigh, curved);
}

export function dashHopSpeed(ballY: number, inPlanarZone: boolean, params = KICK): number {
  return inPlanarZone && ballY >= params.liftBlendFromY ? params.highBallHopSpeed : params.hopSpeed;
}

export function dashImpulse(
  heading: number,
  vx: number,
  vy: number,
  vz: number,
  hopSpeed: number,
  mass = CAR.mass,
  dashSpeed = KICK.dashSpeed,
  maxForward = CAR.boostMaxSpeed + KICK.dashMaxExtra,
): { x: number; y: number; z: number } {
  const forward = forwardFromHeading(heading);
  const current = vx * forward.x + vz * forward.z;
  const next = Math.min(current + dashSpeed, maxForward);
  const delta = next - current;
  return {
    x: forward.x * delta * mass,
    y: (hopSpeed - vy) * mass,
    z: forward.z * delta * mass,
  };
}

export function recoilImpulse(
  dirX: number,
  dirZ: number,
  power: number,
  mass = CAR.mass,
  recoil = KICK.recoil,
): { x: number; y: number; z: number } {
  const length = Math.hypot(dirX, dirZ) || 1;
  const scale = -mass * power * recoil;
  return { x: (dirX / length) * scale, y: 0, z: (dirZ / length) * scale };
}

export function kickApex(power: number, lift = KICK.liftHigh): number {
  const vy = power * lift;
  if (vy <= 0) return 0;
  return (vy * vy) / (2 * SIMULATION.gravity * BALL.gravityScale);
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
  const forward = forwardFromHeading(heading);
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
  const dims = createArenaDimensions();
  const limitX = dims.goalBackX - BALL.radius;
  const limitZ = dims.sideWallZ - BALL.radius;
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
  const forward = forwardFromHeading(heading);
  const forwardSpeed = Math.max(0, carVelX * forward.x + carVelZ * forward.z);
  const power = kickPower(forwardSpeed, powerFactor);
  const dir = kickDirection(heading, carX, carZ, ballX, ballZ);
  const lift = kickLift(ballY);
  return {
    x: dir.x * power,
    y: Math.max(ballVelY, power * lift),
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
): { timer: KickTimer; fire: boolean; dashStarted: boolean } {
  let cooldown = Math.max(0, timer.cooldown - delta);
  let buffer = Math.max(0, timer.buffer - delta);
  let fire = false;
  let dashStarted = false;

  if (pressed && cooldown <= 0) {
    dashStarted = true;
    cooldown = KICK.cooldownSeconds;
    buffer = KICK.dashSeconds;
    if (inZone) {
      fire = true;
      buffer = 0;
    }
  } else if (buffer > 0 && inZone) {
    fire = true;
    buffer = 0;
  }

  return { timer: { cooldown, buffer }, fire, dashStarted };
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
  const defendingThird = (ballX - ownGoalX) * attackDirX < createArenaDimensions().goalLineX / 3;
  if (defendingThird) {
    const awayX = -Math.sign(ownGoalX) || 1;
    return dirX * awayX >= 0;
  }
  return aimDot >= kickAimDot;
}

/** Verdadeiro se a bola, com esta velocidade, cruza a linha do gol dentro da boca do gol. */
export function isShotOnGoal(ballX: number, ballZ: number, velocityX: number, velocityZ: number, goalX: number, goalHalfWidth: number): boolean {
  if (Math.abs(velocityX) < 1e-6 || Math.sign(velocityX) !== Math.sign(goalX - ballX)) return false;
  const crossingZ = ballZ + velocityZ * ((goalX - ballX) / velocityX);
  return Math.abs(crossingZ) <= goalHalfWidth;
}

export function visualPitchRad(dashRemaining: number, params = KICK): number {
  if (dashRemaining <= 0 || params.dashSeconds <= 0) return 0;
  return smoothstep(0, params.dashSeconds, dashRemaining) * params.visualPitchDeg * DEG;
}
