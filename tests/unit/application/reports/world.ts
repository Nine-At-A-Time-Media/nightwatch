// Shared builders for the Reports use-case tests: one Organization with one
// Project and a trusted issuer, signed-in reporters and Members, and a fresh
// set of fakes per test. The Project's state is reached through the
// FakeProjectClient, as the console and notifier reach it.
import { fileReport } from '../../../../src/application/reports/file-report.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import type { FilingReceipt, ReportSettings } from '../../../../src/domain/report/filing.js';
import type { ReportSubmission } from '../../../../src/domain/report/report.js';
import type { SignIn } from '../../../../src/domain/signin/sign-in.js';
import { FakeBlobStore } from '../../../_fakes/fake-blob-store.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeControlStore } from '../../../_fakes/fake-control-store.js';
import { FakeIds } from '../../../_fakes/fake-ids.js';
import { FakeMailer } from '../../../_fakes/fake-mailer.js';
import { FakeProjectClient } from '../../../_fakes/fake-project-client.js';
import { FakeQuotaGate } from '../../../_fakes/fake-quota-gate.js';
import { FakeSignInVerifier } from '../../../_fakes/sign-in-verifier.js';
import { FakeSpamJudge } from '../../../_fakes/fake-spam-judge.js';
import { FakeEffectQueue } from '../../../_fakes/effect-queue.js';
import { DAY, HOUR, MINUTE, T0, policies } from '../../domain/issue/fixtures.js';

export { DAY, HOUR, MINUTE, T0 };

export const ORG = 'org-1';
export const PROJECT = 'project-1';
export const ISSUER = { issuer: 'https://acme.example', audiences: ['console'] };
export const SETTINGS: ReportSettings = { followUpBaseUrl: 'https://console.example', maxMessageLength: 2000, spamThreshold: 0.9 };

/** Ada and Bob are reporters, Mia is a Member of the Project, Eve is neither. */
export const ADA = 'ada@example.com';
export const BOB = 'bob@example.com';
export const MIA = 'mia@acme.example';
export const EVE = 'eve@example.com';

export const member = { member: 'member-mia' } as const;

function signInAs(email: string, issuer = ISSUER.issuer): SignIn {
  return { email, issuer, audience: 'console', expiresAt: new Date(T0 + 365 * DAY) };
}

/** The assertion string a signed-in person presents. */
export function assertionOf(email: string): string {
  return `assertion:${email}`;
}

export function world(options: { quota?: Record<string, Partial<Record<'feedback', number>>> } = {}) {
  const clock = new FakeClock(T0);
  const ids = new FakeIds('id');
  const effects = new FakeEffectQueue();
  const control = new FakeControlStore();
  control.addProject(ORG, PROJECT);
  control.addTrustedIssuer(ORG, ISSUER);
  control.addProjectMember(PROJECT, MIA);
  control.addMembership(member, { organizationId: ORG, role: 'owner' });
  const verifier = new FakeSignInVerifier({ clock: { now: () => new Date(clock.now()) } });
  for (const email of [ADA, BOB, MIA, EVE]) verifier.register(assertionOf(email), signInAs(email));
  verifier.register('assertion:mallory', signInAs('mallory@example.com', 'https://untrusted.example'));
  const projects = new FakeProjectClient({ clock, ids, effects, policies, dedupWindow: DAY });
  return {
    clock,
    ids,
    effects,
    control,
    verifier,
    projects,
    quota: new FakeQuotaGate(options.quota ?? {}),
    blobs: new FakeBlobStore(),
    mailer: new FakeMailer(),
    spam: new FakeSpamJudge(),
    settings: SETTINGS,
  };
}

export type World = ReturnType<typeof world>;

export function submission(message: string, overrides: Partial<ReportSubmission> = {}): ReportSubmission {
  return { message, screenshot: null, associatedEventId: null, ...overrides };
}

/** Files a Report for `email` through fileReport and returns its Filing Receipt. */
export async function filed(w: World, email: string, message = 'the save button does nothing'): Promise<FilingReceipt> {
  const receipt = await fileReport(PROJECT, submission(message), assertionOf(email), w);
  if (isRefusal(receipt)) throw new Error(receipt.refusal);
  return receipt;
}
