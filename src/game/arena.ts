import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA } from './config';
import { createArenaDimensions, type ArenaDimensions } from './arena-dimensions';

const TEAM = { red: 0xe2604d, blue: 0x69b7df } as const;

function boxGeometry(w: number, h: number, d: number, x: number, y: number, z: number) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return geometry;
}

function merge(geometries: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error('Falha ao mesclar geometria da arena');
  return merged;
}

function gridTexture(stroke: string, cells = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  const step = 128 / cells;
  for (let i = 0; i <= cells; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, 128);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(128, i * step);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function wallSegments(dims: ArenaDimensions) {
  const opaque = ARENA.wallOpaqueHeight;
  const glass = ARENA.wallGlassHeight - ARENA.wallOpaqueHeight;
  const thickness = dims.wallThickness;
  const sideExtent = (dims.goalLineX - dims.cornerChamfer) * 2;
  const backLen = dims.sideWallZ - dims.cornerChamfer - dims.goalHalfWidth;
  const chamferLen = dims.cornerChamfer * Math.SQRT2;
  const pieces: { x: number; z: number; w: number; d: number; yaw: number }[] = [];
  for (const side of [-1, 1]) {
    pieces.push({ x: 0, z: side * (dims.sideWallZ + thickness / 2), w: sideExtent, d: thickness, yaw: 0 });
  }
  for (const end of [-1, 1]) {
    for (const lane of [-1, 1]) {
      pieces.push({
        x: end * (dims.goalLineX + thickness / 2),
        z: lane * (dims.goalHalfWidth + backLen / 2),
        w: thickness,
        d: backLen,
        yaw: 0,
      });
    }
  }
  const corners = [
    { sx: 1, sz: 1, yaw: -Math.PI / 4 },
    { sx: 1, sz: -1, yaw: Math.PI / 4 },
    { sx: -1, sz: 1, yaw: (-3 * Math.PI) / 4 },
    { sx: -1, sz: -1, yaw: (3 * Math.PI) / 4 },
  ];
  const chamferPush = (thickness / 2) / Math.SQRT2;
  for (const { sx, sz, yaw } of corners) {
    pieces.push({
      x: sx * (dims.goalLineX - dims.cornerChamfer / 2) + sx * chamferPush,
      z: sz * (dims.sideWallZ - dims.cornerChamfer / 2) + sz * chamferPush,
      w: thickness,
      d: chamferLen,
      yaw,
    });
  }
  return { opaque, glass, pieces };
}

function wallBand(pieces: ReturnType<typeof wallSegments>['pieces'], height: number, y: number) {
  return pieces.map((piece) => {
    const geometry = new THREE.BoxGeometry(piece.w, height, piece.d);
    geometry.rotateY(piece.yaw);
    geometry.translate(piece.x, y, piece.z);
    return geometry;
  });
}

export function createArena(dims: ArenaDimensions = createArenaDimensions()) {
  const group = new THREE.Group();
  const floor = new THREE.MeshLambertMaterial({ color: 0x2f5a3c });
  const stripe = new THREE.MeshLambertMaterial({ color: 0x3a6b47 });
  const line = new THREE.MeshBasicMaterial({ color: 0xd7efe4 });
  const opaqueWall = new THREE.MeshLambertMaterial({ color: 0x15202c });
  const glassWall = new THREE.MeshLambertMaterial({
    color: 0x8fd7ea,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const neon = new THREE.MeshBasicMaterial({ color: 0x23ccff });
  const shell = new THREE.MeshLambertMaterial({ color: 0x101b29 });

  group.add(new THREE.Mesh(boxGeometry(dims.goalBackX * 2 + 8, 0.5, dims.sideWallZ * 2 + 10, 0, -0.3, 0), shell));
  group.add(new THREE.Mesh(boxGeometry(dims.goalLineX * 2, 0.12, dims.sideWallZ * 2, 0, 0, 0), floor));

  const stripes: THREE.BufferGeometry[] = [];
  for (let x = -32; x <= 32; x += 8) {
    stripes.push(boxGeometry(3.6, 0.01, dims.sideWallZ * 2 - 1.2, x, 0.07, 0));
  }
  group.add(new THREE.Mesh(merge(stripes), stripe));

  const markings: THREE.BufferGeometry[] = [
    boxGeometry(0.12, 0.02, dims.sideWallZ * 2 - 0.8, 0, 0.08, 0),
  ];
  for (const z of [-dims.sideWallZ + 0.4, dims.sideWallZ - 0.4]) {
    markings.push(boxGeometry(dims.goalLineX * 2 - 0.6, 0.02, 0.12, 0, 0.08, z));
  }
  for (const x of [-dims.goalLineX + 0.2, dims.goalLineX - 0.2]) {
    markings.push(boxGeometry(0.12, 0.02, dims.sideWallZ * 2 - 0.8, x, 0.08, 0));
  }
  const circle = new THREE.RingGeometry(7.85, 8.05, 64);
  circle.rotateX(-Math.PI / 2);
  circle.translate(0, 0.085, 0);
  markings.push(circle);
  for (const side of [-1, 1]) {
    markings.push(boxGeometry(0.12, 0.02, dims.goalHalfWidth * 2, side * (dims.goalLineX - 11), 0.08, 0));
    for (const z of [-dims.goalHalfWidth, dims.goalHalfWidth]) {
      markings.push(boxGeometry(11, 0.02, 0.12, side * (dims.goalLineX - 5.5), 0.08, z));
    }
  }
  group.add(new THREE.Mesh(merge(markings), line));

  const { opaque, glass, pieces } = wallSegments(dims);
  group.add(new THREE.Mesh(merge(wallBand(pieces, opaque, opaque / 2)), opaqueWall));
  group.add(new THREE.Mesh(merge(wallBand(pieces, glass, opaque + glass / 2)), glassWall));
  group.add(new THREE.Mesh(merge(wallBand(pieces, 0.12, opaque + 0.02)), neon));

  const ceilingTex = gridTexture('#6aa8b888', 10);
  if (ceilingTex) ceilingTex.repeat.set(12, 8);
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(dims.goalLineX * 2, dims.sideWallZ * 2),
    new THREE.MeshBasicMaterial({
      map: ceilingTex,
      color: 0x1a2a36,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = dims.ceilingY;
  group.add(ceiling);

  const postRadius = 0.16;
  for (const side of [-1, 1] as const) {
    const color = side < 0 ? TEAM.red : TEAM.blue;
    const frameMat = new THREE.MeshBasicMaterial({ color });
    const postX = side * dims.goalLineX;
    const backX = side * dims.goalBackX;
    const posts = [
      boxGeometry(postRadius * 2, dims.goalHeight, postRadius * 2, postX, dims.goalHeight / 2, -dims.goalHalfWidth),
      boxGeometry(postRadius * 2, dims.goalHeight, postRadius * 2, postX, dims.goalHeight / 2, dims.goalHalfWidth),
      boxGeometry(postRadius * 2, postRadius * 2, dims.goalHalfWidth * 2, postX, dims.goalHeight, 0),
      boxGeometry(postRadius * 1.4, postRadius * 1.4, dims.goalHalfWidth * 2, backX, dims.goalHeight, 0),
      boxGeometry(Math.abs(backX - postX), postRadius * 1.4, postRadius * 1.4, (postX + backX) / 2, dims.goalHeight, -dims.goalHalfWidth),
      boxGeometry(Math.abs(backX - postX), postRadius * 1.4, postRadius * 1.4, (postX + backX) / 2, dims.goalHeight, dims.goalHalfWidth),
    ];
    group.add(new THREE.Mesh(merge(posts), frameMat));

    const netTex = gridTexture(side < 0 ? '#d38476cc' : '#87b9c7cc', 6);
    if (netTex) netTex.repeat.set(4, 3);
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(dims.goalHalfWidth * 2, dims.goalHeight),
      new THREE.MeshBasicMaterial({
        map: netTex ?? undefined,
        color,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    net.position.set(backX - side * 0.05, dims.goalHeight / 2, 0);
    net.rotation.y = Math.PI / 2;
    group.add(net);
  }

  return group;
}
