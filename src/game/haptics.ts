import { TOUCH } from './config';

export type HapticKind = 'dash' | 'kickHit' | 'goalFor' | 'goalAgainst' | 'boostEmpty';

type VibrateFn = (pattern: VibratePattern) => boolean;
type VibrateHost = { vibrate?: VibrateFn };

export function hapticPattern(kind: HapticKind, params = TOUCH.haptics): number | readonly number[] {
  if (kind === 'dash') return params.kickDash;
  if (kind === 'kickHit') return params.kickHit;
  if (kind === 'goalFor') return params.goalFor;
  if (kind === 'goalAgainst') return params.goalAgainst;
  return params.boostEmpty;
}

export function canVibrate(nav: VibrateHost | undefined): nav is { vibrate: VibrateFn } {
  return typeof nav?.vibrate === 'function';
}

/** iOS Safari não tem `vibrate`: falha em silêncio. */
export function tryVibrate(
  kind: HapticKind,
  enabled: boolean,
  nav: VibrateHost | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  if (!enabled || !canVibrate(nav)) return false;
  try {
    const pattern = hapticPattern(kind);
    nav.vibrate(pattern as VibratePattern);
    return true;
  } catch {
    return false;
  }
}
