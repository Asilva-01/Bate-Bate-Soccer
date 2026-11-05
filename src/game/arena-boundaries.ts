export function containPlanarBody(
  x: number,
  z: number,
  velocityX: number,
  velocityZ: number,
  maxX: number,
  maxZ: number,
  restitution: number,
) {
  const outsideX = Math.abs(x) > maxX;
  const outsideZ = Math.abs(z) > maxZ;
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    z: Math.max(-maxZ, Math.min(maxZ, z)),
    velocityX: outsideX ? -Math.sign(x) * Math.abs(velocityX) * restitution : velocityX,
    velocityZ: outsideZ ? -Math.sign(z) * Math.abs(velocityZ) * restitution : velocityZ,
  };
}
