/**
 * The github Worker's wiring: the one place that names the concrete adapter
 * behind each port applyTrackerEvent and applyCommits take, and reads the
 * Tracker settings from the Worker's vars and the webhook secret from its
 * environment. Only the local stage has its adapters; any other stage is
 * refused rather than silently given a stand-in.
 */

import type { ApplyCommitsDeps } from '../../application/tracker/apply-commits.js';
import type { ApplyTrackerEventDeps } from '../../application/tracker/apply-tracker-event.js';
import { D1ControlStore } from '../../adapters/d1/d1-control-store.js';
import { DurableProjectClient, type ProjectNamespace } from '../../adapters/do/durable-project-client.js';
import { SystemClock } from '../../adapters/runtime/system-clock.js';
import { trackerSettings } from '../shared/github.js';
import { isLocalStage, secretSetting } from '../shared/settings.js';

/** The Worker's bindings with its secret, and ProjectDO's namespace as the client uses it. */
export type GitHubWorkerBindings = Omit<GitHubWorkerEnv, 'PROJECT'> & {
  readonly PROJECT: ProjectNamespace;
  /** Worker secret: the GitHub App's webhook secret. */
  readonly GITHUB_WEBHOOK_SECRET?: string;
};

export type GitHubRuntime = {
  readonly webhookSecret: string;
  readonly trackerEvents: ApplyTrackerEventDeps;
  readonly commits: ApplyCommitsDeps;
};

// --- wiring ---

export function isGitHubStageReady(env: GitHubWorkerBindings): boolean {
  return isLocalStage(env.STAGE);
}

export function githubRuntime(env: GitHubWorkerBindings): GitHubRuntime {
  const clock = new SystemClock();
  const control = new D1ControlStore(env.CONTROL);
  const projects = new DurableProjectClient({ namespace: env.PROJECT });
  return {
    webhookSecret: secretSetting({ name: 'GITHUB_WEBHOOK_SECRET', value: env.GITHUB_WEBHOOK_SECRET }),
    trackerEvents: { control, projects, clock, settings: trackerSettings(env) },
    commits: { control, projects, clock },
  };
}
