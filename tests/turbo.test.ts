import { expect, test } from 'vitest';
import { TURBO } from '../src/game/config.ts';
import { createTurboState, stepTurbo } from '../src/game/turbo.ts';

const STEP = 1 / 60;

function run(seconds: number, wants: boolean, start = createTurboState()) {
  let state = start;
  let active = false;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    const step = stepTurbo(state, wants, STEP);
    state = step.state;
    active = step.active;
  }
  return { state, active };
}

test('33 → 0 em 1,0 s de uso', () => {
  const { state, active } = run(1, true, { meter: 33, idleTime: TURBO.regenDelaySeconds });
  expect(state.meter).toBeCloseTo(0, 5);
  expect(active).toBe(false);
});

test('recarga só depois de 0,6 s', () => {
  const afterUse = run(0.2, true, { meter: 50, idleTime: TURBO.regenDelaySeconds }).state;
  const beforeDelay = run(TURBO.regenDelaySeconds - STEP, false, afterUse);
  expect(beforeDelay.state.meter).toBeCloseTo(afterUse.meter, 5);
  const afterDelay = run(0.5, false, beforeDelay.state);
  expect(afterDelay.state.meter).toBeGreaterThan(afterUse.meter + 1);
});

test('0 → 100 em 10 s', () => {
  const { state } = run(10, false, { meter: 0, idleTime: TURBO.regenDelaySeconds });
  expect(state.meter).toBeCloseTo(100, 5);
});

test('não liga abaixo de 5', () => {
  const { active, state } = run(STEP, true, { meter: 4, idleTime: TURBO.regenDelaySeconds });
  expect(active).toBe(false);
  expect(state.meter).toBeCloseTo(4, 5);
});
