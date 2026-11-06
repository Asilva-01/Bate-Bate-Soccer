import { clamp } from './math';
import type { ControlFrame } from './input';

export type DriveCommand = { throttle: number; steer: number; boost: boolean; kick: boolean };

export function driveCommandFromFrame(frame: ControlFrame, lastKickPresses: number): { command: DriveCommand; kickPresses: number } {
  const kick = frame.kickPresses > lastKickPresses;
  return {
    command: {
      throttle: clamp(frame.throttle, -1, 1),
      steer: clamp(frame.steer, -1, 1),
      boost: frame.boost,
      kick,
    },
    kickPresses: Math.max(lastKickPresses, frame.kickPresses),
  };
}
