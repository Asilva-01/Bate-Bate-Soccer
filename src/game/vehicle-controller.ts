import { CAR } from './config';
import { clamp } from './math';
import type { DriveCommand } from './controls';

export type VehicleState = {
  vx: number;
  vy: number;
  vz: number;
  y: number;
  heading: number;
  grounded: boolean;
  boost: number;
  dashTime: number;
  kickCooldown: number;
};

export type VehicleStep = {
  heading: number;
  impulse: { x: number; y: number; z: number };
  boost: number;
  dashStarted: boolean;
};

const THROTTLE_EPSILON = 1e-3;

type DriveParams = {
  maxSpeed: number;
  reverseMaxSpeed: number;
  boostMaxSpeed: number;
  boostAcceleration: number;
  throttleResponse: number;
  brakeResponse: number;
  coastResponse: number;
  brakingThreshold: number;
  mass: number;
  lateralGripPerSecond: number;
  steeringRate: number;
  steeringRateAtMaxSpeed: number;
  reverseSteeringThreshold: number;
};

export function isGrounded(y: number, vy: number, params: Pick<typeof CAR, 'hitbox' | 'groundEpsilon'> = CAR): boolean {
  return vy <= 0.5 && y <= params.hitbox.halfHeight + params.groundEpsilon;
}

/** Velocidade para a frente após `dt`, com respostas separadas de acelerador, freio e inércia. */
export function nextForwardSpeed(speed: number, throttle: number, dt: number, params: Pick<DriveParams, 'maxSpeed' | 'reverseMaxSpeed' | 'throttleResponse' | 'brakeResponse' | 'coastResponse' | 'brakingThreshold'> = CAR): number {
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
export function headingDelta(
  steer: number,
  forwardSpeed: number,
  dt: number,
  params: Pick<DriveParams, 'maxSpeed' | 'steeringRate' | 'steeringRateAtMaxSpeed' | 'reverseSteeringThreshold'> = CAR,
): number {
  const speed = Math.abs(forwardSpeed);
  const highSpeedBlend = clamp(speed / params.maxSpeed, 0, 1);
  const rate = params.steeringRate + (params.steeringRateAtMaxSpeed - params.steeringRate) * highSpeedBlend;
  const direction = forwardSpeed < -params.reverseSteeringThreshold ? -1 : 1;
  return -clamp(steer, -1, 1) * rate * dt * direction;
}

export function stepVehicle(state: VehicleState, command: DriveCommand, dt: number, params: DriveParams = CAR): VehicleStep {
  const throttle = clamp(command.throttle, -1, 1);
  const steer = clamp(command.steer, -1, 1);
  const fx = -Math.sin(state.heading);
  const fz = -Math.cos(state.heading);
  const forwardSpeed = state.vx * fx + state.vz * fz;
  const heading = state.heading + headingDelta(steer, forwardSpeed, dt, params);
  const nextFx = -Math.sin(heading);
  const nextFz = -Math.cos(heading);
  const lateralSpeed = state.vx * nextFz - state.vz * nextFx;
  const grip = 1 - Math.exp(-params.lateralGripPerSecond * dt);
  const lateralImpulse = -lateralSpeed * grip * params.mass;

  const driveParams = command.boost
    ? { ...params, maxSpeed: params.boostMaxSpeed }
    : params;
  let nextSpeed = nextForwardSpeed(forwardSpeed, throttle, dt, driveParams);
  if (command.boost && throttle >= 0) {
    nextSpeed = Math.max(nextSpeed, forwardSpeed + params.boostAcceleration * dt);
    nextSpeed = Math.min(params.boostMaxSpeed, nextSpeed);
  } else if (nextSpeed > params.maxSpeed) {
    nextSpeed = params.maxSpeed;
  } else if (nextSpeed < -params.reverseMaxSpeed) {
    nextSpeed = -params.reverseMaxSpeed;
  }
  const forwardImpulse = (nextSpeed - forwardSpeed) * params.mass;

  return {
    heading,
    impulse: {
      x: nextFz * lateralImpulse + nextFx * forwardImpulse,
      y: 0,
      z: -nextFx * lateralImpulse + nextFz * forwardImpulse,
    },
    boost: state.boost,
    dashStarted: false,
  };
}
