import type RAPIER from '@dimforge/rapier3d-compat';
import { AI, CAR } from './config';
import { clamp, setVec3, wrapAngle, type Quat, type Vec3 } from './math';
import { selectAttacker, type Difficulty } from './match-rules';
import type { ArenaDimensions } from './arena-dimensions';
import type { DriveCommand } from './controls';
import type { Rng } from './rng';

export type AiOpponentState = { blockedTime: number; recoveryTime: number; attacking: boolean; recoverySteer: number };

type CarSlot = { body: RAPIER.RigidBody; carIndex: number };

export type AiScratch = {
  rotation: Quat;
  linvel: Vec3;
  predictedBall: Vec3;
  slots: CarSlot[];
  redTeam: CarSlot[];
  blueTeam: CarSlot[];
  redPositions: Vec3[];
  bluePositions: Vec3[];
  attackerPositions: Vec3[];
};

export function createAiOpponents(count: number): AiOpponentState[] {
  return Array.from({ length: count }, () => ({ blockedTime: 0, recoveryTime: 0, attacking: false, recoverySteer: 0 }));
}

export function createAiScratch(count: number): AiScratch {
  return {
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    linvel: { x: 0, y: 0, z: 0 },
    predictedBall: { x: 0, y: 0, z: 0 },
    slots: Array.from({ length: count }, (_, carIndex) => ({ body: undefined as unknown as RAPIER.RigidBody, carIndex })),
    redTeam: [],
    blueTeam: [],
    redPositions: Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0 })),
    bluePositions: Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0 })),
    attackerPositions: [],
  };
}

export function resetAiOpponents(opponents: AiOpponentState[]) {
  opponents.forEach((opponent) => {
    opponent.blockedTime = 0;
    opponent.recoveryTime = 0;
    opponent.attacking = false;
    opponent.recoverySteer = 0;
  });
}

function fillTeamPositions(team: CarSlot[], pool: Vec3[], out: Vec3[]) {
  out.length = 0;
  for (let i = 0; i < team.length; i++) {
    const position = team[i].body.translation();
    const slot = pool[i];
    setVec3(slot, position.x, position.y, position.z);
    out.push(slot);
  }
}

const IDLE_COMMAND: DriveCommand = { throttle: 0, steer: 0, boost: false, kick: false };

