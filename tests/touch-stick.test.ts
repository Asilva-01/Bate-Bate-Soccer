import { expect, test } from 'vitest';
import { clampStickBase, followBase, normalizeStick, stickToDrive } from '../src/game/touch-stick.ts';

const drive = (x: number, y: number) => stickToDrive({ x, y });
const DEG = Math.PI / 180;
const stickAt = (degrees: number, length = 1) => ({ x: Math.sin(degrees * DEG) * length, y: Math.cos(degrees * DEG) * length });

test('stickToDrive segue a tabela da seção 3.2', () => {
  expect(drive(0, 0)).toEqual({ throttle: 0, steer: 0 });
  expect(drive(0, 0.1)).toEqual({ throttle: 0, steer: 0 });
  expect(drive(0, 1)).toEqual({ throttle: 1, steer: 0 });
  expect(drive(1, 0)).toEqual({ throttle: 1, steer: 1 });
  expect(drive(0, -1)).toEqual({ throttle: -1, steer: 0 });
  const reverse = drive(0.7, -0.7);
  expect(reverse.throttle).toBe(-1);
  expect(reverse.steer).toBeCloseTo(0.64, 2);
  expect(drive(-0.7, -0.7).steer).toBeCloseTo(-0.64, 2);
});

test('intensidade do stick vira acelerador de forma analógica', () => {
  expect(drive(0, 0.12).throttle).toBe(0);
  expect(drive(0, 0.485).throttle).toBeCloseTo(0.5, 2);
  expect(drive(0, 0.85).throttle).toBe(1);
});

test('steer varia no máximo 0,02 por grau fora das fronteiras de zona', () => {
  let previous = stickToDrive(stickAt(-179.5));
  for (let angle = -178.5; angle <= 180; angle += 1) {
    if (Math.abs(Math.abs(angle) - 110) < 1) {
      previous = stickToDrive(stickAt(angle));
      continue;
    }
    const current = stickToDrive(stickAt(angle));
    expect(Math.abs(current.steer - previous.steer)).toBeLessThanOrEqual(0.02);
    previous = current;
  }
});

test('normalizeStick usa y de tela (para baixo) e limita o módulo a 1', () => {
  expect(normalizeStick(32, -32, 64)).toEqual({ x: 0.5, y: 0.5 });
  const clamped = normalizeStick(300, 400, 64);
  expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(1, 6);
  expect(clamped.y).toBeLessThan(0);
});

test('followBase deixa a base a exatamente 1,3 × raio do dedo quando ele passa do limite', () => {
  const base = { x: 100, y: 200 };
  const pointer = { x: 100 + 2 * 64 * 0.6, y: 200 + 2 * 64 * 0.8 };
  const next = followBase(base, pointer, 64, 1.3);
  expect(Math.hypot(pointer.x - next.x, pointer.y - next.y)).toBeCloseTo(1.3 * 64, 6);
  expect((pointer.x - next.x) / Math.hypot(pointer.x - next.x, pointer.y - next.y)).toBeCloseTo(0.6, 6);
  expect(followBase(base, { x: 120, y: 210 }, 64, 1.3)).toEqual(base);
});

test('clampStickBase mantém a base a um raio das bordas da área segura', () => {
  const bounds = { left: 40, top: 56, right: 400, bottom: 380 };
  expect(clampStickBase({ x: 0, y: 0 }, bounds, 64)).toEqual({ x: 104, y: 120 });
  expect(clampStickBase({ x: 999, y: 999 }, bounds, 64)).toEqual({ x: 336, y: 316 });
  expect(clampStickBase({ x: 200, y: 200 }, bounds, 64)).toEqual({ x: 200, y: 200 });
});
