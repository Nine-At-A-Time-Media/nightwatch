/**
 * Event part readers -- validate one part of an SDK event as sent and give
 * back its normalized value with the removals it made. A reader never
 * throws: an invalid part is left out and recorded by its path in the event
 * as sent. zod carries the leaf schemas at this input boundary.
 */

import { z } from 'zod';
import type { Level } from '../issue/priority.js';
import type {
  Breadcrumb,
  DebugImage,
  EventError,
  EventErrorReason,
  Exception,
  Frame,
  JsonObject,
  Mechanism,
  Message,
  Request,
  Sdk,
  User,
} from './normalized-event.js';

export type Parsed<T> = { readonly value: T; readonly errors: readonly EventError[] };

type Raw = Readonly<Record<string, unknown>>;

/** For each field of T: the key it has in the event as sent, and the schema of its value. */
type FieldSpec<T> = { readonly [K in keyof T]-?: readonly [string, z.ZodType<NonNullable<T[K]>>] };

const MS_PER_SECOND = 1000;
const LEVELS = ['fatal', 'error', 'warning', 'info', 'debug'] as const satisfies readonly Level[];

const text = z.string();
const flag = z.boolean();
const position = z.number().int().nonnegative();
const scalarText = z.union([z.string(), z.number(), z.boolean()]).transform(String);
const jsonObject: z.ZodType<JsonObject> = z.record(z.string(), z.json());
const level = z.enum(LEVELS);
const eventId = z
  .string()
  .transform((id) => id.replaceAll('-', '').toLowerCase())
  .pipe(z.string().regex(/^[0-9a-f]{32}$/));
const isoTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)))
  .transform((value) => Date.parse(value));
const secondsTime = z
  .number()
  .finite()
  .transform((seconds) => Math.round(seconds * MS_PER_SECOND));
const time = z.union([secondsTime, isoTime]);
const fingerprint = z.array(z.union([z.string(), z.number()]).transform(String));

const FRAME_FIELDS: FieldSpec<Frame> = {
  module: ['module', text],
  filename: ['filename', text],
  absPath: ['abs_path', text],
  function: ['function', text],
  inApp: ['in_app', flag],
  lineno: ['lineno', position],
  colno: ['colno', position],
  contextLine: ['context_line', text],
};
const MECHANISM_FIELDS: FieldSpec<Omit<Mechanism, 'type'>> = { handled: ['handled', flag], synthetic: ['synthetic', flag] };
const USER_FIELDS: FieldSpec<User> = {
  id: ['id', scalarText],
  email: ['email', text],
  ipAddress: ['ip_address', text],
  username: ['username', text],
};
const BREADCRUMB_FIELDS: FieldSpec<Omit<Breadcrumb, 'timestamp'>> = {
  type: ['type', text],
  category: ['category', text],
  message: ['message', text],
  level: ['level', text],
  data: ['data', jsonObject],
};
const DEBUG_IMAGE_FIELDS: FieldSpec<Omit<DebugImage, 'type'>> = { debugId: ['debug_id', text], codeFile: ['code_file', text] };

// --- predicates ---

