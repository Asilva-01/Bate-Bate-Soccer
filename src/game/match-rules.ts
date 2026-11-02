export type Difficulty = 'easy' | 'medium' | 'hard';

const difficultySpeed: Record<Difficulty, number> = { easy: 0.55, medium: 0.72, hard: 0.9 };

export function opponentSpeed(difficulty: Difficulty, round: number) {
  return Math.min(1.3, difficultySpeed[difficulty] + Math.max(0, round - 1) * 0.1);
}

export function opponentCars(round: number) {
  return round >= 2 ? 2 : 1;
}
