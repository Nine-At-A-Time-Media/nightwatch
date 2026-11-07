/**
 * Refusal -- the named reason a Report Submission was not filed (design
 * Domain Language). The widget's own copy of the root package's shape: a
 * package may not import across packages.
 */

export type Refusal = { readonly refusal: string };

export function refusal(reason: string): Refusal {
  return { refusal: reason };
}

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === 'object' && value !== null && 'refusal' in value && typeof (value as Refusal).refusal === 'string';
}
