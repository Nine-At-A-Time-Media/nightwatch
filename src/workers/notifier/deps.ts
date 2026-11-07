/**
 * The notifier Worker's wiring: the one place that names the concrete adapter
 * behind each port its use cases take, and reads the notifier settings from
 * the Worker's vars and its secrets from its environment (architecture
 * Parameters placed). Only the local stage has its adapters; any other stage
 * is refused rather than silently given a stand-in.
 */

import type { NotifyFollowersDeps } from '../../application/alerts/notify-followers.js';
import type { EvaluateIssueAlertsDeps } from '../../application/alerts/evaluate-issue-alerts.js';
import type { SuggestOwnersDeps } from '../../application/issues/suggest-owners.js';
import type { NotifyReportersDeps } from '../../application/reports/notify-reporters.js';
import type { PushIssueChangeDeps } from '../../application/tracker/push-issue-change.js';
import { D1ControlStore } from '../../adapters/d1/d1-control-store.js';
import { DurableProjectClient, type ProjectNamespace } from '../../adapters/do/durable-project-client.js';
import { DurableDigestQueue, type DigestNamespace } from '../../adapters/do/durable-digest-queue.js';
import { EmailChannel } from '../../adapters/email/email-channel.js';
import { SendEmailMailer } from '../../adapters/email/send-email-mailer.js';
import { R2BlobStore } from '../../adapters/r2/r2-blob-store.js';
import { RandomIds } from '../../adapters/runtime/random-ids.js';
import { SystemClock } from '../../adapters/runtime/system-clock.js';
import { HmacSigner } from '../../adapters/webcrypto/hmac-signer.js';
import { WebhookChannel } from '../../adapters/webhook/webhook-channel.js';
import { digestPolicy, type DigestPolicy } from '../../domain/alerts/digest.js';
import { isRefusal } from '../../domain/refusal.js';
import type { BlobStore } from '../../ports/blob-store.js';
import type { Clock } from '../../ports/clock.js';
import type { Mailer } from '../../ports/mailer.js';
import { githubCodeHost, githubTracker, trackerSettings, type GitHubAppBindings } from '../shared/github.js';
import { positiveSetting, requireLocalStage, secretSetting, textSetting } from '../shared/settings.js';

/** The Worker's bindings with its secrets, and its Durable Object namespaces as the clients use them. */
export type NotifierBindings = Omit<NotifierEnv, 'PROJECT' | 'DIGEST'> &
  GitHubAppBindings & {
    readonly PROJECT: ProjectNamespace;
    readonly DIGEST: DigestNamespace;
    /** Worker secret: signs Reply Tokens; inbound-mail verifies with the same. */
    readonly REPLY_TOKEN_SECRET?: string;
  };

/** Every port and setting the notifier's steps hand their use cases. */
export type NotifierRuntime = {
  readonly reporters: NotifyReportersDeps;
  readonly followers: NotifyFollowersDeps;
  readonly alerts: EvaluateIssueAlertsDeps;
  readonly tracker: PushIssueChangeDeps;
  readonly owners: SuggestOwnersDeps;
  readonly blobs: BlobStore;
  /** Where fanned-out step messages go: the `effects` queue itself. */
  readonly effects: Queue;
};

/** What DigestDO's alarm hands deliverDigest, and how soon an unsent Digest is tried again. */
export type DigestRuntime = { readonly mailer: Mailer; readonly clock: Clock; readonly policy: DigestPolicy; readonly retryMs: number };

const DIGESTS_ON = 'on';

// --- settings ---

export function notifierDigestPolicy(env: NotifierBindings): DigestPolicy {
  const policy = digestPolicy({
    minimumDelayMs: positiveSetting({ name: 'DIGEST_MINIMUM_DELAY_MS', value: env.DIGEST_MINIMUM_DELAY_MS }),
    incrementMs: positiveSetting({ name: 'DIGEST_INCREMENT_MS', value: env.DIGEST_INCREMENT_MS }),
    maximumDelayMs: positiveSetting({ name: 'DIGEST_MAXIMUM_DELAY_MS', value: env.DIGEST_MAXIMUM_DELAY_MS }),
  });
  if (isRefusal(policy)) throw new Error(`notifier DigestPolicy is invalid: ${policy.refusal}`);
  return policy;
}

// --- wiring ---

function mailerOf(env: NotifierBindings): Mailer {
  return new SendEmailMailer({ binding: env.EMAIL, from: textSetting({ name: 'MAIL_FROM', value: env.MAIL_FROM }) });
}

export function digestRuntime(env: NotifierBindings): DigestRuntime {
  requireLocalStage({ worker: 'notifier', stage: env.STAGE });
  return {
    mailer: mailerOf(env),
    clock: new SystemClock(),
    policy: notifierDigestPolicy(env),
    retryMs: positiveSetting({ name: 'DIGEST_RETRY_MS', value: env.DIGEST_RETRY_MS }),
  };
}

export function notifierRuntime(env: NotifierBindings): NotifierRuntime {
  requireLocalStage({ worker: 'notifier', stage: env.STAGE });
  const clock = new SystemClock();
  const control = new D1ControlStore(env.CONTROL);
  const projects = new DurableProjectClient({ namespace: env.PROJECT });
  const mailer = mailerOf(env);
  const tracker = trackerSettings(env);
  return {
    reporters: {
      projects,
      control,
      mailer,
      ids: new RandomIds(),
      clock,
      settings: {
        followUpBaseUrl: textSetting({ name: 'FOLLOW_UP_BASE_URL', value: env.FOLLOW_UP_BASE_URL }),
        maxMessageLength: positiveSetting({ name: 'REPORT_MAX_MESSAGE_LENGTH', value: env.REPORT_MAX_MESSAGE_LENGTH }),
        spamThreshold: positiveSetting({ name: 'SPAM_THRESHOLD', value: env.SPAM_THRESHOLD }),
      },
    },
    followers: {
      control,
      projects,
      mailer,
      signer: new HmacSigner(secretSetting({ name: 'REPLY_TOKEN_SECRET', value: env.REPLY_TOKEN_SECRET })),
      clock,
      settings: {
        mailDomain: textSetting({ name: 'MAIL_DOMAIN', value: env.MAIL_DOMAIN }),
        replyDomain: textSetting({ name: 'REPLY_DOMAIN', value: env.REPLY_DOMAIN }),
        replyLifetimeMs: positiveSetting({ name: 'REPLY_LIFETIME_MS', value: env.REPLY_LIFETIME_MS }),
      },
    },
    alerts: {
      control,
      projects,
      channels: [new EmailChannel(mailer), new WebhookChannel((input, init) => fetch(input, init))],
      digests: env.DIGESTS === DIGESTS_ON ? new DurableDigestQueue({ namespace: env.DIGEST }) : null,
      clock,
      settings: { deliveryAttempts: positiveSetting({ name: 'DELIVERY_ATTEMPTS', value: env.DELIVERY_ATTEMPTS }) },
    },
    tracker: { tracker: githubTracker(env, clock), projects, control, settings: tracker },
    owners: {
      control,
      codeHost: githubCodeHost(env, clock),
      projects,
      settings: { suspectCommitWindow: positiveSetting({ name: 'SUSPECT_COMMIT_WINDOW_MS', value: env.SUSPECT_COMMIT_WINDOW_MS }) },
    },
    blobs: new R2BlobStore(env.BLOBS),
    effects: env.EFFECTS,
  };
}
