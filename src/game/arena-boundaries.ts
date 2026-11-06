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

export function containSpatialBody(
  x: number,
  y: number,
  z: number,
  velocityX: number,
  velocityY: number,
  velocityZ: number,
  maxX: number,
  maxZ: number,
  minY: number,
  maxY: number,
  restitution: number,
) {
  const planar = containPlanarBody(x, z, velocityX, velocityZ, maxX, maxZ, restitution);
  const below = y < minY;
  const above = y > maxY;
  return {
    ...planar,
    y: Math.max(minY, Math.min(maxY, y)),
    velocityY: below ? Math.abs(velocityY) * restitution : above ? -Math.abs(velocityY) * restitution : velocityY,
  };
}
