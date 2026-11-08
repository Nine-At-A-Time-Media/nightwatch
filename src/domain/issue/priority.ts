/**
 * Priority -- low, medium or high (design Issues, Priority). Initial
 * Priority follows the event level; escalation raises it one step; a
 * Priority a member set by hand is never changed automatically.
 */

export type PriorityLevel = 'low' | 'medium' | 'high';

export type Priority = { readonly level: PriorityLevel; readonly setByHand: boolean };

/** An Event's level, as SDKs report it. */
export type Level = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

const INITIAL_LEVEL: Readonly<Record<Level, PriorityLevel>> = {
  fatal: 'high',
  error: 'high',
  warning: 'medium',
  info: 'low',
  debug: 'low',
};

const RAISED: Readonly<Record<PriorityLevel, PriorityLevel>> = { low: 'medium', medium: 'high', high: 'high' };

export function initialPriority(level: Level): Priority {
  return { level: INITIAL_LEVEL[level], setByHand: false };
}

/** Escalation's effect on Priority: one step up, unless a member set it by hand. */
export function raisePriority(priority: Priority): Priority {
  return priority.setByHand ? priority : { level: RAISED[priority.level], setByHand: false };
}
