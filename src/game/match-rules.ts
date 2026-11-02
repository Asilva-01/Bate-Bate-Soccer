export type Difficulty = 'easy' | 'medium' | 'hard';

const difficultySpeed: Record<Difficulty, number> = { easy: 0.8, medium: 0.95, hard: 1.1 };

export function opponentSpeed(difficulty: Difficulty, round: number) {
  return Math.min(1.5, difficultySpeed[difficulty] + Math.max(0, round - 1) * 0.1);
}

export function opponentCars(round: number) {
  return Math.min(4, 1 + Math.floor(round / 2));
}
