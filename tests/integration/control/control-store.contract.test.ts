// ControlStore contract: the D1 adapter and the in-memory fake answer every
// method the same way -- round trips, missing rows, the order rows come back
// in, and Organization isolation (a lookup through Organization A, or a
// Project of it, never returns Organization B's rows). Each implementation is
// seeded through its own side door: the fake's helpers, raw SQL for D1 (as
// the console will write it). Ids are unique per test, since one D1 database
// serves the whole file.
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1ControlStore } from '../../../src/adapters/d1/d1-control-store.js';
import type { IssueAlertRule } from '../../../src/domain/alerts/issue-alert-rule.js';
import type { NotificationSettings } from '../../../src/domain/alerts/notification-settings.js';
import { gv1 } from '../../../src/domain/grouping/grouping-version.js';
import type { Member } from '../../../src/domain/issue/state.js';
import { NO_OWNERSHIP_CONFIG, type OwnershipConfig } from '../../../src/domain/ownership/config.js';
import type { ProcessingConfig } from '../../../src/domain/processing/processing.js';
import type { TrustedIssuer } from '../../../src/domain/signin/sign-in.js';
import type { ControlStore, Membership } from '../../../src/ports/control-store.js';
import { FakeControlStore } from '../../_fakes/fake-control-store.js';

// --- seeding ---

type MemberSeed = { readonly email: string; readonly owner?: boolean; readonly teams?: readonly string[] };

/** What the console writes and no use case does: one door per implementation. */
type Seed = {
  project(organizationId: string, projectId: string): Promise<void>;
  trustedIssuer(organizationId: string, issuer: TrustedIssuer): Promise<void>;
  member(projectId: string, member: Member, seed: MemberSeed): Promise<void>;
  membership(member: Member, membership: Membership): Promise<void>;
  alertRule(projectId: string, rule: IssueAlertRule): Promise<void>;
  notificationSettings(member: Member, settings: NotificationSettings): Promise<void>;
  processingConfig(projectId: string, config: ProcessingConfig): Promise<void>;
  repository(organizationId: string, repository: string): Promise<void>;
  trackerAccount(organizationId: string, login: string, member: Member): Promise<void>;
  slug(projectId: string, slug: string): Promise<void>;
  ownershipConfig(projectId: string, config: OwnershipConfig): Promise<void>;
  trackerTeam(organizationId: string, slug: string, team: string): Promise<void>;
};

type Subject = { readonly store: ControlStore; readonly seed: Seed };

function fakeSubject(): Subject {
  const store = new FakeControlStore();
  return {
    store,
    seed: {
      project: async (organizationId, projectId) => store.addProject(organizationId, projectId),
      trustedIssuer: async (organizationId, issuer) => store.addTrustedIssuer(organizationId, issuer),
      member: async (projectId, member, seed) => store.addMember(projectId, member, seed),
      membership: async (member, membership) => store.addMembership(member, membership),
      alertRule: async (projectId, rule) => store.addIssueAlertRule(projectId, rule),
      notificationSettings: async (member, settings) => store.setNotificationSettings(member, settings),
      processingConfig: async (projectId, config) => store.setProcessingConfig(projectId, config),
      repository: async (organizationId, repository) => store.connectRepository(organizationId, repository),
      trackerAccount: async (organizationId, login, member) => store.mapTrackerAccount(organizationId, login, member),
      slug: async (projectId, slug) => store.addProjectSlug(projectId, slug),
      ownershipConfig: async (projectId, config) => store.setOwnershipConfig(projectId, config),
      trackerTeam: async (organizationId, slug, team) => store.mapTrackerTeam(organizationId, slug, team),
    },
  };
}

async function run(sql: string, ...values: unknown[]): Promise<void> {
  await env.CONTROL.prepare(sql)
    .bind(...values)
    .run();
}

async function addOrganization(organizationId: string): Promise<void> {
  await run('INSERT OR IGNORE INTO organizations (organization_id) VALUES (?)', organizationId);
}

