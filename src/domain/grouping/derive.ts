/**
 * Fingerprint derivation -- turns a Grouping Input into one or more
 * Fingerprints under a Grouping Version, honouring the Project's Fingerprint
 * Rules and Stack Trace Rules. Pure: values in, Fingerprints out. The
 * precedence and contribution rules are stated on the Grouping Version.
 */

import { fingerprintOf, type Fingerprint } from './fingerprint.js';
import { matchingFingerprintRule, type FingerprintRule } from './fingerprint-rules.js';
import { normalizeFilename, normalizeFunction, normalizeModule } from './frames.js';
import type { GroupingException, GroupingFrame, GroupingInput } from './grouping-input.js';
import type { GroupingVersion } from './grouping-version.js';
import { parameterize } from './parameterize.js';
import { applyStackTraceRules, type RuledFrame, type StackTraceRule } from './stack-trace-rules.js';

export type GroupingRules = {
  readonly version: GroupingVersion;
  readonly fingerprintRules: readonly FingerprintRule[];
  readonly stackTraceRules: readonly StackTraceRule[];
};

type Component = readonly string[];
type Strategy = 'exception' | 'stacktrace' | 'message' | 'nothing';
type Variant = { readonly strategy: Strategy; readonly components: readonly Component[] };

const DEFAULT_TOKEN = /^\{\{\s*default\s*\}\}$/;

// --- frame contribution: predicates ---

function isPresent(text: string | null | undefined): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

function isInAppGrouped(ruled: RuledFrame): boolean {
  return ruled.inApp && ruled.grouped;
}

function isSameComponent(a: Component, b: Component): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

// --- frame contribution: helpers ---

function frameLocation(frame: GroupingFrame): string {
  if (isPresent(frame.module)) return normalizeModule(frame.module);
  const path = isPresent(frame.filename) ? frame.filename : frame.absPath;
  return isPresent(path) ? normalizeFilename(path) : '';
}

function frameContext({ frame, version }: { frame: GroupingFrame; version: GroupingVersion }): string {
  const line = (frame.contextLine ?? '').trim().replace(/\s+/g, ' ');
  return line.length <= version.contextLineMaxLength ? line : '';
}

function frameContribution({ frame, version }: { frame: GroupingFrame; version: GroupingVersion }): Component | null {
  const location = frameLocation(frame);
  const fn = isPresent(frame.function) ? normalizeFunction(frame.function) : null;
  const context = fn === null ? frameContext({ frame, version }) : '';
  if (location === '' && fn === null && context === '') return null;
  return ['frame', location, fn ?? '', context];
}

function collapseRecursion(components: readonly Component[]): readonly Component[] {
  return components.filter((component, index) => {
    const previous = components[index - 1];
    return previous === undefined || !isSameComponent(previous, component);
  });
}

function frameComponents({ frames, version }: { frames: readonly RuledFrame[]; version: GroupingVersion }): readonly Component[] {
  const contributions = frames
    .filter((ruled) => ruled.grouped)
    .map((ruled) => frameContribution({ frame: ruled.frame, version }))
    .filter((component) => component !== null);
  return collapseRecursion(contributions);
}

// --- default strategies: predicates ---

function isSynthetic(exception: GroupingException): boolean {
  return exception.mechanism?.synthetic === true;
}

function hasComponents(variant: Variant): boolean {
  return variant.components.length > 0;
}

// --- default strategies: helpers ---

function exceptionComponents({
  exception,
  frames,
  version,
}: {
  exception: GroupingException;
  frames: readonly RuledFrame[];
  version: GroupingVersion;
}): readonly Component[] {
  const contributing = frameComponents({ frames, version });
  const own = !isSynthetic(exception);
  const type: readonly Component[] = own && isPresent(exception.type) ? [['type', exception.type ?? '']] : [];
  const value: readonly Component[] =
    own && contributing.length === 0 && isPresent(exception.value) ? [['value', parameterize(exception.value ?? '')]] : [];
  return [...type, ...contributing, ...value];
}