export function isObject(raw: unknown): raw is Raw {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function isAbsent(raw: unknown): boolean {
  return raw === undefined || raw === null;
}

// --- helpers: results ---

function ok<T>(value: T): Parsed<T> {
  return { value, errors: [] };
}

function failed<T>(value: T, path: string, reason: EventErrorReason = 'invalid'): Parsed<T> {
  return { value, errors: [{ path, reason }] };
}

function errorsOf(parts: readonly Parsed<unknown>[]): readonly EventError[] {
  return parts.flatMap((part) => part.errors);
}

function child(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

// --- helpers: leaves ---

function readLeaf<T>(schema: z.ZodType<T>, raw: unknown, path: string): Parsed<T | undefined> {
  if (isAbsent(raw)) return ok(undefined);
  const result = schema.safeParse(raw);
  return result.success ? ok(result.data) : failed(undefined, path);
}

function readFields<T>(raw: Raw, path: string, spec: FieldSpec<T>): Parsed<T> {
  const parts = Object.entries<readonly [string, z.ZodType]>(spec).map(([field, [key, schema]]) => ({
    field,
    part: readLeaf(schema, raw[key], child(path, key)),
  }));
  const value = Object.fromEntries(parts.filter(({ part }) => part.value !== undefined).map(({ field, part }) => [field, part.value]));
  return { value: value as T, errors: errorsOf(parts.map(({ part }) => part)) };
}

function readObject(raw: unknown, path: string): Parsed<Raw | null> {
  if (isAbsent(raw)) return ok(null);
  return isObject(raw) ? ok(raw) : failed(null, path);
}

/** A list sent either bare or wrapped as `{values: [...]}`; gives the list and the path its items sit under. */
function readList(raw: unknown, path: string): Parsed<{ readonly items: readonly unknown[]; readonly path: string }> {
  const empty = { items: [], path };
  if (isAbsent(raw)) return ok(empty);
  if (Array.isArray(raw)) return ok({ items: raw, path });
  if (isObject(raw) && Array.isArray(raw['values'])) return ok({ items: raw['values'], path: child(path, 'values') });
  return failed(empty, path);
}

function readItems<T>(raw: unknown, path: string, readItem: (item: Raw, path: string) => Parsed<T | null>): Parsed<readonly T[]> {
  const list = readList(raw, path);
  const parts = list.value.items.map((item, index) => {
    const itemPath = child(list.value.path, index);
    return isObject(item) ? readItem(item, itemPath) : failed(null, itemPath);
  });
  return {
    value: parts.map((part) => part.value).filter((value): value is T => value !== null),
    errors: [...list.errors, ...errorsOf(parts)],
  };
}

/** Key/value pairs sent as an object or as a list of `[key, value]` pairs. */
function readPairs(raw: unknown, path: string): Parsed<readonly (readonly [string, unknown, string])[]> {
  if (isAbsent(raw)) return ok([]);
  if (isObject(raw)) return ok(Object.entries(raw).map(([key, value]) => [key, value, child(path, key)] as const));
  if (!Array.isArray(raw)) return failed([], path);
  const parts = raw.map((pair: unknown, index) =>
    Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string'
      ? ok([[pair[0], pair[1] as unknown, child(path, String(pair[0]))] as const])
      : failed([], child(path, index)),
  );
  return { value: parts.flatMap((part) => part.value), errors: errorsOf(parts) };
}

function readStringMap(raw: unknown, path: string, maxLength: number): Parsed<Readonly<Record<string, string>>> {
  const pairs = readPairs(raw, path);
  const parts = pairs.value.map(([key, value, valuePath]) => {
    const leaf = readLeaf(scalarText, value, valuePath);
    if (leaf.value === undefined) return { ...leaf, value: null };
    return leaf.value.length > maxLength ? failed(null, valuePath, 'too-long') : ok([key, leaf.value] as const);
  });
  const entries = parts.map((part) => part.value).filter((entry) => entry !== null);
  return { value: Object.fromEntries(entries), errors: [...pairs.errors, ...errorsOf(parts)] };
}

// --- readers: frames and exceptions ---

function readFrame(raw: Raw, path: string): Parsed<Frame> {
  return readFields(raw, path, FRAME_FIELDS);
}

function readFrames(raw: unknown, path: string): Parsed<readonly Frame[] | null> {
  const stacktrace = readObject(raw, path);
  if (stacktrace.value === null) return { value: null, errors: stacktrace.errors };
  return readItems(stacktrace.value['frames'], child(path, 'frames'), readFrame);
}

function readMechanism(raw: unknown, path: string): Parsed<Mechanism | undefined> {
  const mechanism = readObject(raw, path);
  if (mechanism.value === null) return { value: undefined, errors: mechanism.errors };
  const type = mechanism.value['type'];
  if (typeof type !== 'string') return failed(undefined, path);
  const rest = readFields(mechanism.value, path, MECHANISM_FIELDS);
  return { value: { type, ...rest.value }, errors: rest.errors };
}

function readException(raw: Raw, path: string): Parsed<Exception> {
  const type = readLeaf(text, raw['type'], child(path, 'type'));
  const value = readLeaf(text, raw['value'], child(path, 'value'));
  const module = readLeaf(text, raw['module'], child(path, 'module'));
  const mechanism = readMechanism(raw['mechanism'], child(path, 'mechanism'));
  const frames = readFrames(raw['stacktrace'], child(path, 'stacktrace'));
  return {
    value: {
      type: type.value ?? null,
      value: value.value ?? null,
      ...(module.value === undefined ? {} : { module: module.value }),
      ...(mechanism.value === undefined ? {} : { mechanism: mechanism.value }),
      frames: frames.value ?? [],
    },
    errors: errorsOf([type, value, module, mechanism, frames]),
  };
}

// --- readers: breadcrumbs and debug images ---

function readBreadcrumb(raw: Raw, path: string): Parsed<Breadcrumb> {
  const timestamp = readLeaf(time, raw['timestamp'], child(path, 'timestamp'));
  const rest = readFields(raw, path, BREADCRUMB_FIELDS);
  return { value: { timestamp: timestamp.value ?? null, ...rest.value }, errors: [...timestamp.errors, ...rest.errors] };
}

function readDebugImage(raw: Raw, path: string): Parsed<DebugImage | null> {
  const type = raw['type'];
  if (typeof type !== 'string') return failed(null, path);
  const rest = readFields(raw, path, DEBUG_IMAGE_FIELDS);
  return { value: { type, ...rest.value }, errors: rest.errors };
}

// --- readers: message ---

function paramText(param: unknown): string {
  return typeof param === 'string' ? param : JSON.stringify(param);
}

function readLogEntry(
  raw: unknown,
  path: string,
): Parsed<{ readonly message?: string; readonly formatted?: string; readonly params: readonly string[] }> {
  if (typeof raw === 'string') return ok({ formatted: raw, params: [] });
  const entry = readObject(raw, path);
  if (entry.value === null) return { value: { params: [] }, errors: entry.errors };
  const message = readLeaf(text, entry.value['message'], child(path, 'message'));
  const formatted = readLeaf(text, entry.value['formatted'], child(path, 'formatted'));
  const params = readLeaf(z.array(z.unknown()), entry.value['params'], child(path, 'params'));
  return {
    value: {
      ...(message.value === undefined ? {} : { message: message.value }),
      ...(formatted.value === undefined ? {} : { formatted: formatted.value }),
      params: (params.value ?? []).map(paramText),
    },
    errors: errorsOf([message, formatted, params]),
  };
}

// --- exports ---

export function readEventId(raw: unknown, path: string): Parsed<string | undefined> {
  return readLeaf(eventId, raw, path);
}

export function readTime(raw: unknown, path: string): Parsed<number | undefined> {
  return readLeaf(time, raw, path);
}

export function readText(raw: unknown, path: string): Parsed<string | null> {
  const leaf = readLeaf(text, raw, path);
  return { value: leaf.value ?? null, errors: leaf.errors };
}

export function readLevel(raw: unknown, path: string): Parsed<Level | undefined> {
  return readLeaf(level, raw, path);
}

export function readFingerprint(raw: unknown, path: string): Parsed<readonly string[] | null> {
  const leaf = readLeaf(fingerprint, raw, path);
  return { value: leaf.value ?? null, errors: leaf.errors };
}

export function readMessage(event: Raw): Parsed<Message | null> {
  const logentry = readLogEntry(event['logentry'], 'logentry');
  const message = readLogEntry(event['message'], 'message');
  const template = logentry.value.message ?? message.value.message ?? null;
  const formatted = logentry.value.formatted ?? message.value.formatted ?? template;
  const params = logentry.value.params.length > 0 ? logentry.value.params : message.value.params;
  const errors = errorsOf([logentry, message]);
  return formatted === null && template === null ? { value: null, errors } : { value: { formatted, template, params }, errors };
}

export function readExceptions(raw: unknown, path: string): Parsed<readonly Exception[]> {
  return readItems(raw, path, readException);
}

export function readStacktrace(raw: unknown, path: string): Parsed<readonly Frame[] | null> {
  return readFrames(raw, path);
}

export function readUser(raw: unknown, path: string): Parsed<User | null> {
  const user = readObject(raw, path);
  if (user.value === null) return { value: null, errors: user.errors };
  return readFields(user.value, path, USER_FIELDS);
}

export function readTags(raw: unknown, path: string, maxValueLength: number): Parsed<Readonly<Record<string, string>>> {
  return readStringMap(raw, path, maxValueLength);
}

export function readContexts(raw: unknown, path: string): Parsed<Readonly<Record<string, JsonObject>>> {
  const contexts = readObject(raw, path);
  if (contexts.value === null) return { value: {}, errors: contexts.errors };
  const parts = Object.entries(contexts.value).map(([key, value]) => {
    const leaf = readLeaf(jsonObject, value, child(path, key));
    return { value: leaf.value === undefined ? null : ([key, leaf.value] as const), errors: leaf.errors };
  });
  return { value: Object.fromEntries(parts.map((part) => part.value).filter((entry) => entry !== null)), errors: errorsOf(parts) };
}

export function readRequest(raw: unknown, path: string): Parsed<Request | null> {
  const request = readObject(raw, path);
  if (request.value === null) return { value: null, errors: request.errors };
  const url = readLeaf(text, request.value['url'], child(path, 'url'));
  const method = readLeaf(text, request.value['method'], child(path, 'method'));
  const headers = readStringMap(request.value['headers'], child(path, 'headers'), Number.POSITIVE_INFINITY);
  return {
    value: {
      ...(url.value === undefined ? {} : { url: url.value }),
      ...(method.value === undefined ? {} : { method: method.value }),
      headers: headers.value,
    },
    errors: errorsOf([url, method, headers]),
  };
}

export function readSdk(raw: unknown, path: string): Parsed<Sdk | null> {
  const sdk = readObject(raw, path);
  if (sdk.value === null) return { value: null, errors: sdk.errors };
  const { name, version } = sdk.value;
  return typeof name === 'string' && typeof version === 'string' ? ok({ name, version }) : failed(null, path);
}

/** Breadcrumbs with their times as sent; clock drift is corrected by the caller. */
export function readBreadcrumbs(raw: unknown, path: string): Parsed<readonly Breadcrumb[]> {
  return readItems(raw, path, readBreadcrumb);
}

export function readExtra(raw: unknown, path: string): Parsed<JsonObject> {
  const leaf = readLeaf(jsonObject, raw, path);
  return { value: leaf.value ?? {}, errors: leaf.errors };
}

export function readDebugImages(raw: unknown, path: string): Parsed<readonly DebugImage[]> {
  const meta = readObject(raw, path);
  if (meta.value === null) return { value: [], errors: meta.errors };
  return readItems(meta.value['images'], child(path, 'images'), readDebugImage);
}