const d1Seed: Seed = {
  project: async (organizationId, projectId) => {
    await addOrganization(organizationId);
    await run('INSERT INTO projects (project_id, organization_id) VALUES (?, ?)', projectId, organizationId);
  },
  trustedIssuer: async (organizationId, issuer) => {
    await addOrganization(organizationId);
    await run(
      'INSERT INTO trusted_issuers (organization_id, issuer, audiences) VALUES (?, ?, ?)',
      organizationId,
      issuer.issuer,
      JSON.stringify(issuer.audiences),
    );
  },
  member: async (projectId, member, seed) => {
    await run('INSERT OR IGNORE INTO members (member_id, email) VALUES (?, ?)', member.member, seed.email);
    await run('INSERT INTO project_members (project_id, member_id, owner) VALUES (?, ?, ?)', projectId, member.member, seed.owner ? 1 : 0);
    for (const team of seed.teams ?? []) {
      await run(
        'INSERT INTO team_members (organization_id, team, member_id) SELECT organization_id, ?, ? FROM projects WHERE project_id = ?',
        team,
        member.member,
        projectId,
      );
    }
  },
  membership: async (member, membership) => {
    await addOrganization(membership.organizationId);
    await run(
      'INSERT INTO memberships (member_id, organization_id, role) VALUES (?, ?, ?)',
      member.member,
      membership.organizationId,
      membership.role,
    );
  },
  alertRule: async (projectId, rule) => {
    await run('INSERT INTO issue_alert_rules (project_id, rule_id, rule) VALUES (?, ?, ?)', projectId, rule.ruleId, JSON.stringify(rule));
  },
  notificationSettings: async (member, settings) => {
    await run('INSERT OR REPLACE INTO notification_settings (member_id, settings) VALUES (?, ?)', member.member, JSON.stringify(settings));
  },
  processingConfig: async (projectId, config) => {
    await run('INSERT OR REPLACE INTO processing_configs (project_id, config) VALUES (?, ?)', projectId, JSON.stringify(config));
  },
  repository: async (organizationId, repository) => {
    await addOrganization(organizationId);
    await run('INSERT OR REPLACE INTO repositories (repository, organization_id) VALUES (?, ?)', repository, organizationId);
  },
  trackerAccount: async (organizationId, login, member) => {
    await addOrganization(organizationId);
    await run(
      'INSERT OR REPLACE INTO tracker_accounts (organization_id, login, member_id) VALUES (?, ?, ?)',
      organizationId,
      login.toLowerCase(),
      member.member,
    );
  },
  slug: async (projectId, slug) => {
    await run('UPDATE projects SET slug = ? WHERE project_id = ?', slug, projectId);
  },
  ownershipConfig: async (projectId, config) => {
    await run('INSERT OR REPLACE INTO ownership_configs (project_id, config) VALUES (?, ?)', projectId, JSON.stringify(config));
  },
  trackerTeam: async (organizationId, slug, team) => {
    await addOrganization(organizationId);
    await run(
      'INSERT OR REPLACE INTO tracker_teams (organization_id, slug, team) VALUES (?, ?, ?)',
      organizationId,
      slug.toLowerCase(),
      team,
    );
  },
};

function d1Subject(): Subject {
  return { store: new D1ControlStore(env.CONTROL), seed: d1Seed };
}

// --- values ---

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Two Organizations with one Project each. */
async function twoOrganizations(seed: Seed) {
  const a = { organizationId: uid('org-a'), projectId: uid('project-a') };
  const b = { organizationId: uid('org-b'), projectId: uid('project-b') };
  await seed.project(a.organizationId, a.projectId);
  await seed.project(b.organizationId, b.projectId);
  return { a, b };
}

function rule(ruleId: string): IssueAlertRule {
  return {
    ruleId,
    triggers: [{ kind: 'event_frequency', count: 10, windowMs: 3_600_000 }],
    actionMatch: 'any',
    filters: [{ kind: 'environment', environment: 'production' }],
    filterMatch: 'all',
    actions: [{ kind: 'email', to: { kind: 'owners' } }],
    quietPeriodMs: 1_800_000,
  };
}

const processing: ProcessingConfig = {
  scrubbing: { ipAddresses: true, project: [{ name: 'emails', selector: 'user.email', method: 'hash' }] },
  grouping: { version: gv1, fingerprintRules: [], stackTraceRules: [] },
  eventRetentionMs: 90 * 86_400_000,
};

// --- the contract ---

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

