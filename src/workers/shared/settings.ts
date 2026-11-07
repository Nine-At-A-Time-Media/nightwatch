/**
 * Settings readers the composition roots share: each Worker reads its
 * settings once from its vars (architecture Parameters placed: "settings"
 * are Worker vars) and its secrets from its environment, and refuses to
 * build when one is missing or malformed, naming it. The stage check is the
 * one stage-dependent decision (architecture Local development): only the
 * local stage has adapters in this repository.
 */

const LOCAL_STAGE = 'local';

// --- predicates ---

export function isLocalStage(stage: unknown): boolean {
  return stage === LOCAL_STAGE;
}

// --- readers ---

export function positiveSetting({ name, value }: { name: string; value: unknown }): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`setting ${name} must be a positive number, got ${String(value)}`);
  return number;
}

export function textSetting({ name, value }: { name: string; value: unknown }): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`setting ${name} must be non-empty text`);
  return value;
}

/** A comma-separated list; blank entries are dropped. */
export function listSetting({ name, value }: { name: string; value: unknown }): string[] {
  if (typeof value !== 'string') throw new Error(`setting ${name} must be comma-separated text`);
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** A Worker secret (`.dev.vars` locally); its name is given, never its value. */
export function secretSetting({ name, value }: { name: string; value: unknown }): string {
  if (typeof value !== 'string' || value === '') throw new Error(`secret ${name} is not set`);
  return value;
}

export function requireLocalStage({ worker, stage }: { worker: string; stage: unknown }): void {
  if (!isLocalStage(stage)) throw new Error(`${worker}: stage ${String(stage)} has no adapters`);
}
