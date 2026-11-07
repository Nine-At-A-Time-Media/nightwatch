import { describe, expect, it } from 'vitest';
import { suggestOwners } from '../../../../src/application/issues/suggest-owners.js';
import type { OwnershipConfig } from '../../../../src/domain/ownership/config.js';
import type { OwnedEventSummary, OwnershipFacts } from '../../../../src/domain/ownership/facts.js';
import type { BlamedCommit } from '../../../../src/domain/ownership/suspect-commit.js';
import { FakeCodeHost } from '../../../_fakes/fake-code-host.js';
import { summary } from './world.js';
import { DAY, member, ORG, PROJECT, REPOSITORY, T0, crashIssue, world as trackerWorld } from '../tracker/world.js';

const ADA = { member: 'member-ada' };
const BOB = { member: 'member-bob' };
const WINDOW = 7 * DAY;

const FACTS: OwnershipFacts = {
  frames: [
    { path: 'node_modules/react/index.js', module: null, lineno: 5, inApp: false },
    { path: 'app:///src/checkout/pay.ts', module: 'checkout.pay', lineno: 42, inApp: true },
  ],
  url: 'https://shop.example/checkout',
  tags: {},
};

const CONFIG: OwnershipConfig = {
  ownershipRules: '',
  codeMappings: [{ repository: REPOSITORY, stackRoot: 'app:///', sourceRoot: 'web/', ref: 'main' }],
  autoAssign: false,
};

function blamed(at: number): BlamedCommit {
  return { hash: 'c0ffee'.padEnd(40, '0'), author: { email: 'bob@acme.example', login: 'bob-gh' }, at };
}

function world(config: Partial<OwnershipConfig> = {}) {
  const w = trackerWorld();
  w.control.addMember(PROJECT, ADA, { email: 'ada@acme.example' });
  w.control.addMembership(ADA, { organizationId: ORG, role: 'member' });
  w.control.addMember(PROJECT, BOB, { email: 'bob@acme.example' });
  w.control.addMembership(BOB, { organizationId: ORG, role: 'member' });
  w.control.setOwnershipConfig(PROJECT, { ...CONFIG, ...config });
  const codeHost = new FakeCodeHost();
  return { ...w, codeHost };
}

type World = ReturnType<typeof world>;

function deps(w: World) {
  return { control: w.control, codeHost: w.codeHost, projects: w.projects, settings: { suspectCommitWindow: WINDOW } };
}

function eventOf(facts: OwnershipFacts = FACTS): OwnedEventSummary {
  return { ...summary(T0), ownership: facts };
}

function hostPay(w: World, commit: BlamedCommit): void {
  w.codeHost.putFile({
    repository: REPOSITORY,
    path: 'web/src/checkout/pay.ts',
    ref: 'main',
    text: '',
    blame: [{ startingLine: 1, endingLine: 99, commit }],
  });
}

