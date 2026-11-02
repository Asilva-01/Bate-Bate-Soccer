import { GAME_CONFIG } from './game-config';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type ScoringSide = 'red' | 'blue';
export type GoalBallPosition = { x: number; y: number; z: number };
export type ScoreState = { red: number; blue: number; redCars: number; blueCars: number; finished: boolean; message: string };

const difficultySpeed: Record<Difficulty, number> = { easy: 0.8, medium: 0.95, hard: 1.1 };

export function opponentSpeed(difficulty: Difficulty, round: number) {
  return Math.min(1.5, difficultySpeed[difficulty] + Math.max(0, round - 1) * 0.1);
}

export function opponentCars(round: number) {
  return Math.min(4, 1 + Math.floor(round / 2));
}

export function getScoringSide(ball: GoalBallPosition): ScoringSide | null {
  const { arena, ball: ballConfig, goals } = GAME_CONFIG;
  const insideDepth = Math.abs(ball.x) >= arena.goalLineX + ballConfig.radius + goals.scoreMargin
    && Math.abs(ball.x) <= arena.goalBackX - ballConfig.radius;
  const insideMouth = Math.abs(ball.z) <= arena.goalHalfWidth - ballConfig.radius
    && ball.y + ballConfig.radius <= arena.goalHeight;
  if (!insideDepth || !insideMouth) return null;
  return ball.x > 0 ? 'blue' : 'red';
}

export function awardGoal(state: ScoreState, team: ScoringSide, round: number): ScoreState {
  const red = state.red + Number(team === 'red');
  const blue = state.blue + Number(team === 'blue');
  const redCars = team === 'red' && round >= 2 ? 2 : team === 'blue' ? 1 : state.redCars;
  const blueCars = opponentCars(round);
  const finished = red >= 3 || blue >= 3;
  const message = finished
    ? team === 'red' ? 'Vitória! Você venceu a partida.' : 'Fim de jogo. O azul venceu.'
    : team === 'red' ? round >= 2 ? 'GOL VERMELHO! Reforço liberado.' : 'GOL VERMELHO! Reforço disponível a partir da rodada 2.'
      : 'GOL AZUL! Você perdeu o reforço.';
  return { ...state, red, blue, redCars, blueCars, finished, message };
}

export function selectAttacker(cars: readonly GoalBallPosition[], predictedBall: GoalBallPosition) {
  if (cars.length === 0) return -1;
  return cars.reduce((closestIndex, car, index) => {
    const closest = cars[closestIndex];
    return Math.hypot(car.x - predictedBall.x, car.z - predictedBall.z) < Math.hypot(closest.x - predictedBall.x, closest.z - predictedBall.z) ? index : closestIndex;
  }, 0);
}
