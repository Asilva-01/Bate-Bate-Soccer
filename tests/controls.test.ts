import { expect, test } from 'vitest';
import { driveCommandFromFrame } from '../src/game/controls.ts';
import { createControlFrame } from '../src/game/input.ts';

test('ControlFrame vira DriveCommand e consome o aperto do toque', () => {
  const frame = createControlFrame();
  frame.throttle = 0.8;
  frame.steer = -0.4;
  frame.boost = true;
  frame.kickPresses = 3;
  const first = driveCommandFromFrame(frame, 2);
  expect(first.command).toEqual({ throttle: 0.8, steer: -0.4, boost: true, kick: true });
  const second = driveCommandFromFrame(frame, first.kickPresses);
  expect(second.command.kick).toBe(false);
});