describe('suggestOwners', () => {
  it("Owner suggested: Given an Ownership Rule matches an event's path, When the issue is created, Then the rule's owner is suggested, and assigned when the Project auto-assigns", async () => {
    const rules = 'path:src/checkout/* ada@acme.example';
    const quiet = world({ ownershipRules: rules });
    const quietIssue = await crashIssue(quiet);
    const suggested = await suggestOwners(PROJECT, quietIssue, eventOf(), deps(quiet));
    expect(suggested.owners).toEqual([{ owner: ADA, source: 'ownership_rule' }]);
    expect(suggested.assigned).toBeNull();
    expect(await quiet.projects.assigneeOf(PROJECT, quietIssue)).toBeNull();

    const auto = world({ ownershipRules: rules, autoAssign: true });
    const autoIssue = await crashIssue(auto);
    const assigned = await suggestOwners(PROJECT, autoIssue, eventOf(), deps(auto));
    expect(assigned.assigned).toEqual(ADA);
    expect(await auto.projects.assigneeOf(PROJECT, autoIssue)).toEqual(ADA);
    expect(auto.projects.store(PROJECT).history.at(-1)).toMatchObject({ kind: 'assignee', to: 'member:member-ada', actor: 'system' });
  });

  it('Suspect commit: Given a code mapping and an in-app top frame, When an issue is created, Then the Suspect Commit and its author are shown', async () => {
    const w = world();
    w.control.mapTrackerAccount(ORG, 'bob-gh', BOB);
    hostPay(w, blamed(T0 - DAY));
    const issueId = await crashIssue(w);

    const suggested = await suggestOwners(PROJECT, issueId, eventOf(), deps(w));

    expect(suggested.suspectCommit).toEqual({
      repository: REPOSITORY,
      path: 'web/src/checkout/pay.ts',
      line: 42,
      commit: blamed(T0 - DAY),
    });
    expect(suggested.owners).toEqual([{ owner: BOB, source: 'suspect_commit' }]);
    expect(w.codeHost.calls).toContainEqual({
      kind: 'blame',
      at: { repository: REPOSITORY, path: 'web/src/checkout/pay.ts', ref: 'main', line: 42 },
    });
  });

  it("names the suspect commit's author by address when their login maps to no Member", async () => {
    const w = world();
    hostPay(w, blamed(T0 - DAY));
    const suggested = await suggestOwners(PROJECT, await crashIssue(w), eventOf(), deps(w));
    expect(suggested.owners).toEqual([{ owner: BOB, source: 'suspect_commit' }]);
  });

  it('names no commit outside the Suspect Commit Window, nor one made after the Issue was first seen', async () => {
    const old = world();
    hostPay(old, blamed(T0 - 8 * DAY));
    expect((await suggestOwners(PROJECT, await crashIssue(old), eventOf(), deps(old))).suspectCommit).toBeNull();

    const later = world();
    hostPay(later, blamed(T0 + DAY));
    const suggested = await suggestOwners(PROJECT, await crashIssue(later), eventOf(), deps(later));
    expect(suggested.suspectCommit).toBeNull();
    expect(suggested.owners).toEqual([]);
  });

  it('Ownership Rules outrank CODEOWNERS, which map through tracker accounts and teams, and owners are named once', async () => {
    const w = world({ ownershipRules: 'path:src/checkout/* #payments', autoAssign: true });
    w.control.mapTrackerAccount(ORG, 'bob-gh', BOB);
    w.control.mapTrackerTeam(ORG, 'acme/web-team', 'web');
    w.codeHost.putFile({
      repository: REPOSITORY,
      path: '.github/CODEOWNERS',
      ref: 'main',
      text: '/web/ @acme/web-team @bob-gh\n',
      blame: [],
    });
    hostPay(w, blamed(T0 - DAY));
    const issueId = await crashIssue(w);

    const suggested = await suggestOwners(PROJECT, issueId, eventOf(), deps(w));

    expect(suggested.owners).toEqual([
      { owner: { team: 'payments' }, source: 'ownership_rule' },
      { owner: { team: 'web' }, source: 'codeowners' },
      { owner: BOB, source: 'codeowners' },
    ]);
    expect(suggested.assigned).toEqual({ team: 'payments' });
  });

  it('reads CODEOWNERS from the repository root or docs when .github has none', async () => {
    const w = world();
    w.codeHost.putFile({ repository: REPOSITORY, path: 'docs/CODEOWNERS', ref: 'main', text: '* ada@acme.example\n', blame: [] });
    const suggested = await suggestOwners(PROJECT, await crashIssue(w), eventOf(), deps(w));
    expect(suggested.owners).toEqual([{ owner: ADA, source: 'codeowners' }]);
  });

  it('leaves an Issue that already has an Assignee as it is', async () => {
    const w = world({ ownershipRules: 'path:src/** ada@acme.example', autoAssign: true });
    const issueId = await crashIssue(w);
    await w.projects.assignIssue(PROJECT, issueId, BOB, member);

    const suggested = await suggestOwners(PROJECT, issueId, eventOf(), deps(w));

    expect(suggested.owners).toEqual([{ owner: ADA, source: 'ownership_rule' }]);
    expect(suggested.assigned).toBeNull();
    expect(await w.projects.assigneeOf(PROJECT, issueId)).toEqual(BOB);
  });

  it('reads no code from a Repository that is not connected, and a refusing host only costs the code owners', async () => {
    const unconnected = world({ ownershipRules: 'url:*/checkout #web' });
    await unconnected.control.disconnectRepositories([REPOSITORY]);
    const suggested = await suggestOwners(PROJECT, await crashIssue(unconnected), eventOf(), deps(unconnected));
    expect(unconnected.codeHost.calls).toEqual([]);
    expect(suggested).toMatchObject({ owners: [{ owner: { team: 'web' }, source: 'ownership_rule' }], suspectCommit: null });

    const refusing = world({ ownershipRules: 'url:*/checkout #web' });
    refusing.codeHost.refusing = { refusal: 'code_unreachable' };
    expect(await suggestOwners(PROJECT, await crashIssue(refusing), eventOf(), deps(refusing))).toMatchObject({
      owners: [{ owner: { team: 'web' }, source: 'ownership_rule' }],
      suspectCommit: null,
    });
  });

  it('an owner who maps to no Member, a frame under no Code Mapping, or an Issue the Project does not hold suggests no one', async () => {
    const w = world({ ownershipRules: 'path:src/** nobody@else.example' });
    const issueId = await crashIssue(w);
    const unmapped: OwnershipFacts = { ...FACTS, frames: [{ path: 'webpack:///src/a.ts', module: null, lineno: 1, inApp: true }] };

    expect((await suggestOwners(PROJECT, issueId, eventOf(), deps(w))).owners).toEqual([]);
    expect(await suggestOwners(PROJECT, issueId, eventOf(unmapped), deps(w))).toMatchObject({ owners: [], suspectCommit: null });
    expect(await suggestOwners(PROJECT, 'issue-404', eventOf(), deps(w))).toEqual({
      issueId: 'issue-404',
      owners: [],
      suspectCommit: null,
      assigned: null,
    });
  });
});
