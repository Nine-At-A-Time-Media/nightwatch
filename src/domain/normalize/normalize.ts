/**
 * Normalization -- turns one SDK event, as parsed JSON, into a Normalized
 * Event (design Processing, Normalization and Clock drift). Invalid parts
 * are removed and recorded on the event; only an event that is not an
 * object, has no usable event id, or is older than Event Retention is
 * refused. The caller supplies receipt time, the sender's sent-at stamp,
 * the Clock-drift clamp, Event Retention and the tag value bound.
 */

import { refusal, type Refusal } from '../refusal.js';
import { correctTime, isTooOld, type ClockDrift } from './clock-drift.js';
import type { Breadcrumb, EventError, NormalizedEvent } from './normalized-event.js';
import {
  isObject,
  readBreadcrumbs,
  readContexts,
  readDebugImages,
  readEventId,
  readExceptions,
  readExtra,
  readFingerprint,
  readLevel,
  readMessage,
  readRequest,
  readSdk,
  readStacktrace,
  readTags,
  readText,
  readTime,
  readUser,
} from './parts.js';

export type { NormalizedEvent } from './normalized-event.js';

export type NormalizeContext = {
  readonly receivedAt: Date;
  /** The sender's own stamp of when it sent the arrival, if it gave one. */
  readonly sentAt?: Date;
  readonly clampFutureMs: number;
  readonly retentionMs: number;
  readonly projectId: string;
  /** The event id the arrival carried outside the event, used when the event has none. */
  readonly eventId?: string;
  /** Tags with a longer value are dropped. */
  readonly maxTagValueLength: number;
};

const DEFAULT_LEVEL = 'error';
const DEFAULT_PLATFORM = 'other';

// --- helpers ---

function clockDrift(context: NormalizeContext): ClockDrift {
  return {
    receivedAt: context.receivedAt.getTime(),
    sentAt: context.sentAt?.getTime() ?? null,
    clampFutureMs: context.clampFutureMs,
    retentionMs: context.retentionMs,
  };
}

function correctedBreadcrumb(breadcrumb: Breadcrumb, drift: ClockDrift): Breadcrumb {
  return breadcrumb.timestamp === null ? breadcrumb : { ...breadcrumb, timestamp: correctTime(breadcrumb.timestamp, drift).time };
}

function fallbackEventId(context: NormalizeContext): string | undefined {
  return context.eventId === undefined ? undefined : readEventId(context.eventId, 'event_id').value;
}

// --- exports ---

export function normalizeEvent(raw: unknown, context: NormalizeContext): NormalizedEvent | Refusal {
  if (!isObject(raw)) return refusal('malformed-event');
  const id = readEventId(raw['event_id'], 'event_id');
  const eventId = id.value ?? fallbackEventId(context);
  if (eventId === undefined) return refusal('missing-event-id');

  const drift = clockDrift(context);
  const sentTime = readTime(raw['timestamp'], 'timestamp');
  const corrected = sentTime.value === undefined ? { time: drift.receivedAt, clamped: false } : correctTime(sentTime.value, drift);
  if (isTooOld(corrected.time, drift)) return refusal('event-too-old');
  const clamped: readonly EventError[] = corrected.clamped ? [{ path: 'timestamp', reason: 'clamped' }] : [];

  const level = readLevel(raw['level'], 'level');
  const platform = readText(raw['platform'], 'platform');
  const message = readMessage(raw);
  const exceptions = readExceptions(raw['exception'], 'exception');
  const stacktrace = readStacktrace(raw['stacktrace'], 'stacktrace');
  const release = readText(raw['release'], 'release');
  const environment = readText(raw['environment'], 'environment');
  const user = readUser(raw['user'], 'user');
  const tags = readTags(raw['tags'], 'tags', context.maxTagValueLength);
  const contexts = readContexts(raw['contexts'], 'contexts');
  const request = readRequest(raw['request'], 'request');
  const sdk = readSdk(raw['sdk'], 'sdk');
  const fingerprint = readFingerprint(raw['fingerprint'], 'fingerprint');
  const breadcrumbs = readBreadcrumbs(raw['breadcrumbs'], 'breadcrumbs');
  const extra = readExtra(raw['extra'], 'extra');
  const serverName = readText(raw['server_name'], 'server_name');
  const transaction = readText(raw['transaction'], 'transaction');
  const logger = readText(raw['logger'], 'logger');
  const debugImages = readDebugImages(raw['debug_meta'], 'debug_meta');

  const parts = [id, sentTime, level, platform, message, exceptions, stacktrace, release, environment, user, tags, contexts, request];
  const moreParts = [sdk, fingerprint, breadcrumbs, extra, serverName, transaction, logger, debugImages];
  return {
    eventId,
    projectId: context.projectId,
    timestamp: corrected.time,
    receivedAt: drift.receivedAt,
    level: level.value ?? DEFAULT_LEVEL,
    platform: platform.value ?? DEFAULT_PLATFORM,
    message: message.value,
    exceptions: exceptions.value,
    stacktrace: stacktrace.value,
    release: release.value,
    environment: environment.value,
    user: user.value,
    tags: tags.value,
    contexts: contexts.value,
    request: request.value,
    sdk: sdk.value,
    fingerprint: fingerprint.value,
    breadcrumbs: breadcrumbs.value.map((breadcrumb) => correctedBreadcrumb(breadcrumb, drift)),
    extra: extra.value,
    serverName: serverName.value,
    transaction: transaction.value,
    logger: logger.value,
    debugImages: debugImages.value,
    errors: [...[...parts, ...moreParts].flatMap((part) => part.errors), ...clamped],
  };
}
