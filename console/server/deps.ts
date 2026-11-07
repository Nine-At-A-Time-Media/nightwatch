/**
 * The console Worker's wiring: the one place that names the concrete adapter
 * behind each port the console's use cases take, and reads the console
 * settings from the Worker's vars. Routes build these deps once per request
 * from the Cloudflare bindings and hand them to one handler.
 *
 * The local stage trusts only the development issuer (dev/local-issuer): its
 * keys are fetched over the LOCAL_ISSUER service binding, and the
 * CF_Authorization cookie the dev sign-in sets is read as an Assertion. Any
 * other stage reads each trusted issuer's keys from its own Access team
 * domain over HTTPS, reads the Assertion from the Access header only, and
 * refuses to start while LOCAL_ISSUER is bound.
 */

import { AccessSignInVerifier } from '#nightwatch/adapters/access/access-sign-in-verifier.js';
import { remoteKeySource, type KeySource } from '#nightwatch/adapters/access/key-source.js';
import { D1ControlStore } from '#nightwatch/adapters/d1/d1-control-store.js';
import { DurableProjectClient, type ProjectNamespace } from '#nightwatch/adapters/do/durable-project-client.js';
import { DurableQuotaGate, type QuotaCounter } from '#nightwatch/adapters/do/durable-quota-gate.js';
import { SendEmailMailer } from '#nightwatch/adapters/email/send-email-mailer.js';
import { GitHubTracker } from '#nightwatch/adapters/github/github-tracker.js';
import { MemoryTokenCache } from '#nightwatch/adapters/github/token-cache.js';
import { KvProjectConfigSource } from '#nightwatch/adapters/kv/kv-project-config-source.js';
import { QueueEffectQueue } from '#nightwatch/adapters/queues/queue-effect-queue.js';
import { R2BlobStore } from '#nightwatch/adapters/r2/r2-blob-store.js';
import { AbstainingSpamJudge } from '#nightwatch/adapters/rules/abstaining-spam-judge.js';
import { RandomIds } from '#nightwatch/adapters/runtime/random-ids.js';
import { SystemClock } from '#nightwatch/adapters/runtime/system-clock.js';
import type { ReportSettings } from '#nightwatch/domain/report/filing.js';
import type { TrackerSettings } from '#nightwatch/domain/tracker/settings.js';
import type { Tracker } from '#nightwatch/ports/tracker.js';
import type { DevSignInDeps } from './handlers/dev.js';
import type { AssertionSources } from './handlers/http.js';

/** The console's bindings; GITHUB_APP_PRIVATE_KEY is a Worker secret, absent unless set. */
export type ConsoleBindings = Omit<ConsoleEnv, 'LOCAL_ISSUER'> & {
  readonly LOCAL_ISSUER?: Fetcher;
  readonly GITHUB_APP_PRIVATE_KEY?: string;
};

const LOCAL_STAGE = 'local';

// --- settings ---

function positive({ name, value }: { name: string; value: unknown }): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`console setting ${name} must be a positive number, got ${String(value)}`);
  return number;
}

function reportSettings(env: ConsoleBindings): ReportSettings {
  return {
    followUpBaseUrl: env.FOLLOW_UP_BASE_URL,
    maxMessageLength: positive({ name: 'MAX_MESSAGE_LENGTH', value: env.MAX_MESSAGE_LENGTH }),
    spamThreshold: positive({ name: 'SPAM_THRESHOLD', value: env.SPAM_THRESHOLD }),
  };
}

function trackerSettings(env: ConsoleBindings): TrackerSettings {
  return {
    consoleBaseUrl: env.CONSOLE_BASE_URL,
    labels: env.TRACKER_LABELS.split(',')
      .map((label) => label.trim())
      .filter((label) => label !== ''),
    appActor: env.GITHUB_APP_ACTOR,
    shareMarker: env.SHARE_MARKER,
    maxRefusals: positive({ name: 'MAX_REFUSALS', value: env.MAX_REFUSALS }),
  };
}

// --- wiring ---

/** The Cloudflare bindings Nitro's cloudflare-module preset puts on each request's context. */
export function bindingsOf(context: unknown): ConsoleBindings {
  const env = (context as { cloudflare?: { env?: ConsoleBindings } }).cloudflare?.env;
  if (!env) throw new Error('no Cloudflare bindings on the request: build with NITRO_PRESET=cloudflare-module and run under wrangler');
  return env;
}

/** Where issuer keys come from, and where the Assertion may be read from, by stage. */
function signInSources(env: ConsoleBindings): { keys: KeySource; assertions: AssertionSources } {
  const issuer = env.LOCAL_ISSUER;
  if (env.STAGE !== LOCAL_STAGE) {
    if (issuer) throw new Error(`stage ${env.STAGE} must not bind LOCAL_ISSUER`);
    return { keys: remoteKeySource(), assertions: { cookie: false } };
  }
  if (!issuer) throw new Error('the local stage needs the LOCAL_ISSUER service binding');
  return { keys: remoteKeySource({ fetch: (url, options) => issuer.fetch(url, options) }), assertions: { cookie: true } };
}

function trackerOf(env: ConsoleBindings, clock: SystemClock): Tracker | null {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return null;
  return new GitHubTracker({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    fetch,
    tokens: new MemoryTokenCache(),
    clock,
  });
}

export function consoleDeps(env: ConsoleBindings) {
  const clock = new SystemClock();
  const { keys, assertions } = signInSources(env);
  const config = new KvProjectConfigSource(env.PROJECT_CONFIG);
  // Cross-script Durable Object bindings carry no class type; the stubs offer the RPC surfaces named here.
  const projectNamespace = env.PROJECT as unknown as ProjectNamespace;
  const quotaNamespace = env.QUOTA as unknown as { getByName(name: string): QuotaCounter };
  return {
    assertions,
    verifier: new AccessSignInVerifier({ keys, clock: { now: () => new Date(clock.now()) } }),
    control: new D1ControlStore(env.CONTROL),
    projects: new DurableProjectClient({ namespace: projectNamespace }),
    quota: new DurableQuotaGate({ limits: config, counterFor: (projectId) => quotaNamespace.getByName(projectId), clock }),
    blobs: new R2BlobStore(env.BLOBS),
    spam: new AbstainingSpamJudge(),
    effects: new QueueEffectQueue(env.EFFECTS),
    mailer: new SendEmailMailer({ binding: env.MAIL, from: env.MAIL_FROM }),
    ids: new RandomIds(),
    clock,
    settings: reportSettings(env),
    tracker: trackerOf(env, clock),
    trackerSettings: trackerSettings(env),
  };
}

export type ConsoleDeps = ReturnType<typeof consoleDeps>;

/** openExternalIssue's deps: the tracker settings are its `settings`. */
export function trackerDeps(deps: ConsoleDeps) {
  return { ...deps, settings: deps.trackerSettings };
}

/** The dev sign-in helper's deps: the issuer on the local stage only. */
export function devSignInDeps(env: ConsoleBindings): DevSignInDeps {
  return { issuer: env.STAGE === LOCAL_STAGE ? (env.LOCAL_ISSUER ?? null) : null, audience: env.LOCAL_AUDIENCE };
}
