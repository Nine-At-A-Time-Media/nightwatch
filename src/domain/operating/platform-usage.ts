/**
 * Platform Usage -- use of one Cloudflare product against its Platform Soft
 * Limit (design Domain Language: Platform Usage, Platform Soft Limit; Goals
 * G20; Behaviors: Soft limit crossed). Crossing a limit is a signal for the
 * operator, never a refusal: nothing here reaches admission.
 *
 * Products are named by the UsageSource and the scheduler settings alike;
 * a product with no limit set is reported and never over.
 */

import type { AlertMessage } from '../alerts/alert-message.js';

/** One product's use in the current period, as the UsageSource measures it. */
export type ProductUsage = { readonly product: string; readonly used: number };

/** The Platform Soft Limit of each product, from the scheduler settings. */
export type PlatformSoftLimits = ReadonlyMap<string, number>;

export type PlatformUsage = {
  readonly product: string;
  readonly used: number;
  /** null when no Platform Soft Limit is set for the product. */
  readonly softLimit: number | null;
  readonly over: boolean;
};

/** Platform Usage spans the deployment, so its alerts name no Project and no rule of one. */
const DEPLOYMENT = '';
const SOFT_LIMIT_RULE = 'platform-soft-limit';

// --- predicates ---

function isOver(used: number, softLimit: number | null): boolean {
  return softLimit !== null && used > softLimit;
}

// --- exports ---

/** Each measured product against its limit, in the order measured. */
export function comparePlatformUsage(usage: readonly ProductUsage[], limits: PlatformSoftLimits): PlatformUsage[] {
  return usage.map(({ product, used }) => {
    const softLimit = limits.get(product) ?? null;
    return { product, used, softLimit, over: isOver(used, softLimit) };
  });
}

/** The operator's alert for a product over its limit; every attempt of one comparison's alert is the same delivery. */
export function softLimitMessage({ usage, at }: { usage: PlatformUsage; at: number }): AlertMessage {
  return {
    deliveryId: `${SOFT_LIMIT_RULE}:${usage.product}:${at}`,
    projectId: DEPLOYMENT,
    ruleId: SOFT_LIMIT_RULE,
    issueId: null,
    subject: `Platform Soft Limit crossed: ${usage.product}`,
    text: `${usage.product} used ${usage.used}, above its Platform Soft Limit of ${usage.softLimit ?? 'none'}. No arrival is refused for this.`,
  };
}
