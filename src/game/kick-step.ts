import type RAPIER from '@dimforge/rapier3d-compat';
import { AI, CAR, KICK } from './config';
import type { ArenaDimensions } from './arena-dimensions';
import type { Vec3 } from './math';
import {
  computeKickTarget,
  dashHopSpeed,
  dashImpulse,
  impulseForKickTarget,
  isInKickZone,
  isInPlanarKickZone,
  isShotOnGoal,
  kickDirection,
  recoilImpulse,
  resolveSimultaneousKicks,
  shouldAiKick,
  stepKickTimer,
  type KickTimer,
  type KickVelocityTarget,
} from './kick';

export type KickEvent = {
  position: Vec3;
  power: number;
  team: 'red' | 'blue';
  isPlayer: boolean;
  hit: boolean;
};

export type KickStepState = {
  kickTimers: KickTimer[];
  zoneTime: Float32Array;
  dashRemaining: Float32Array;
  aiKickLatched: boolean[];
  lastKickPresses: number;
};

type PendingKick = {
  index: number;
  target: KickVelocityTarget;
  isPlayer: boolean;
  team: KickEvent['team'];
};

export function resetKickState(state: KickStepState) {
  state.kickTimers.forEach((timer) => {
    timer.cooldown = 0;
    timer.buffer = 0;
  });
  state.zoneTime.fill(0);
  state.dashRemaining.fill(0);
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
  const pending: PendingKick[] = [];
  const dashMisses: KickEvent[] = [];
  for (let index = 0; index < carBodies.length; index++) {
    if (!enabled(index)) {
      state.dashRemaining[index] = 0;
      continue;
    }
    state.dashRemaining[index] = Math.max(0, state.dashRemaining[index] - dt);
    const body = carBodies[index];
    const position = body.translation();
    const velocity = body.linvel();
    const angle = headings[index];
    const inZone = isInKickZone(position.x, position.z, angle, ballPos.x, ballPos.y, ballPos.z);
    const planar = isInPlanarKickZone(position.x, position.z, angle, ballPos.x, ballPos.z);
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
    const team: KickEvent['team'] = index === AI.playerIndex || index === AI.redAllyIndex ? 'red' : 'blue';
    const isPlayer = index === AI.playerIndex;
    if (kickStep.dashStarted) {
      const hop = dashHopSpeed(ballPos.y, planar);
      const impulse = dashImpulse(angle, velocity.x, velocity.y, velocity.z, hop);
      body.applyImpulse(impulse, true);
      state.dashRemaining[index] = KICK.dashSeconds;
      if (!kickStep.fire) {
        dashMisses.push({
          position: { x: position.x, y: position.y, z: position.z },
          power: 0,
          team,
          isPlayer,
          hit: false,
        });
      }
    }
    if (!kickStep.fire) continue;
    const powerFactor = isPlayer ? 1 : aiPowerFactor;
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
    pending.push({ index, target, isPlayer, team });
  }
  for (const miss of dashMisses) onKick?.(miss);
  const resolved = resolveSimultaneousKicks(pending.map((entry) => entry.target));
  if (!resolved) return;
  const impulse = impulseForKickTarget(resolved, ballVel.x, ballVel.y, ballVel.z);
  ballBody.applyImpulse(impulse, true);
  if (KICK.recoil > 0) {
    for (const entry of pending) {
      carBodies[entry.index].applyImpulse(recoilImpulse(entry.target.x, entry.target.z, entry.target.power, CAR.mass, KICK.recoil), true);
    }
  }
  const event = pending.find((entry) => entry.isPlayer) ?? pending[0];
  if (event?.isPlayer && isShotOnGoal(ballPos.x, ballPos.z, resolved.x, resolved.z, dims.goalLineX, dims.goalHalfWidth)) stats.playerShotsOnGoal += 1;
  onKick?.({
    position: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
    power: resolved.power,
    team: event.team,
    isPlayer: event.isPlayer,
    hit: true,
  });
}
