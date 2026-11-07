/**
 * Grouping Input projection -- the part of a Normalized Event that
 * Fingerprint derivation reads (src/domain/grouping). The exception chain
 * and frames keep the order the SDK sent them.
 */

import type { GroupingException, GroupingInput, GroupingMechanism } from '../grouping/grouping-input.js';
import type { Exception, Mechanism, NormalizedEvent } from './normalized-event.js';

// --- helpers ---

function groupingMechanism(mechanism: Mechanism): GroupingMechanism {
  return mechanism.synthetic === undefined ? { type: mechanism.type } : { type: mechanism.type, synthetic: mechanism.synthetic };
}

function groupingException(exception: Exception): GroupingException {
  const base = { type: exception.type, value: exception.value, frames: exception.frames };
  return exception.mechanism === undefined ? base : { ...base, mechanism: groupingMechanism(exception.mechanism) };
}

// --- exports ---

export function toGroupingInput(event: NormalizedEvent): GroupingInput {
  return {
    exceptions: event.exceptions.map(groupingException),
    stacktrace: event.stacktrace,
    message: event.message,
    platform: event.platform,
    fingerprint: event.fingerprint,
    logger: event.logger,
    level: event.level,
    tags: event.tags,
  };
}
