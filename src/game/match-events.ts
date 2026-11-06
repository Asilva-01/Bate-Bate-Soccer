import type RAPIER from '@dimforge/rapier3d-compat';
import { AI, STUCK } from './config';
import { awardGoal, getScoringSide, type ScoreState, type ScoringSide } from './match-rules';
import type { ArenaDimensions } from './arena-dimensions';
import type { PinchCar } from './stuck-monitor';
import type { createStuckMonitor } from './stuck-monitor';

export type MatchEvent = { kind: 'goal'; scoringSide: ScoringSide } | { kind: 'stuck' } | null;

export type MatchScratch = {
  pinchCars: PinchCar[];
  pinchUsed: PinchCar[];
  pinchBall: { x: number; z: number; speed: number };
  liftImpulse: { x: number; y: number; z: number };
};

export function createMatchScratch(carCount: number): MatchScratch {
  return {
    pinchCars: Array.from({ length: carCount }, () => ({ x: 0, z: 0, team: 'red' as const })),
    pinchUsed: [],
    pinchBall: { x: 0, z: 0, speed: 0 },
    liftImpulse: { x: 0, y: STUCK.liftImpulse, z: 0 },
  };
}

export function applyMatchEvents(
  carBodies: RAPIER.RigidBody[],
  ballBody: RAPIER.RigidBody,
  dims: ArenaDimensions,
  enabled: (index: number) => boolean,
  stuck: ReturnType<typeof createStuckMonitor>,
  dt: number,
  stats: { stuckResets: number },
  scratch: MatchScratch,
): MatchEvent {
  const ballPosition = ballBody.translation();
  const scoringSide = getScoringSide(ballPosition, dims);
  if (scoringSide) return { kind: 'goal', scoringSide };
  if (stuck.update(ballPosition.x, ballPosition.z, dt)) {
    stats.stuckResets += 1;
    return { kind: 'stuck' };
  }
  const velocity = ballBody.linvel();
  const ballSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const used = scratch.pinchUsed;
  used.length = 0;
  for (let index = 0; index < carBodies.length; index++) {
    if (!enabled(index)) continue;
    const pos = carBodies[index].translation();
    const slot = scratch.pinchCars[index];
    slot.x = pos.x;
    slot.z = pos.z;
    slot.team = index === AI.playerIndex || index === AI.redAllyIndex ? 'red' : 'blue';
    used.push(slot);
  }
  scratch.pinchBall.x = ballPosition.x;
  scratch.pinchBall.z = ballPosition.z;
  scratch.pinchBall.speed = ballSpeed;
  if (stuck.updatePinch(scratch.pinchBall, used, dt)) {
    ballBody.applyImpulse(scratch.liftImpulse, true);
  }
  return null;
}

export function applyGoalToState(state: ScoreState, scoringSide: ScoringSide, round: number): ScoreState {
  const redGoal = scoringSide === 'blue';
  return awardGoal(state, redGoal ? 'red' : 'blue', round);
}
