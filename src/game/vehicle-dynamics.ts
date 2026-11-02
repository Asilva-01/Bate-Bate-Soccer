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