describe.each<{ name: string; make: () => Subject }>([
  { name: 'FakeControlStore', make: fakeSubject },
  { name: 'D1ControlStore', make: d1Subject },
])('ControlStore contract -- $name', ({ make }) => {
  describe('Organizations and Projects', () => {
    it('a Project names its Organization, and each Organization lists only its own Projects in the order they were added', async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      const second = uid('project-a2');
      await seed.project(a.organizationId, second);

      expect(await store.organizationOf(a.projectId)).toBe(a.organizationId);
      expect(await store.organizationOf(b.projectId)).toBe(b.organizationId);
      expect(await store.projectsOf(a.organizationId)).toEqual([a.projectId, second]);
      expect(await store.projectsOf(b.organizationId)).toEqual([b.projectId]);
      const organizations = await store.organizations();
      expect(organizations.indexOf(a.organizationId)).toBeGreaterThanOrEqual(0);
      expect(organizations.indexOf(b.organizationId)).toBeGreaterThan(organizations.indexOf(a.organizationId));
    });

    it('an unknown Project has no Organization, and an unknown Organization has no Projects', async () => {
      const { store } = make();
      expect(await store.organizationOf(uid('project'))).toBeNull();
      expect(await store.projectsOf(uid('org'))).toEqual([]);
    });

    it("a slug finds its Organization's Project in any case, and never another Organization's", async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      await seed.slug(a.projectId, 'WEB');

      expect(await store.projectOfSlug({ organizationId: a.organizationId, slug: 'web' })).toBe(a.projectId);
      expect(await store.projectOfSlug({ organizationId: a.organizationId, slug: 'WEB' })).toBe(a.projectId);
      expect(await store.projectOfSlug({ organizationId: b.organizationId, slug: 'WEB' })).toBeNull();
      expect(await store.projectOfSlug({ organizationId: a.organizationId, slug: 'API' })).toBeNull();
    });
  });

  describe('sign-in and Membership', () => {
    it('trusted issuers read back per Organization, in order, and an Organization trusting none reads empty', async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      const first = { issuer: 'https://one.example', audiences: ['console', 'widget'] };
      const second = { issuer: 'https://two.example', audiences: [] };
      await seed.trustedIssuer(a.organizationId, first);
      await seed.trustedIssuer(a.organizationId, second);

      expect(await store.trustedIssuers(a.organizationId)).toEqual([first, second]);
      expect(await store.trustedIssuers(b.organizationId)).toEqual([]);
      expect(await store.trustedIssuers(uid('org'))).toEqual([]);
    });

    it('a Member of the Project is found by their address in any case; another Project or an unknown address is not', async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      await seed.member(a.projectId, { member: uid('mia') }, { email: 'Mia@Acme.example' });

      expect(await store.isProjectMember({ projectId: a.projectId, email: 'mia@acme.example' })).toBe(true);
      expect(await store.isProjectMember({ projectId: b.projectId, email: 'mia@acme.example' })).toBe(false);
      expect(await store.isProjectMember({ projectId: a.projectId, email: 'eve@example.com' })).toBe(false);
    });

    it("a Member's Membership and address read back, and an unknown Member has neither", async () => {
      const { store, seed } = make();
      const { a } = await twoOrganizations(seed);
      const mia = { member: uid('mia') };
      await seed.member(a.projectId, mia, { email: 'mia@acme.example' });
      await seed.membership(mia, { organizationId: a.organizationId, role: 'owner' });

      expect(await store.membershipOf(mia)).toEqual({ organizationId: a.organizationId, role: 'owner' });
      expect(await store.addressOf(mia)).toBe('mia@acme.example');
      expect(await store.membershipOf({ member: uid('nobody') })).toBeNull();
      expect(await store.addressOf({ member: uid('nobody') })).toBeNull();
    });

    it('every Member with permission on the Project is listed in the order they were added, and only theirs', async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      const mia = { member: uid('mia') };
      const bob = { member: uid('bob') };
      const eve = { member: uid('eve') };
      await seed.member(a.projectId, mia, { email: 'mia@acme.example' });
      await seed.member(a.projectId, bob, { email: 'bob@acme.example' });
      await seed.member(b.projectId, eve, { email: 'eve@other.example' });

      expect(await store.projectMembers(a.projectId)).toEqual([mia, bob]);
      expect(await store.projectMembers(b.projectId)).toEqual([eve]);
      expect(await store.projectMembers(uid('project'))).toEqual([]);
    });
  });

  describe('alert rules, recipients and notification settings', () => {
    it("the Project's Issue Alert Rules read back whole, in order, and a Project without rules reads empty", async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      await seed.alertRule(a.projectId, rule('r-1'));
      await seed.alertRule(a.projectId, rule('r-2'));

      expect(await store.issueAlertRules(a.projectId)).toEqual([rule('r-1'), rule('r-2')]);
      expect(await store.issueAlertRules(b.projectId)).toEqual([]);
    });

    it("owners are the Project's owners, a Team is its Members in the Project's Organization only, and a Member must be on the Project", async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      const mia = { member: uid('mia') };
      const bob = { member: uid('bob') };
      const eve = { member: uid('eve') };
      await seed.member(a.projectId, mia, { email: 'mia@acme.example', owner: true, teams: ['backend'] });
      await seed.member(a.projectId, bob, { email: 'bob@acme.example', teams: ['backend'] });
      await seed.member(b.projectId, eve, { email: 'eve@other.example', owner: true, teams: ['backend'] });

      expect(await store.recipientsOf({ projectId: a.projectId, to: { kind: 'owners' } })).toEqual([mia]);
      expect(await store.recipientsOf({ projectId: a.projectId, to: { kind: 'team', team: 'backend' } })).toEqual([mia, bob]);
      expect(await store.recipientsOf({ projectId: b.projectId, to: { kind: 'team', team: 'backend' } })).toEqual([eve]);
      expect(await store.recipientsOf({ projectId: a.projectId, to: { kind: 'team', team: 'nobody' } })).toEqual([]);
      expect(await store.recipientsOf({ projectId: a.projectId, to: { kind: 'member', member: bob.member } })).toEqual([bob]);
      expect(await store.recipientsOf({ projectId: a.projectId, to: { kind: 'member', member: eve.member } })).toEqual([]);
    });

    it("a Member's notification settings read back, and a Member who set none has empty settings", async () => {
      const { store, seed } = make();
      const { a } = await twoOrganizations(seed);
      const mia = { member: uid('mia') };
      await seed.member(a.projectId, mia, { email: 'mia@acme.example' });
      const settings: NotificationSettings = {
        organization: { workflow: 'always' },
        projects: { [a.projectId]: { issue_alert: 'never' } },
      };
      await seed.notificationSettings(mia, settings);

      expect(await store.notificationSettingsOf(mia)).toEqual(settings);
      expect(await store.notificationSettingsOf({ member: uid('bob') })).toEqual({ organization: {}, projects: {} });
    });
  });

  describe('processing config', () => {
    it("the Project's processing config reads back whole, and an unknown Project's is null", async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      await seed.processingConfig(a.projectId, processing);

      expect(await store.processingConfig(a.projectId)).toEqual(processing);
      expect(await store.processingConfig(b.projectId)).toBeNull();
    });
  });

  describe('Report Reference index and subscriptions', () => {
    it('a reference hash names its Report, and an unknown hash names nothing', async () => {
      const { store, seed } = make();
      const { a } = await twoOrganizations(seed);
      const entry = { organizationId: a.organizationId, projectId: a.projectId, reportId: uid('report') };
      const hash = uid('hash');

      expect(await store.putReference(hash, entry)).toEqual({ ok: true });
      expect(await store.findReference(hash)).toEqual(entry);
      expect(await store.findReference(uid('hash'))).toBeNull();
    });

    it('forgetting a Report revokes every reference to it and its unsubscription, and nothing of another Report', async () => {
      const { store, seed } = make();
      const { a } = await twoOrganizations(seed);
      const forgotten = { organizationId: a.organizationId, projectId: a.projectId, reportId: uid('report') };
      const kept = { ...forgotten, reportId: uid('report') };
      const [one, two, other] = [uid('hash'), uid('hash'), uid('hash')];
      await store.putReference(one, forgotten);
      await store.putReference(two, forgotten);
      await store.putReference(other, kept);
      await store.unsubscribe(forgotten.reportId);
      await store.unsubscribe(kept.reportId);

      expect(await store.forgetReport(forgotten.reportId)).toEqual({ ok: true });
      expect(await store.findReference(one)).toBeNull();
      expect(await store.findReference(two)).toBeNull();
      expect(await store.findReference(other)).toEqual(kept);
      expect(await store.isUnsubscribed(forgotten.reportId)).toBe(false);
      expect(await store.isUnsubscribed(kept.reportId)).toBe(true);
    });

    it('a Report is subscribed until its reporter unsubscribes, and unsubscribing twice changes nothing', async () => {
      const { store } = make();
      const reportId = uid('report');
      expect(await store.isUnsubscribed(reportId)).toBe(false);
      await store.unsubscribe(reportId);
      await store.unsubscribe(reportId);
      expect(await store.isUnsubscribed(reportId)).toBe(true);
    });
  });

  describe('Access Tokens', () => {
    it("a token's record reads back by its hash, a later put replaces it, and an unknown hash reads null", async () => {
      const { store, seed } = make();
      const { a } = await twoOrganizations(seed);
      const hash = uid('token-hash');
      const record = {
        organizationId: a.organizationId,
        scopes: ['project:releases', 'event:read'] as const,
        expiresAt: 1_900_000_000_000,
        revoked: false,
      };

      expect(await store.putAccessToken(hash, record)).toEqual({ ok: true });
      expect(await store.findAccessToken(hash)).toEqual(record);
      await store.putAccessToken(hash, { ...record, expiresAt: null, revoked: true });
      expect(await store.findAccessToken(hash)).toEqual({ ...record, expiresAt: null, revoked: true });
      expect(await store.findAccessToken(uid('token-hash'))).toBeNull();
    });
  });

  describe('Artifact index', () => {
    it('an indexed Artifact is found through any Project of its Organization by release or by debug id in any form, once however often it is indexed', async () => {
      const { store, seed } = make();
      const { a } = await twoOrganizations(seed);
      const sibling = uid('project-a2');
      await seed.project(a.organizationId, sibling);
      const byRelease = { id: uid('map'), debugId: null, release: 'web@1.0.0', fileName: '~/app.min.js.map' };
      const byDebugId = { id: uid('map'), debugId: 'C0FFEE00-1111-2222-3333-444455556666', release: null, fileName: '~/vendor.js.map' };

      expect(await store.putArtifact(a.organizationId, byRelease)).toEqual({ ok: true });
      expect(await store.putArtifact(a.organizationId, byDebugId)).toEqual({ ok: true });
      expect(await store.putArtifact(a.organizationId, byRelease)).toEqual({ ok: true });

      expect(await store.artifactsFor(a.projectId, { release: 'web@1.0.0', debugIds: [] })).toEqual([byRelease]);
      expect(await store.artifactsFor(sibling, { release: null, debugIds: ['c0ffee00111122223333444455556666'] })).toEqual([byDebugId]);
      expect(await store.artifactsFor(a.projectId, { release: 'web@1.0.0', debugIds: ['c0ffee00-1111-2222-3333-444455556666'] })).toEqual([
        byRelease,
        byDebugId,
      ]);
      expect(await store.artifactsFor(a.projectId, { release: 'web@2.0.0', debugIds: [] })).toEqual([]);
    });

    it("an Artifact of one Organization is never found through another Organization's Project, nor through an unknown Project", async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      const artifact = { id: uid('map'), debugId: 'abc', release: 'web@1.0.0', fileName: '~/app.min.js.map' };
      await store.putArtifact(b.organizationId, artifact);

      expect(await store.artifactsFor(a.projectId, { release: 'web@1.0.0', debugIds: ['abc'] })).toEqual([]);
      expect(await store.artifactsFor(uid('project'), { release: 'web@1.0.0', debugIds: ['abc'] })).toEqual([]);
      expect(await store.artifactsFor(b.projectId, { release: 'web@1.0.0', debugIds: ['abc'] })).toEqual([artifact]);
    });
  });

  describe('Code and GitHub', () => {
    it('a connected Repository belongs to its Organization only, until it is disconnected', async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      const [repository, other] = [uid('acme/web'), uid('acme/api')];
      await seed.repository(a.organizationId, repository);
      await seed.repository(a.organizationId, other);

      expect(await store.isRepositoryConnected({ organizationId: a.organizationId, repository })).toBe(true);
      expect(await store.isRepositoryConnected({ organizationId: b.organizationId, repository })).toBe(false);
      expect(await store.organizationOfRepository(repository)).toBe(a.organizationId);
      expect(await store.organizationOfRepository(uid('acme/none'))).toBeNull();

      await store.disconnectRepositories([repository]);
      expect(await store.isRepositoryConnected({ organizationId: a.organizationId, repository })).toBe(false);
      expect(await store.organizationOfRepository(repository)).toBeNull();
      expect(await store.organizationOfRepository(other)).toBe(a.organizationId);
    });

    it('a link entry is found by its tracker issue, a later put replaces it, and entries are listed per Repository', async () => {
      const { store, seed } = make();
      const { a } = await twoOrganizations(seed);
      const [repository, other] = [uid('acme/web'), uid('acme/api')];
      const first = { repository, number: 7, projectId: a.projectId, issueId: uid('issue') };
      const second = { repository, number: 8, projectId: a.projectId, issueId: uid('issue') };
      const elsewhere = { repository: other, number: 7, projectId: a.projectId, issueId: uid('issue') };
      await store.putLinkEntry(first);
      await store.putLinkEntry(second);
      await store.putLinkEntry(elsewhere);
      const moved = { ...first, issueId: uid('issue') };
      await store.putLinkEntry(moved);

      expect(await store.findLinkEntry({ repository, number: 7 })).toEqual(moved);
      expect(await store.findLinkEntry({ repository, number: 9 })).toBeNull();
      expect(await store.linkEntriesIn([repository])).toEqual([moved, second]);
      expect(await store.linkEntriesIn([repository, other])).toEqual([moved, second, elsewhere]);
      expect(await store.linkEntriesIn([])).toEqual([]);
    });

    it('a tracker account maps to its Member in its Organization only, matched without case', async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      const mia = { member: uid('mia') };
      await seed.trackerAccount(a.organizationId, 'MiaCodes', mia);

      expect(await store.memberOfTrackerAccount({ organizationId: a.organizationId, login: 'miacodes' })).toEqual(mia);
      expect(await store.memberOfTrackerAccount({ organizationId: b.organizationId, login: 'MiaCodes' })).toBeNull();
      expect(await store.memberOfTrackerAccount({ organizationId: a.organizationId, login: 'someone' })).toBeNull();
    });
  });

  describe('owner suggestions', () => {
    it("a Project's ownership config reads back whole, and a Project that set none reads as none", async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      const config: OwnershipConfig = {
        ownershipRules: 'path:src/** #web',
        codeMappings: [{ repository: 'acme/web', stackRoot: 'app:///', sourceRoot: 'web/', ref: 'main' }],
        autoAssign: true,
      };
      await seed.ownershipConfig(a.projectId, config);

      expect(await store.ownershipConfig(a.projectId)).toEqual(config);
      expect(await store.ownershipConfig(b.projectId)).toEqual(NO_OWNERSHIP_CONFIG);
    });

    it("an address finds its Member in the Member's Organization only, matched without case", async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      const ada = { member: uid('ada') };
      const email = `${uid('ada')}@acme.example`;
      await seed.member(a.projectId, ada, { email });
      await seed.membership(ada, { organizationId: a.organizationId, role: 'member' });

      expect(await store.memberOfAddress({ organizationId: a.organizationId, email: email.toUpperCase() })).toEqual(ada);
      expect(await store.memberOfAddress({ organizationId: b.organizationId, email })).toBeNull();
      expect(await store.memberOfAddress({ organizationId: a.organizationId, email: 'nobody@acme.example' })).toBeNull();
    });

    it('a tracker team maps to its Team in its Organization only, matched without case', async () => {
      const { store, seed } = make();
      const { a, b } = await twoOrganizations(seed);
      await seed.trackerTeam(a.organizationId, 'Acme/Web-Team', 'web');

      expect(await store.teamOfTrackerTeam({ organizationId: a.organizationId, slug: 'acme/web-team' })).toBe('web');
      expect(await store.teamOfTrackerTeam({ organizationId: b.organizationId, slug: 'acme/web-team' })).toBeNull();
      expect(await store.teamOfTrackerTeam({ organizationId: a.organizationId, slug: 'acme/other' })).toBeNull();
    });
  });
});