function exceptionVariants({ input, rules }: { input: GroupingInput; rules: GroupingRules }): readonly Variant[] {
  const chain = input.exceptions.map((exception) => ({
    exception,
    frames: applyStackTraceRules({ frames: exception.frames, platform: input.platform, rules: rules.stackTraceRules }),
  }));
  const system = chain.flatMap(({ exception, frames }) => exceptionComponents({ exception, frames, version: rules.version }));
  const anyInApp = chain.some(({ frames }) => frames.some(isInAppGrouped));
  const app = anyInApp
    ? chain.flatMap(({ exception, frames }) =>
        exceptionComponents({ exception, frames: frames.filter((ruled) => ruled.inApp), version: rules.version }),
      )
    : [];
  return [
    { strategy: 'exception' as const, components: app },
    { strategy: 'exception' as const, components: system },
  ].filter(hasComponents);
}

function stacktraceVariants({ input, rules }: { input: GroupingInput; rules: GroupingRules }): readonly Variant[] {
  const frames = applyStackTraceRules({ frames: input.stacktrace ?? [], platform: input.platform, rules: rules.stackTraceRules });
  const system = frameComponents({ frames, version: rules.version });
  const app = frames.some(isInAppGrouped) ? frameComponents({ frames: frames.filter((ruled) => ruled.inApp), version: rules.version }) : [];
  return [
    { strategy: 'stacktrace' as const, components: app },
    { strategy: 'stacktrace' as const, components: system },
  ].filter(hasComponents);
}

function messageVariants(input: GroupingInput): readonly Variant[] {
  const text = input.message?.template ?? input.message?.formatted ?? '';
  return isPresent(text) ? [{ strategy: 'message', components: [['message', parameterize(text)]] }] : [];
}

function defaultVariants({ input, rules }: { input: GroupingInput; rules: GroupingRules }): readonly Variant[] {
  const exception = exceptionVariants({ input, rules });
  if (exception.length > 0) return exception;
  const stacktrace = stacktraceVariants({ input, rules });
  if (stacktrace.length > 0) return stacktrace;
  const message = messageVariants(input);
  return message.length > 0 ? message : [{ strategy: 'nothing', components: [] }];
}

function unique(fingerprints: readonly Fingerprint[]): readonly Fingerprint[] {
  return [...new Set(fingerprints)];
}

function defaultFingerprints({ input, rules }: { input: GroupingInput; rules: GroupingRules }): readonly Fingerprint[] {
  return unique(
    defaultVariants({ input, rules }).map((variant) => fingerprintOf([rules.version.id, variant.strategy, ...variant.components])),
  );
}

// --- fingerprint values: predicates ---

function isDefaultToken(value: string): boolean {
  return DEFAULT_TOKEN.test(value.trim());
}

/** A value list that names anything besides the default token overrides plain derivation. */
function isOverride(values: readonly string[] | null): values is readonly string[] {
  return values !== null && values.some((value) => !isDefaultToken(value));
}

// --- fingerprint values: helpers ---

function overridingValues({ input, rules }: { input: GroupingInput; rules: GroupingRules }): readonly string[] | null {
  if (isOverride(input.fingerprint)) return input.fingerprint;
  const rule = matchingFingerprintRule({ input, rules: rules.fingerprintRules });
  return rule !== null && isOverride(rule.values) ? rule.values : null;
}

function fingerprintsFromValues({
  values,
  input,
  rules,
}: {
  values: readonly string[];
  input: GroupingInput;
  rules: GroupingRules;
}): readonly Fingerprint[] {
  if (!values.some(isDefaultToken)) return [fingerprintOf([rules.version.id, 'custom', values])];
  const salt = values.filter((value) => !isDefaultToken(value));
  return defaultFingerprints({ input, rules }).map((fingerprint) => fingerprintOf([rules.version.id, 'salted', fingerprint, salt]));
}

// --- exports ---

/** Every Fingerprint an Event yields under the given Grouping Version and Project rules; never empty. */
export function deriveFingerprints(input: GroupingInput, rules: GroupingRules): readonly Fingerprint[] {
  const values = overridingValues({ input, rules });
  return values === null ? defaultFingerprints({ input, rules }) : fingerprintsFromValues({ values, input, rules });
}
