import type RAPIER from '@dimforge/rapier3d-compat';
import { AI, STUCK } from './config';
import { awardGoal, getScoringSide, type ScoreState, type ScoringSide } from './match-rules';
import type { ArenaDimensions } from './arena-dimensions';
import type { createStuckMonitor } from './stuck-monitor';

export type MatchEvent = { kind: 'goal'; scoringSide: ScoringSide } | { kind: 'stuck' } | null;

export function applyMatchEvents(
  carBodies: RAPIER.RigidBody[],
  ballBody: RAPIER.RigidBody,
  dims: ArenaDimensions,
  enabled: (index: number) => boolean,
  stuck: ReturnType<typeof createStuckMonitor>,
  dt: number,
  stats: { stuckResets: number },
): MatchEvent {
  const ballPosition = ballBody.translation();
  const scoringSide = getScoringSide(ballPosition, dims);
  if (scoringSide) return { kind: 'goal', scoringSide };
  if (stuck.update(ballPosition.x, ballPosition.z, dt)) {
    stats.stuckResets += 1;
    return { kind: 'stuck' };
  }
  const ballSpeed = Math.hypot(ballBody.linvel().x, ballBody.linvel().y, ballBody.linvel().z);
  const pinchCars = carBodies.flatMap((body, index) => {
    if (!enabled(index)) return [];
    const pos = body.translation();
    return [{ x: pos.x, z: pos.z, team: index === AI.playerIndex || index === AI.redAllyIndex ? 'red' as const : 'blue' as const }];
  });
  if (stuck.updatePinch({ x: ballPosition.x, z: ballPosition.z, speed: ballSpeed }, pinchCars, dt)) {
    ballBody.applyImpulse({ x: 0, y: STUCK.liftImpulse, z: 0 }, true);
  }
  return null;
}

export function applyGoalToState(state: ScoreState, scoringSide: ScoringSide, round: number): ScoreState {
  const redGoal = scoringSide === 'blue';
  return awardGoal(state, redGoal ? 'red' : 'blue', round);
}
