import { CAR } from './config';

export function getLateralRecoveryImpulse(
  velocityX: number,
  velocityZ: number,
  heading: number,
  mass: number,
  grip: number,
) {
  const forwardX = -Math.sin(heading);
  const forwardZ = -Math.cos(heading);
  const lateralSpeed = velocityX * forwardZ - velocityZ * forwardX;
  return {
    x: -forwardZ * lateralSpeed * mass * grip,
    z: forwardX * lateralSpeed * mass * grip,
  };
}

const THROTTLE_EPSILON = 1e-3;

type DriveParams = Pick<
  typeof CAR,
  'maxSpeed' | 'reverseMaxSpeed' | 'throttleResponse' | 'brakeResponse' | 'coastResponse' | 'brakingThreshold'
>;

type SteeringParams = Pick<
  typeof CAR,
  'maxSpeed' | 'steeringRate' | 'steeringRateAtMaxSpeed' | 'steeringReferenceSpeed' | 'minSteeringScale' | 'reverseSteeringThreshold'
>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Velocidade para a frente após `dt`, com respostas separadas de acelerador, freio e inércia. */
export function nextForwardSpeed(speed: number, throttle: number, dt: number, params: DriveParams = CAR): number {
  const input = clamp(throttle, -1, 1);
  const target = input >= 0 ? input * params.maxSpeed : input * params.reverseMaxSpeed;
  let rate: number;
  if (Math.abs(input) < THROTTLE_EPSILON) rate = params.coastResponse;
  else if (speed * input < -params.brakingThreshold) rate = params.brakeResponse;
  else if (Math.abs(target) > Math.abs(speed)) rate = params.throttleResponse;
  else rate = params.brakeResponse;
  return target + (speed - target) * Math.exp(-rate * dt);
}

/** Variação do heading em `dt`. `steer` positivo = direita; em ré a traseira vai para onde o stick aponta. */
export function headingDelta(steer: number, forwardSpeed: number, dt: number, params: SteeringParams = CAR): number {
  const speed = Math.abs(forwardSpeed);
  const lowSpeedScale = params.minSteeringScale + (1 - params.minSteeringScale) * clamp(speed / params.steeringReferenceSpeed, 0, 1);
  const highSpeedScale = 1 + (params.steeringRateAtMaxSpeed / params.steeringRate - 1) * clamp(speed / params.maxSpeed, 0, 1);
  const direction = forwardSpeed < -params.reverseSteeringThreshold ? -1 : 1;
  return -clamp(steer, -1, 1) * params.steeringRate * lowSpeedScale * highSpeedScale * dt * direction;
}