/** IA atual: persegue o alvo que já calcula e devolve `DriveCommand`, sem `setLinvel`. */
export function applyAiControl(
  carBodies: RAPIER.RigidBody[],
  ballBody: RAPIER.RigidBody,
  dims: ArenaDimensions,
  enabled: (index: number) => boolean,
  aiHeadings: readonly number[],
  opponents: AiOpponentState[],
  isActiveAttacker: boolean[],
  commands: DriveCommand[],
  difficulty: Difficulty,
  _round: number,
  dt: number,
  rng: Rng,
  scratch: AiScratch,
) {
  const target = ballBody.translation();
  const ballVelocity = ballBody.linvel();
  const predictedX = clamp(target.x + ballVelocity.x * AI.predictionSeconds, -dims.goalLineX, dims.goalLineX);
  const predictedZ = clamp(target.z + ballVelocity.z * AI.predictionSeconds, -dims.sideWallZ + AI.wallClearance, dims.sideWallZ - AI.wallClearance);
  setVec3(scratch.predictedBall, predictedX, target.y, predictedZ);

  const redTeam = scratch.redTeam;
  const blueTeam = scratch.blueTeam;
  redTeam.length = 0;
  blueTeam.length = 0;
  for (let carIndex = 1; carIndex < carBodies.length; carIndex++) {
    if (!enabled(carIndex)) continue;
    const slot = scratch.slots[carIndex];
    slot.body = carBodies[carIndex];
    if (carIndex === AI.redAllyIndex) redTeam.push(slot);
    else blueTeam.push(slot);
  }

  for (let index = 1; index < carBodies.length; index++) {
    isActiveAttacker[index] = false;
    commands[index] = IDLE_COMMAND;
    if (!enabled(index)) continue;
    const opponent = carBodies[index];
    const opponentState = opponents[index];
    const position = opponent.translation();
    const pushX = index === AI.redAllyIndex ? 1 : -1;
    const playerPosition = carBodies[0].translation();
    const playerBlocksGoal = index !== AI.redAllyIndex && playerPosition.x < target.x - AI.playerBlockGoalXMargin && Math.abs(playerPosition.z - target.z) < AI.playerBlockGoalZRange;
    const aimZ = playerBlocksGoal ? (playerPosition.z >= 0 ? -AI.aimLaneOffset : AI.aimLaneOffset) : 0;
    const goalX = index === AI.redAllyIndex ? dims.goalLineX : -dims.goalLineX;
    const pushZ = clamp((aimZ - target.z) / Math.min(AI.pushDistanceMax, Math.max(AI.pushDistanceMin, Math.abs(goalX - target.x))), -AI.pushZLimit, AI.pushZLimit);
    const pushLength = Math.hypot(pushX, pushZ);
    const directionX = pushX / pushLength;
    const directionZ = pushZ / pushLength;
    const offset = index === AI.opponentIndex || index === AI.redAllyIndex ? 0 : (index - AI.roleOffsetStartIndex) * AI.roleOffsetSpacing - AI.roleOffsetCenter;
    const sameTeamCars = index === AI.redAllyIndex ? redTeam : blueTeam;
    const positionPool = index === AI.redAllyIndex ? scratch.redPositions : scratch.bluePositions;
    fillTeamPositions(sameTeamCars, positionPool, scratch.attackerPositions);
    const attackerIndex = selectAttacker(scratch.attackerPositions, scratch.predictedBall, goalX);
    const isAttacker = sameTeamCars[attackerIndex]?.carIndex === index;
    isActiveAttacker[index] = isAttacker;
    const defendX = index === AI.redAllyIndex ? -dims.goalLineX + AI.defenseDepth : dims.goalLineX - AI.defenseDepth;
    const ballThreatX = (predictedX - defendX) * (index === AI.redAllyIndex ? -1 : 1);
    const defenseDynamic = ballThreatX > 0 ? clamp(ballThreatX / (dims.goalLineX * 2), 0, AI.defenseDynamicFactor) : 0;
    const defendTargetX = defendX + (predictedX - defendX) * defenseDynamic;
    const approachX = clamp(isAttacker ? predictedX - directionX * AI.attackRange - directionZ * offset : defendTargetX, -dims.goalLineX + AI.goalClampMargin, dims.goalLineX - AI.goalClampMargin);
    const approachZ = clamp(isAttacker ? predictedZ - directionZ * AI.attackRange + directionX * offset : predictedZ * AI.defenderPositionFollowFactor + offset, -dims.sideWallZ + AI.wallClearance, dims.sideWallZ - AI.wallClearance);
    const approachDistance = Math.hypot(approachX - position.x, approachZ - position.z);
    const ballDistance = Math.hypot(predictedX - position.x, predictedZ - position.z);
    if (isAttacker && approachDistance < AI.attackerApproachDistance) opponentState.attacking = true;
    if (!isAttacker) opponentState.attacking = false;
    const sidewaysError = Math.abs((position.x - target.x) * directionZ - (position.z - target.z) * directionX);
    if (ballDistance > AI.attackingMaxBallDistance || (position.x - target.x) * directionX + (position.z - target.z) * directionZ > AI.attackingBehindPlane || (ballDistance < AI.attackingMinBallDistance && sidewaysError > AI.attackingSidewaysError)) opponentState.attacking = false;
    const dx = (opponentState.attacking ? target.x - directionX * AI.behindBallDistance : approachX) - position.x;
    const dz = (opponentState.attacking ? target.z - directionZ * AI.behindBallDistance : approachZ) - position.z;
    const desired = Math.atan2(-dx, -dz);
    const difference = wrapAngle(desired - aiHeadings[index]);
    const velocity = opponent.linvel();
    const tryingToMove = Math.abs(difference) < AI.blockedHeadingTolerance;
    opponentState.blockedTime = tryingToMove && Math.hypot(velocity.x, velocity.z) < AI.blockedSpeed ? opponentState.blockedTime + dt : 0;
    if (opponentState.blockedTime > AI.blockedSeconds && opponentState.recoveryTime <= 0) {
      opponentState.recoveryTime = AI.recoverySeconds;
      opponentState.blockedTime = 0;
      opponentState.attacking = false;
      opponentState.recoverySteer = rng() > 0.5 ? 1 : -1;
    }
    const recovering = opponentState.recoveryTime > 0;
    opponentState.recoveryTime = Math.max(0, opponentState.recoveryTime - dt);
    const steeringFactor = clamp(1 - Math.abs(difference) / Math.PI, AI.minSteeringFactor, 1);
    const throttle = recovering
      ? -0.55 * steeringFactor
      : (isAttacker ? AI.difficultyAggression[difficulty] : AI.defenderSpeedFactor) * steeringFactor;
    // steer positivo = direita = heading diminui (`headingDelta`); a IA precisa do sinal invertido.
    const steer = recovering
      ? opponentState.recoverySteer
      : -clamp(difference / Math.max(1e-4, CAR.steeringRate * dt), -1, 1);
    commands[index] = { throttle: clamp(throttle, -1, 1), steer, boost: false, kick: false };
  }
  isActiveAttacker[AI.playerIndex] = true;
}
