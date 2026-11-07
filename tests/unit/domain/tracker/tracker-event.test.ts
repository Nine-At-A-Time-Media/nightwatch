import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expectPushed, link, markBroken, type ExternalLink, type TrackerState } from '../../../../src/domain/tracker/external-link.js';
import { isEcho, issueCommandFor, linkAfter, type TrackerEvent } from '../../../../src/domain/tracker/tracker-event.js';

const APP = 'nightwatch-app[bot]';
const OPEN: TrackerState = { state: 'open' };
const COMPLETED: TrackerState = { state: 'closed', reason: 'completed' };
const NOT_PLANNED: TrackerState = { state: 'closed', reason: 'not_planned' };

const linked: ExternalLink = link({ issueId: 'i1', repository: 'acme/app', number: 7, lastKnown: OPEN });

const closedCompleted: TrackerEvent = { kind: 'issue_closed', repository: 'acme/app', number: 7, reason: 'completed', actor: 'dev' };
const closedNotPlanned: TrackerEvent = { kind: 'issue_closed', repository: 'acme/app', number: 7, reason: 'not_planned', actor: 'dev' };
const reopened: TrackerEvent = { kind: 'issue_reopened', repository: 'acme/app', number: 7, actor: 'dev' };
const comment: TrackerEvent = {
  kind: 'comment_created',
  repository: 'acme/app',
  number: 7,
  author: { login: 'dev', canWrite: true },
  body: 'hello',
};
const installationRemoved: TrackerEvent = { kind: 'installation_removed', repositories: ['acme/app', 'acme/other'] };
const repositoryRemoved: TrackerEvent = { kind: 'repository_removed', repository: 'acme/app' };

const login = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/);
const stateEvent: fc.Arbitrary<TrackerEvent> = fc.oneof(
  fc.record({
    kind: fc.constant('issue_closed' as const),
    repository: fc.constant('acme/app'),
    number: fc.constant(7),
    reason: fc.constantFrom('completed' as const, 'not_planned' as const),
    actor: login,
  }),
  fc.record({ kind: fc.constant('issue_reopened' as const), repository: fc.constant('acme/app'), number: fc.constant(7), actor: login }),
);
const anyEvent: fc.Arbitrary<TrackerEvent> = fc.oneof(
  stateEvent,
  fc.constantFrom(comment, installationRemoved, repositoryRemoved),
  fc.record({
    kind: fc.constant('comment_created' as const),
    repository: fc.constant('acme/app'),
    number: fc.constant(7),
    author: fc.record({ login, canWrite: fc.boolean() }),
    body: fc.string(),
  }),
);

describe('Tracker Event to Issue command', () => {
  it('GitHub close resolves: Given a linked issue, When the GitHub issue is closed as completed, Then the command is resolve', () => {
    expect(issueCommandFor(closedCompleted, linked)).toBe('resolve');
  });

  it('GitHub not-planned closes report: Given a linked issue, When closed as not planned, Then the command is archive forever', () => {
    expect(issueCommandFor(closedNotPlanned, linked)).toBe('archiveForever');
  });

  it('GitHub reopen: Given a linked resolved issue, When the GitHub issue is reopened, Then the command is unresolve', () => {
    expect(issueCommandFor(reopened, linked)).toBe('unresolve');
  });

  it('comments and removals command nothing on the Issue', () => {
    for (const event of [comment, installationRemoved, repositoryRemoved]) expect(issueCommandFor(event, linked)).toBe('none');
  });

  it('an event about another GitHub issue or repository commands nothing', () => {
    expect(issueCommandFor({ ...closedCompleted, number: 8 }, linked)).toBe('none');
    expect(issueCommandFor({ ...closedCompleted, repository: 'acme/other' }, linked)).toBe('none');
  });

  it('a Broken link carries no change from GitHub', () => {
    fc.assert(fc.property(anyEvent, (event) => issueCommandFor(event, markBroken(linked)) === 'none'));
  });
});

describe('No echo', () => {
  it('No echo: Given a state change Nightwatch pushed, When GitHub reports that same state, Then it is an echo', () => {
    expect(isEcho(closedCompleted, expectPushed(linked, COMPLETED), APP)).toBe(true);
    expect(isEcho(reopened, expectPushed(linked, OPEN), APP)).toBe(true);
  });

  it('No echo: a state other than the one pushed is a real change', () => {
    expect(isEcho(closedNotPlanned, expectPushed(linked, COMPLETED), APP)).toBe(false);
    expect(isEcho(closedCompleted, linked, APP)).toBe(false);
  });

  it('No echo: any event whose actor is the App is an echo, comments included', () => {
    fc.assert(
      fc.property(anyEvent, (event) => {
        const byApp: TrackerEvent =
          event.kind === 'comment_created'
            ? { ...event, author: { ...event.author, login: APP } }
            : event.kind === 'issue_closed' || event.kind === 'issue_reopened'
              ? { ...event, actor: APP }
              : event;
        if (byApp.kind === 'installation_removed' || byApp.kind === 'repository_removed') expect(isEcho(byApp, linked, APP)).toBe(false);
        else expect(isEcho(byApp, linked, APP)).toBe(true);
      }),
    );
  });

  it('No echo: removals are never echoes', () => {
    expect(isEcho(installationRemoved, linked, APP)).toBe(false);
    expect(isEcho(repositoryRemoved, linked, APP)).toBe(false);
  });
});

describe('External Link after a Tracker Event', () => {
  it('Uninstalled app: Given the installation is removed, Then each link in its repositories is Broken', () => {
    expect(linkAfter(installationRemoved, linked).state).toBe('broken');
    expect(linkAfter({ kind: 'installation_removed', repositories: ['acme/other'] }, linked)).toEqual(linked);
  });

  it('a removed repository breaks its links only', () => {
    expect(linkAfter(repositoryRemoved, linked).state).toBe('broken');
    expect(linkAfter({ kind: 'repository_removed', repository: 'acme/other' }, linked)).toEqual(linked);
  });

  it('a state change becomes the last known state and consumes a matching expectation', () => {
    const after = linkAfter(closedCompleted, expectPushed(linked, COMPLETED));
    expect(after).toMatchObject({ state: 'linked', lastKnown: COMPLETED, expected: null });
    expect(linkAfter(closedNotPlanned, linked).lastKnown).toEqual(NOT_PLANNED);
  });

  it('a comment, or an event about another GitHub issue, leaves the link as it is', () => {
    expect(linkAfter(comment, linked)).toEqual(linked);
    expect(linkAfter({ ...closedCompleted, number: 8 }, linked)).toEqual(linked);
  });
});
