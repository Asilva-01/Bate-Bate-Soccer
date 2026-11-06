import type RAPIER from '@dimforge/rapier3d-compat';
import { AI } from './config';
import { clamp, yawQuaternion } from './math';
import { opponentSpeed, selectAttacker, type Difficulty } from './match-rules';
import type { ArenaDimensions } from './arena-dimensions';

export type AiOpponentState = { blockedTime: number; recoveryTime: number; attacking: boolean };

export function createAiOpponents(count: number): AiOpponentState[] {
  return Array.from({ length: count }, () => ({ blockedTime: 0, recoveryTime: 0, attacking: false }));
}

export function resetAiOpponents(opponents: AiOpponentState[]) {
  opponents.forEach((opponent) => {
    opponent.blockedTime = 0;
    opponent.recoveryTime = 0;
    opponent.attacking = false;
  });
}

/** IA atual: persegue o alvo que já calcula e aplica `setLinvel`. Sem alteração de comportamento. */
export function applyAiControl(
  carBodies: RAPIER.RigidBody[],
  ballBody: RAPIER.RigidBody,
  dims: ArenaDimensions,
  enabled: (index: number) => boolean,
  aiHeadings: number[],
  opponents: AiOpponentState[],
  isActiveAttacker: boolean[],
  difficulty: Difficulty,
  round: number,
  dt: number,
) {
  const target = ballBody.translation();
  const ballVelocity = ballBody.linvel();
  const predictedX = clamp(target.x + ballVelocity.x * AI.predictionSeconds, -dims.goalLineX, dims.goalLineX);
  const predictedZ = clamp(target.z + ballVelocity.z * AI.predictionSeconds, -dims.sideWallZ + AI.wallClearance, dims.sideWallZ - AI.wallClearance);
  for (let index = 1; index < carBodies.length; index++) {
    isActiveAttacker[index] = false;
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
    const activeTeamCars = carBodies.map((body, carIndex) => ({ body, carIndex })).filter(({ carIndex }) => carIndex > AI.playerIndex && enabled(carIndex));
    const sameTeamCars = activeTeamCars.filter(({ carIndex }) => index === AI.redAllyIndex ? carIndex === AI.redAllyIndex : carIndex !== AI.redAllyIndex);
    const attackerIndex = selectAttacker(sameTeamCars.map(({ body }) => {
      const carPosition = body.translation(); return { x: carPosition.x, y: carPosition.y, z: carPosition.z };
    }), { x: predictedX, y: target.y, z: predictedZ }, goalX);
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
    const difference = Math.atan2(Math.sin(desired - aiHeadings[index]), Math.cos(desired - aiHeadings[index]));
    const velocity = opponent.linvel();
    const tryingToMove = Math.abs(difference) < AI.blockedHeadingTolerance;
    opponentState.blockedTime = tryingToMove && Math.hypot(velocity.x, velocity.z) < AI.blockedSpeed ? opponentState.blockedTime + dt : 0;
    if (opponentState.blockedTime > AI.blockedSeconds && opponentState.recoveryTime <= 0) {
      opponentState.recoveryTime = AI.recoverySeconds;
      opponentState.blockedTime = 0;
      opponentState.attacking = false;
      const recoveryAngle = aiHeadings[index] + (Math.random() > 0.5 ? 1 : -1) * (AI.recoveryAngleRange / 2 + Math.random() * AI.recoveryAngleRange / 2);
      aiHeadings[index] = recoveryAngle;
    }
    const recovering = opponentState.recoveryTime > 0;
    opponentState.recoveryTime = Math.max(0, opponentState.recoveryTime - dt);
    if (!recovering) aiHeadings[index] += clamp(difference, -AI.headingTurnRate * dt, AI.headingTurnRate * dt);
    opponent.setRotation(yawQuaternion(aiHeadings[index]), true);
    const aiCap = opponentSpeed(difficulty, round) * AI.speedMultiplier;
    const aggressionFactor = isAttacker ? AI.difficultyAggression[difficulty] : 1;
    const aiForward = isAttacker ? aiCap * aggressionFactor : aiCap * AI.defenderSpeedFactor;
    const steeringFactor = clamp(1 - Math.abs(difference) / Math.PI, AI.minSteeringFactor, 1);
    const recoveryDirection = recovering ? -1 : 1;
    const recoverySpeed = recovering ? aiCap * 0.55 : aiForward;
    const commandedSpeed = recoverySpeed * steeringFactor * recoveryDirection;
    opponent.setLinvel({
      x: -Math.sin(aiHeadings[index]) * commandedSpeed,
      y: velocity.y,
      z: -Math.cos(aiHeadings[index]) * commandedSpeed,
    }, true);
  }
  isActiveAttacker[AI.playerIndex] = true;
}
