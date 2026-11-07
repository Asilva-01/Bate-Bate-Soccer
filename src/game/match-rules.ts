import { AI, BALL, CAR, MATCH } from './config';
import { createArenaDimensions, type ArenaDimensions } from './arena-dimensions';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type ScoringSide = 'red' | 'blue';
export type GoalBallPosition = { x: number; y: number; z: number };
export type ScoreState = { red: number; blue: number; redCars: number; blueCars: number; finished: boolean; message: string };

export function opponentSpeed(difficulty: Difficulty, round: number) {
  return Math.min(AI.maxSpeedFactor, AI.difficultySpeed[difficulty] + Math.max(0, round - 1) * AI.speedIncreasePerRound);
}

/** Fator da velocidade máxima da IA: fácil fica no 0,75; nenhum nível passa do jogador sem turbo. */
export function aiSpeedFactor(difficulty: Difficulty, round = 1): number {
  const grown = opponentSpeed(difficulty, round);
  if (difficulty === 'easy') return Math.min(AI.difficultySpeed.easy, grown);
  return Math.min(1, grown);
}

export function aiMaxSpeed(difficulty: Difficulty, round = 1): number {
  return CAR.maxSpeed * aiSpeedFactor(difficulty, round);
}

/** Horizonte de previsão: no fácil o tempo de reação atrasa a bola prevista em relação ao difícil. */
export function aiPredictionSeconds(difficulty: Difficulty): number {
  const extraLag = Math.max(0, AI.difficultyReactionTime[difficulty] - AI.difficultyReactionTime.hard);
  return Math.max(0, AI.predictionSeconds - extraLag);
}

export function opponentCars(round: number) {
  return Math.min(AI.maxCars, AI.startingCars + Math.floor(round / AI.roundsPerAdditionalCar));
}

export function getScoringSide(
  ball: GoalBallPosition,
  dims: ArenaDimensions = createArenaDimensions(),
  radius = BALL.radius,
): ScoringSide | null {
  const insideDepth = Math.abs(ball.x) >= dims.goalLineX + radius
    && Math.abs(ball.x) <= dims.goalBackX - radius;
  const insideMouth = Math.abs(ball.z) <= dims.goalHalfWidth - radius
    && ball.y + radius <= dims.goalHeight;
  if (!insideDepth || !insideMouth) return null;
  return ball.x > 0 ? 'blue' : 'red';
}

export function awardGoal(state: ScoreState, team: ScoringSide, round: number): ScoreState {
  const red = state.red + Number(team === 'red');
  const blue = state.blue + Number(team === 'blue');
  const redCars = team === 'red' && round >= AI.allyUnlockRound ? AI.playerCarsWithAlly : team === 'blue' ? MATCH.startingCars : state.redCars;
  const blueCars = opponentCars(round);
  const finished = red >= MATCH.goalsToWin || blue >= MATCH.goalsToWin;
  const scoreDiff = red - blue;
  const message = finished
    ? team === 'red' ? scoreDiff === 3 ? 'Vitória impecável! 3 a 0!' : scoreDiff === 2 ? 'Vitória sólida! Próxima rodada.' : 'Vitória apertada! Continue assim.' : 'Derrota. O azul dominou. Tente novamente!'
    : team === 'red' ? round >= 2 ? red === 2 ? 'GOLAÇO! Falta 1 para a vitória!' : 'GOL VERMELHO! Aliado em campo.' : red === 2 ? 'MAIS UM! Vitória à vista!' : 'GOL! Reforço disponível na rodada 2.'
      : blue === 2 ? 'GOL AZUL! Eles estão perto da vitória!' : 'GOL AZUL! Reforço perdido.';
  return { ...state, red, blue, redCars, blueCars, finished, message };
}

export function selectAttacker(cars: readonly GoalBallPosition[], predictedBall: GoalBallPosition, goalX: number) {
  if (cars.length === 0) return -1;
  return cars.reduce((bestIndex, car, index) => {
    const best = cars[bestIndex];
    const distanceToBall = Math.hypot(car.x - predictedBall.x, car.z - predictedBall.z);
    const bestDistanceToBall = Math.hypot(best.x - predictedBall.x, best.z - predictedBall.z);
    const towardGoal = (goalX - car.x) * (predictedBall.x - car.x) + (0 - car.z) * (predictedBall.z - car.z);
    const bestTowardGoal = (goalX - best.x) * (predictedBall.x - best.x) + (0 - best.z) * (predictedBall.z - best.z);
    const score = distanceToBall - (towardGoal > 0 ? 2 : 0);
    const bestScore = bestDistanceToBall - (bestTowardGoal > 0 ? 2 : 0);
    return score < bestScore ? index : bestIndex;
  }, 0);
}
