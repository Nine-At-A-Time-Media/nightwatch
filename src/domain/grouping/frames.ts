/**
 * Frame normalization -- reduces a frame's file name, module and function
 * name to the parts that stay the same from one build and one run to the
 * next. Directories, query strings, build hashes, versions, memory
 * addresses, offsets and compiler-generated counters are removed.
 */

const ANONYMOUS_FUNCTIONS = new Set(['', '?', '<anonymous>', 'anonymous', '<unknown>', '{anonymous}']);
const HASH_SEPARATORS = ['-', '_', '~'];
const MIN_HEX_HASH_LENGTH = 6;
const MIN_MIXED_HASH_LENGTH = 8;

const VERSION_IN_NAME = /[-_@]v?\d+(?:\.\d+)+(?=[.-]|$)/g;
const JVM_LAMBDA_CLASS = /\$\$Lambda\$\d+(?:\/(?:0x)?[0-9a-f]+)?/gi;
const JVM_LAMBDA_METHOD = /lambda\$([^$]+)\$\d+/g;
const ADDRESS = /\s*\(?0x[0-9a-f]+\)?/gi;
const TRAILING_OFFSET = /\s*\+\s*(?:0x[0-9a-f]+|\d+)$/i;
const ALIAS_SUFFIX = /\s*\[as [^\]]*\]$/;
const RUST_CLOSURE = /\{closure#\d+\}/g;
const BLOCK_INVOKE = /_block_invoke_\d+/g;
const GO_FUNC_LITERAL = /\.func\d+(?:\.\d+)*/g;
const DOTNET_CLOSURE = /b__\d+(?:_\d+)*/g;

// --- predicates ---

function isHexHash(segment: string): boolean {
  return segment.length >= MIN_HEX_HASH_LENGTH && /^[0-9a-f]+$/i.test(segment) && /\d/.test(segment);
}

function isMixedCaseHash(segment: string): boolean {
  return (
    segment.length >= MIN_MIXED_HASH_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(segment) &&
    /\d/.test(segment) &&
    /[a-z]/.test(segment) &&
    /[A-Z]/.test(segment)
  );
}

function isHashLike(segment: string): boolean {
  return isHexHash(segment) || isMixedCaseHash(segment);
}

// --- helpers ---

function stripHashSuffix(segment: string): string {
  for (let i = 1; i < segment.length; i++) {
    if (HASH_SEPARATORS.includes(segment.charAt(i)) && isHashLike(segment.slice(i + 1))) return segment.slice(0, i);
  }
  return segment;
}

function basename(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] ?? '';
  return withoutQuery.split(/[\\/]/).pop() ?? '';
}

function stripJvmLambdas(name: string): string {
  return name.replace(JVM_LAMBDA_CLASS, () => '$$Lambda').replace(JVM_LAMBDA_METHOD, (_match, method: string) => `lambda$${method}$`);
}

// --- exports ---

export function normalizeFilename(path: string): string {
  const [first = '', ...rest] = basename(path).replace(VERSION_IN_NAME, '').split('.');
  const extension = rest.pop();
  const kept = [stripHashSuffix(first), ...rest.filter((segment) => !isHashLike(segment))];
  return extension === undefined ? kept.join('.') : [...kept, extension].join('.');
}

export function normalizeModule(module: string): string {
  return stripJvmLambdas(module).replace(ADDRESS, '').trim();
}

/** The stable part of a function name, or null when the function is anonymous. */
export function normalizeFunction(name: string): string | null {
  const normalized = stripJvmLambdas(name.trim().replace(ALIAS_SUFFIX, '').replace(TRAILING_OFFSET, ''))
    .replace(RUST_CLOSURE, '{closure}')
    .replace(BLOCK_INVOKE, '_block_invoke')
    .replace(GO_FUNC_LITERAL, '.func')
    .replace(DOTNET_CLOSURE, 'b__')
    .replace(ADDRESS, '')
    .trim();
  return ANONYMOUS_FUNCTIONS.has(normalized) ? null : normalized;
}
