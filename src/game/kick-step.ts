import type RAPIER from '@dimforge/rapier3d-compat';
import { AI, KICK } from './config';
import type { ArenaDimensions } from './arena-dimensions';
import type { Vec3 } from './math';
import {
  computeKickTarget,
  impulseForKickTarget,
  isInKickZone,
  isShotOnGoal,
  kickDirection,
  resolveSimultaneousKicks,
  shouldAiKick,
  stepKickTimer,
  type KickTimer,
  type KickVelocityTarget,
} from './kick';

export type KickEvent = { position: Vec3; power: number; team: 'red' | 'blue'; isPlayer: boolean };

export type KickStepState = {
  kickTimers: KickTimer[];
  zoneTime: Float32Array;
  aiKickLatched: boolean[];
  lastKickPresses: number;
};

export function resetKickState(state: KickStepState) {
  state.kickTimers.forEach((timer) => {
    timer.cooldown = 0;
    timer.buffer = 0;
  });
  state.zoneTime.fill(0);
  state.aiKickLatched.fill(false);
}

export function applyKicks(
  carBodies: RAPIER.RigidBody[],
  ballBody: RAPIER.RigidBody,
  headings: readonly number[],
  enabled: (index: number) => boolean,
  isActiveAttacker: readonly boolean[],
  state: KickStepState,
  kickPresses: number,
  dims: ArenaDimensions,
  kickAimDot: number,
  kickReaction: number,
  aiPowerFactor: number,
  dt: number,
  stats: { playerShotsOnGoal: number },
  onKick?: (event: KickEvent) => void,
) {
  const ballPos = ballBody.translation();
  const ballVel = ballBody.linvel();
  const playerPressed = kickPresses > state.lastKickPresses;
  if (playerPressed) state.lastKickPresses = kickPresses;
  const kickTargets: KickVelocityTarget[] = [];
  const kickEvents: KickEvent[] = [];
  for (let index = 0; index < carBodies.length; index++) {
    if (!enabled(index)) continue;
    const body = carBodies[index];
    const position = body.translation();
    const velocity = body.linvel();
    const angle = headings[index];
    const inZone = isInKickZone(position.x, position.z, angle, ballPos.x, ballPos.y, ballPos.z);
    if (inZone) state.zoneTime[index] += dt;
    else {
      state.zoneTime[index] = 0;
      state.aiKickLatched[index] = false;
    }
    let pressed = false;
    if (index === AI.playerIndex) {
      pressed = playerPressed;
    } else if (isActiveAttacker[index]) {
      const dir = kickDirection(angle, position.x, position.z, ballPos.x, ballPos.z);
      const attackDirX = index === AI.redAllyIndex ? 1 : -1;
      const ownGoalX = attackDirX > 0 ? -dims.goalLineX : dims.goalLineX;
      const wantsKick = state.zoneTime[index] >= kickReaction && shouldAiKick(
        dir.x,
        dir.z,
        attackDirX,
        ballPos.x,
        ballPos.z,
        ownGoalX,
        kickAimDot,
      );
      pressed = wantsKick && !state.aiKickLatched[index];
      if (wantsKick) state.aiKickLatched[index] = true;
    }
    const kickStep = stepKickTimer(state.kickTimers[index], dt, pressed, inZone);
    state.kickTimers[index] = kickStep.timer;
    if (!kickStep.fire) continue;
    const powerFactor = index === AI.playerIndex ? 1 : aiPowerFactor;
    const target = computeKickTarget(
      angle,
      position.x,
      position.z,
      velocity.x,
      velocity.z,
      ballPos.x,
      ballPos.y,
      ballPos.z,
      ballVel.x,
      ballVel.y,
      ballVel.z,
      powerFactor,
    );
    if (!target) continue;
    kickTargets.push(target);
    kickEvents.push({
      position: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
      power: target.power,
      team: index === AI.playerIndex || index === AI.redAllyIndex ? 'red' : 'blue',
      isPlayer: index === AI.playerIndex,
    });
  }
  const resolved = resolveSimultaneousKicks(kickTargets);
  if (resolved) {
    const impulse = impulseForKickTarget(resolved, ballVel.x, ballVel.y, ballVel.z);
    ballBody.applyImpulse(impulse, true);
    if (KICK.recoil > 0) {
      // reservado para recuo futuro
    }
    const event = kickEvents.find((entry) => entry.isPlayer) ?? kickEvents[0];
    if (event?.isPlayer && isShotOnGoal(ballPos.x, ballPos.z, resolved.x, resolved.z, dims.goalLineX, dims.goalHalfWidth)) stats.playerShotsOnGoal += 1;
    if (event && onKick) onKick({ ...event, power: resolved.power });
  }
}
