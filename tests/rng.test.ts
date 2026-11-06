import { expect, test } from 'vitest';
import { mulberry32 } from '../src/game/rng.ts';

test('mulberry32 é determinístico para a mesma semente', () => {
  const a = mulberry32(20261106);
  const b = mulberry32(20261106);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  expect(mulberry32(1)()).not.toBe(mulberry32(2)());
});
