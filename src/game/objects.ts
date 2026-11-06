import * as THREE from 'three';
import { BALL } from './config';

function mesh(group: THREE.Group, geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) { const object = new THREE.Mesh(geometry, mat); object.position.set(x, y, z); group.add(object); return object; }
export function createCar(color: number, number: string) {
  const group = new THREE.Group();
  group.scale.setScalar(1.2);
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.22 });
  const darkPaint = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.46), metalness: 0.45, roughness: 0.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x11151e, metalness: 0.25, roughness: 0.42 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8595a4, metalness: 0.8, roughness: 0.25 });
  const suit = new THREE.MeshStandardMaterial({ color: 0x18202c, metalness: 0.15, roughness: 0.55 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x08121e, metalness: 0.75, roughness: 0.12 });
  const lamp = new THREE.MeshBasicMaterial({ color: color === 0x148fff ? 0xff79d8 : 0xffe08a });
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f8ff, metalness: 0.15, roughness: 0.3 });

  const oval = (geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const part = mesh(group, geometry, mat, x, y, z);
    part.scale.set(sx, sy, sz);
    return part;
  };
  const sphere = () => new THREE.SphereGeometry(1, 20, 12);

  // A broad, layered rubber skirt gives the car its bumper-car silhouette.
  oval(new THREE.CylinderGeometry(1, 1, 0.32, 32), rubber, 0, 0.28, 0, 1.28, 1, 1.45);
  oval(new THREE.CylinderGeometry(1, 1, 0.045, 32), trim, 0, 0.46, 0, 1.25, 1, 1.42);
  oval(new THREE.CylinderGeometry(1, 1, 0.07, 32), rubber, 0, 0.51, 0, 1.23, 1, 1.4);
  oval(sphere(), paint, 0, 0.68, 0, 1.13, 0.37, 1.33);
  // Rounded hood and rear flanks frame a recessed cockpit.
  oval(sphere(), paint, 0, 0.82, -0.75, 1.03, 0.34, 0.7);
  oval(sphere(), darkPaint, 0, 0.88, 0.35, 0.73, 0.18, 0.74);
  for (const x of [-0.88, 0.88]) {
    oval(sphere(), paint, x, 0.88, 0.35, 0.27, 0.29, 0.78);
    const light = oval(sphere(), lamp, x * 0.78, 0.78, -1.23, 0.26, 0.09, 0.08);
    light.rotation.y = x > 0 ? -0.25 : 0.25;
    const housing = oval(sphere(), rubber, x * 0.78, 0.78, -1.2, 0.3, 0.14, 0.08);
    housing.rotation.y = light.rotation.y;
  }
  // Seat, helmeted driver and arms are designed to remain readable from above.
  const seat = oval(sphere(), rubber, 0, 1.12, 0.68, 0.66, 0.57, 0.2);
  seat.rotation.x = -0.2;
  oval(sphere(), suit, 0, 1.13, 0.22, 0.43, 0.4, 0.36);
  oval(sphere(), paint, 0, 1.67, 0.18, 0.43, 0.47, 0.42);
  oval(sphere(), visor, 0, 1.67, -0.18, 0.34, 0.23, 0.12);
  oval(sphere(), white, -0.27, 1.94, 0.12, 0.055, 0.13, 0.23).rotation.z = -0.35;
  for (const x of [-1, 1]) {
    const arm = oval(sphere(), suit, x * 0.37, 1.18, -0.17, 0.16, 0.15, 0.43);
    arm.rotation.y = x * -0.35;
    oval(sphere(), rubber, x * 0.24, 1.17, -0.48, 0.14, 0.12, 0.16);
  }
  const steering = mesh(group, new THREE.TorusGeometry(0.27, 0.045, 8, 20), rubber, 0, 1.16, -0.51);
  steering.rotation.x = -0.55;
  const column = mesh(group, new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8), trim, 0, 1.02, -0.62);
  column.rotation.x = 0.7;

  // Number on the hood echoes the large race numbers in the reference image.
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fff'; ctx.font = 'italic bold 170px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(number, 128, 130);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = mesh(group, new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }), 0, 1.13, -0.87);
    label.rotation.x = -Math.PI / 2;
  }
  return group;
}
function createBallTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f2f5f2';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#101720';
  const pentagon = (cx: number, cy: number, radius: number) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  const spots: [number, number][] = [
    [0.5, 0.07], [0.5, 0.93],
    [0.5, 0.38], [0.5, 0.62],
    [0.18, 0.22], [0.82, 0.22],
    [0.18, 0.78], [0.82, 0.78],
    [0.08, 0.5], [0.92, 0.5],
    [0.32, 0.5], [0.68, 0.5],
  ];
  for (const [u, v] of spots) pentagon(u * size, v * size, size * 0.055);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createBall() {
  const map = createBallTexture();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL.radius, 32, 24),
    new THREE.MeshStandardMaterial({
      color: 0xf2f5f2,
      map: map ?? undefined,
      emissive: 0xf2f5f2,
      emissiveIntensity: BALL.emissiveIntensity,
      metalness: 0.08,
      roughness: 0.38,
    }),
  );
  ball.position.y = BALL.radius + BALL.visualOffsetY;
  return ball;
}
