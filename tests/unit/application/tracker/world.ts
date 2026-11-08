// Shared builders for the Code and GitHub use-case tests: the Reports world
// (one Organization, one Project, Mia as a Member) with a connected
// Repository, a tracker account mapped to Mia, a Project slug for Short Ids,
// and a FakeTracker. The Project's state is reached through the
// FakeProjectClient, as the github runtime reaches it.
import { notifyReporters } from '../../../../src/application/reports/notify-reporters.js';
import type { IssueChange, IssueState, IssueTransition } from '../../../../src/domain/issue/state.js';
import { isRefusal, type Refusal } from '../../../../src/domain/refusal.js';
import type { TrackerSettings } from '../../../../src/domain/tracker/settings.js';
import { FakeTracker } from '../../../_fakes/fake-tracker.js';
import { summary } from '../issues/world.js';
import { member, ORG, PROJECT, T0, world as reportsWorld } from '../reports/world.js';

export { ADA, BOB, DAY, HOUR, MINUTE, member, ORG, PROJECT, T0, filed } from '../reports/world.js';

export const REPOSITORY = 'acme/web';
export const APP = 'nightwatch-app[bot]';
export const MIA_LOGIN = 'mia-gh';
export const SLUG = 'WEB';

export const TRACKER_SETTINGS: TrackerSettings = {
  consoleBaseUrl: 'https://console.example',
  labels: ['nightwatch'],
  appActor: APP,
  shareMarker: '/reporter',
  maxRefusals: 3,
};

export function world() {
  const w = reportsWorld();
  w.control.connectRepository(ORG, REPOSITORY);
  w.control.mapTrackerAccount(ORG, MIA_LOGIN, member);
  w.control.addProjectSlug(PROJECT, SLUG);
  const tracker = new FakeTracker();
  return { ...w, tracker, trackerSettings: TRACKER_SETTINGS };
}

export type World = ReturnType<typeof world>;

/** Deps for the github runtime's use cases. */
export function githubDeps(w: World) {
  return { tracker: w.tracker, projects: w.projects, control: w.control, clock: w.clock, settings: w.trackerSettings };
}

let fingerprintCounter = 0;

/** An Issue with one Event, through assignEvent; returns its Issue Id. */
export async function crashIssue(w: World, overrides: Parameters<typeof summary>[1] = {}): Promise<string> {
  const assignment = await w.projects.assignEvent(PROJECT, summary(T0, overrides), [`fp-${(fingerprintCounter += 1)}`]);
  if (!('issueId' in assignment) || typeof assignment.issueId !== 'string') throw new Error('not assigned');
  return assignment.issueId;
}

/** Runs the notifier over Issue Changes, as the effects queue consumer would. */
export async function notifyAll(w: World, changes: readonly IssueChange[]) {
  const sent = [];
  for (const change of changes) sent.push(...(await notifyReporters(PROJECT, change, w)));
  return sent;
}

export async function shownStatuses(w: World, reportId: string): Promise<string[]> {
  return (await w.projects.store(PROJECT).statusChangesOf(reportId)).map((change) => change.status);
}

/** Applies a Member's command to a stored Issue, as triageIssue would, and enqueues its changes; returns them. */
export async function memberCommand(
  w: World,
  issueId: string,
  run: (state: IssueState) => IssueTransition | Refusal,
): Promise<IssueChange[]> {
  const store = w.projects.store(PROJECT);
  const state = await store.getIssue(issueId);
  if (!state) throw new Error(`no issue ${issueId}`);
  const result = run(state);
  if (isRefusal(result)) throw new Error(result.refusal);
  await store.putIssue(result.state);
  await store.appendHistory(result.changes);
  await w.effects.enqueue(result.changes);
  return [...result.changes];
}
