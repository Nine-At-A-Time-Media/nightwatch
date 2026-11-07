/**
 * The GitHub wiring the notifier and github Workers share: the Tracker
 * settings both read from their vars, and the GitHub App adapters behind
 * Tracker and CodeHost (architecture Mechanism, Code and GitHub). The App
 * key is a Worker secret; installation tokens are cached in KV.
 *
 * On the local stage every GitHub call goes to the local fake GitHub over
 * the GITHUB_API service binding, so nothing reaches github.com; the binding
 * keeps the API's own URLs, which the fake answers. Any other stage calls
 * GitHub's API with `fetch`.
 */

import { GitHubCodeHost } from '../../adapters/github/github-code-host.js';
import type { GitHubAppOptions } from '../../adapters/github/github-app.js';
import { GitHubTracker } from '../../adapters/github/github-tracker.js';
import { KvTokenCache } from '../../adapters/kv/kv-token-cache.js';
import type { TrackerSettings } from '../../domain/tracker/settings.js';
import type { Clock } from '../../ports/clock.js';
import { isLocalStage, listSetting, positiveSetting, secretSetting, textSetting } from './settings.js';

/** The bindings, vars and secret the GitHub wiring reads. */
export type GitHubBindings = {
  readonly STAGE: string;
  readonly CONSOLE_BASE_URL: string;
  readonly TRACKER_LABELS: string;
  readonly GITHUB_APP_ACTOR: string;
  readonly SHARE_MARKER: string;
  readonly TRACKER_MAX_REFUSALS: number | string;
};

export type GitHubAppBindings = GitHubBindings & {
  readonly GITHUB_APP_ID: string;
  /** Worker secret: the App key as a PKCS#8 PEM. */
  readonly GITHUB_APP_PRIVATE_KEY?: string;
  readonly GITHUB_TOKENS: KVNamespace;
  /** Local stage only: the fake GitHub. */
  readonly GITHUB_API?: Fetcher;
};

// --- settings ---

export function trackerSettings(env: GitHubBindings): TrackerSettings {
  return {
    consoleBaseUrl: textSetting({ name: 'CONSOLE_BASE_URL', value: env.CONSOLE_BASE_URL }),
    labels: listSetting({ name: 'TRACKER_LABELS', value: env.TRACKER_LABELS }),
    appActor: textSetting({ name: 'GITHUB_APP_ACTOR', value: env.GITHUB_APP_ACTOR }),
    shareMarker: textSetting({ name: 'SHARE_MARKER', value: env.SHARE_MARKER }),
    maxRefusals: positiveSetting({ name: 'TRACKER_MAX_REFUSALS', value: env.TRACKER_MAX_REFUSALS }),
  };
}

// --- wiring ---

function githubFetch(env: GitHubAppBindings): typeof fetch {
  if (!isLocalStage(env.STAGE)) return (input, init) => fetch(input, init);
  const api = env.GITHUB_API;
  if (api === undefined) throw new Error('local stage needs the GITHUB_API binding to the fake GitHub');
  return (input, init) => api.fetch(input, init);
}

export function githubAppOptions(env: GitHubAppBindings, clock: Clock): GitHubAppOptions {
  return {
    appId: textSetting({ name: 'GITHUB_APP_ID', value: env.GITHUB_APP_ID }),
    privateKey: secretSetting({ name: 'GITHUB_APP_PRIVATE_KEY', value: env.GITHUB_APP_PRIVATE_KEY }),
    fetch: githubFetch(env),
    tokens: new KvTokenCache({ kv: env.GITHUB_TOKENS, now: () => clock.now() }),
    clock,
  };
}

export function githubTracker(env: GitHubAppBindings, clock: Clock): GitHubTracker {
  return new GitHubTracker(githubAppOptions(env, clock));
}

export function githubCodeHost(env: GitHubAppBindings, clock: Clock): GitHubCodeHost {
  return new GitHubCodeHost(githubAppOptions(env, clock));
}
