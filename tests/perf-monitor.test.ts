import { expect, test } from 'vitest';
import { createPerfMonitor } from '../src/game/perf-monitor.ts';

test('média de FPS e p95 sobre a janela móvel', () => {
  const monitor = createPerfMonitor(60);
  for (let i = 0; i < 59; i++) monitor.push(16);
  monitor.push(100);
  expect(monitor.averageMs()).toBeCloseTo((59 * 16 + 100) / 60, 6);
  expect(monitor.averageFps()).toBeCloseTo(1000 / ((59 * 16 + 100) / 60), 6);
  expect(monitor.p95Ms()).toBe(16);
  for (let i = 0; i < 4; i++) monitor.push(100);
  expect(monitor.p95Ms()).toBe(100);
});

test('janela descarta as amostras antigas e ignora valores inválidos', () => {
  const monitor = createPerfMonitor(3);
  [50, 50, 50].forEach((value) => monitor.push(value));
  [10, 10, 10].forEach((value) => monitor.push(value));
  monitor.push(Number.NaN);
  expect(monitor.averageMs()).toBe(10);
  monitor.reset();
  expect([monitor.averageMs(), monitor.averageFps(), monitor.p95Ms()]).toEqual([0, 0, 0]);
});
