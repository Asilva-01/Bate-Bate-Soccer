export type Circle = { x: number; y: number; r: number };
export type ClusterHit = 'boost' | 'kick' | 'both' | null;

/** Acerto do cluster direito: TURBO, TOQUE, ou os dois na faixa de costura. */
export function hitActionCluster(x: number, y: number, boost: Circle, kick: Circle, slackPx: number): ClusterHit {
  const distBoost = Math.hypot(x - boost.x, y - boost.y);
  const distKick = Math.hypot(x - kick.x, y - kick.y);
  const inBoost = distBoost <= boost.r;
  const inKick = distKick <= kick.r;
  if (inBoost && inKick) return 'both';
  if (inBoost) return distKick <= kick.r + slackPx ? 'both' : 'boost';
  if (inKick) return distBoost <= boost.r + slackPx ? 'both' : 'kick';
  if (distBoost + distKick <= boost.r + kick.r + slackPx) return 'both';
  return null;
}
