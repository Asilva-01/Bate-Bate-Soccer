import { expect, test } from 'vitest';
import { CAR } from '../src/game/config.ts';
import { isGrounded, stepVehicle, type VehicleState } from '../src/game/vehicle-controller.ts';
import type { DriveCommand } from '../src/game/controls.ts';

const rest = (): VehicleState => ({
  vx: 0, vy: 0, vz: 0, y: CAR.hitbox.halfHeight, heading: 0, grounded: true, boost: 100, dashTime: 0, kickCooldown: 0,
});

function simulate(seconds: number, command: DriveCommand, start = rest(), dt = 1 / 60) {
  let state = { ...start };
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const step = stepVehicle(state, command, dt);
    state = {
      ...state,
      heading: step.heading,
      vx: state.vx + step.impulse.x / CAR.mass,
      vy: state.vy + step.impulse.y / CAR.mass,
      vz: state.vz + step.impulse.z / CAR.mass,
      boost: step.boost,
      grounded: isGrounded(state.y, state.vy),
    };
  }
  return state;
}

const drive = (overrides: Partial<DriveCommand> = {}): DriveCommand => ({
  throttle: 0, steer: 0, boost: false, kick: false, ...overrides,
});

test('de 0, acelerador 1 → ≥ 90% de 20 u/s em ≤ 0,7 s', () => {
  const state = simulate(0.7, drive({ throttle: 1 }));
  expect(Math.hypot(state.vx, state.vz)).toBeGreaterThanOrEqual(0.9 * CAR.maxSpeed);
});

test('turbo com medidor cheio → ≥ 28 u/s em ≤ 1,5 s', () => {
  const state = simulate(1.5, drive({ throttle: 1, boost: true }));
  expect(Math.hypot(state.vx, state.vz)).toBeGreaterThanOrEqual(28);
  expect(Math.hypot(state.vx, state.vz)).toBeLessThanOrEqual(CAR.boostMaxSpeed + 1e-6);
});

test('derrapagem lateral cai a < 10% em 0,25 s', () => {
  const start = { ...rest(), vx: 10 };
  const state = simulate(0.25, drive(), start);
  expect(Math.abs(state.vx)).toBeLessThan(1);
});

test('o resultado é igual com dt 1/60 e 2 × 1/120 (±2%)', () => {
  const coarse = simulate(0.5, drive({ throttle: 1 }), rest(), 1 / 60);
  const fine = simulate(0.5, drive({ throttle: 1 }), rest(), 1 / 120);
  const speedCoarse = Math.hypot(coarse.vx, coarse.vz);
  const speedFine = Math.hypot(fine.vx, fine.vz);
  expect(Math.abs(speedFine - speedCoarse) / speedCoarse).toBeLessThanOrEqual(0.02);
});

test('isGrounded: no chão → verdadeiro; com vy > 0,5 → falso', () => {
  expect(isGrounded(CAR.hitbox.halfHeight, 0)).toBe(true);
  expect(isGrounded(CAR.hitbox.halfHeight, 0.51)).toBe(false);
});

test('teto de maxSpeed da IA é respeitado só via DriveCommand', () => {
  const cap = 0.75 * CAR.maxSpeed;
  const params = { ...CAR, maxSpeed: cap, boostMaxSpeed: cap };
  const uncapped = simulate(2, drive({ throttle: 1 }), rest(), 1 / 60);
  const capped = (() => {
    let current = rest();
    for (let i = 0; i < 120; i++) {
      const step = stepVehicle(current, drive({ throttle: 1 }), 1 / 60, params);
      current = {
        ...current,
        heading: step.heading,
        vx: current.vx + step.impulse.x / CAR.mass,
        vy: current.vy + step.impulse.y / CAR.mass,
        vz: current.vz + step.impulse.z / CAR.mass,
        grounded: isGrounded(current.y, current.vy),
      };
    }
    return current;
  })();
  expect(Math.hypot(uncapped.vx, uncapped.vz)).toBeGreaterThan(cap);
  expect(Math.hypot(capped.vx, capped.vz)).toBeLessThanOrEqual(cap + 1e-6);
});
