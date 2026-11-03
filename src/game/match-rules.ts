import { AI, BALL, FIELD, MATCH } from './config';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type ScoringSide = 'red' | 'blue';
export type GoalBallPosition = { x: number; y: number; z: number };
export type ScoreState = { red: number; blue: number; redCars: number; blueCars: number; finished: boolean; message: string };

export function opponentSpeed(difficulty: Difficulty, round: number) {
  return Math.min(AI.maxSpeedFactor, AI.difficultySpeed[difficulty] + Math.max(0, round - 1) * AI.speedIncreasePerRound);
}

export function opponentCars(round: number) {
  return Math.min(AI.maxCars, AI.startingCars + Math.floor(round / AI.roundsPerAdditionalCar));
}

export function getScoringSide(ball: GoalBallPosition): ScoringSide | null {
  const insideDepth = Math.abs(ball.x) >= FIELD.goalLineX + BALL.radius + FIELD.scoreMargin
    && Math.abs(ball.x) <= FIELD.goalBackX - BALL.radius;
  const insideMouth = Math.abs(ball.z) <= FIELD.goalHalfWidth - BALL.radius
    && ball.y + BALL.radius <= FIELD.goalHeight;
  if (!insideDepth || !insideMouth) return null;
  return ball.x > 0 ? 'blue' : 'red';
}

export function awardGoal(state: ScoreState, team: ScoringSide, round: number): ScoreState {
  const red = state.red + Number(team === 'red');
  const blue = state.blue + Number(team === 'blue');
  const redCars = team === 'red' && round >= AI.allyUnlockRound ? AI.playerCarsWithAlly : team === 'blue' ? MATCH.startingCars : state.redCars;
  const blueCars = opponentCars(round);
  const finished = red >= MATCH.goalsToWin || blue >= MATCH.goalsToWin;
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
