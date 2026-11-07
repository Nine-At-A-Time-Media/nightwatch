/**
 * Refusal -- the named reason a request was not carried out (design Domain
 * Language). Shared by every layer; it reveals nothing beyond its reason.
 */

export type Refusal = { readonly refusal: string };

export function refusal(reason: string): Refusal {
  return { refusal: reason };
}

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === 'object' && value !== null && 'refusal' in value && typeof (value as Refusal).refusal === 'string';
}
