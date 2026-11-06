import { expect, test } from 'vitest';
import { hitActionCluster } from '../src/game/action-cluster.ts';

const boost = { x: 40, y: 40, r: 38 };
const kick = { x: 90, y: 90, r: 44 };
const slack = 18;

test('acerto no centro de cada botão', () => {
  expect(hitActionCluster(40, 40, boost, kick, slack)).toBe('boost');
  expect(hitActionCluster(90, 90, boost, kick, slack)).toBe('kick');
});

test('a faixa de costura aperta os dois', () => {
  expect(hitActionCluster(65, 65, boost, kick, slack)).toBe('both');
});

test('fora do cluster não acerta', () => {
  expect(hitActionCluster(0, 0, boost, kick, slack)).toBeNull();
});
