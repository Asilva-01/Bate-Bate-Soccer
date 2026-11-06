import { TURBO } from './config';

export type TurboState = { meter: number; idleTime: number };

export function createTurboState(params = TURBO): TurboState {
  return { meter: params.start, idleTime: params.regenDelaySeconds };
}

export function stepTurbo(
  state: TurboState,
  wants: boolean,
  dt: number,
  params = TURBO,
): { state: TurboState; active: boolean } {
  let { meter, idleTime } = state;
  const continuing = wants && meter > 0 && idleTime === 0;
  const starting = wants && meter >= params.minToStart;
  let active = starting || continuing;
  if (active) {
    meter = Math.max(0, meter - params.drainPerSecond * dt);
    idleTime = 0;
    active = meter > 0;
  } else {
    idleTime += dt;
    if (!wants && idleTime >= params.regenDelaySeconds) {
      meter = Math.min(params.max, meter + params.regenPerSecond * dt);
    }
  }
  return { state: { meter, idleTime }, active };
}
