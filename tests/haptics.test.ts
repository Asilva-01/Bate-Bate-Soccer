import { expect, test, vi } from 'vitest';
import { TOUCH } from '../src/game/config.ts';
import { canVibrate, hapticPattern, tryVibrate } from '../src/game/haptics.ts';

test('iOS sem vibrate falha em silêncio', () => {
  expect(canVibrate({})).toBe(false);
  expect(tryVibrate('dash', true, {})).toBe(false);
  expect(tryVibrate('kickHit', true, { vibrate: () => { throw new Error('unsupported'); } })).toBe(false);
});

test('interruptor desligado não vibra; ligado usa os knobs', () => {
  const vibrate = vi.fn(() => true);
  expect(tryVibrate('dash', false, { vibrate })).toBe(false);
  expect(vibrate).not.toHaveBeenCalled();
  expect(tryVibrate('dash', true, { vibrate })).toBe(true);
  expect(vibrate).toHaveBeenCalledWith(TOUCH.haptics.kickDash);
  expect(tryVibrate('kickHit', true, { vibrate })).toBe(true);
  expect(vibrate).toHaveBeenCalledWith(TOUCH.haptics.kickHit);
  expect(hapticPattern('goalFor')).toEqual(TOUCH.haptics.goalFor);
  expect(hapticPattern('kickHit')).toBeLessThan(Number(hapticPattern('goalAgainst')));
});
