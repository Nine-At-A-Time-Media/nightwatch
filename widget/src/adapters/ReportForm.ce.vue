<template>
  <div class="nightwatch-report">
    <button v-if="state.phase === 'idle'" type="button" class="trigger" data-testid="report-trigger" @click="handleOpen">
      Report a problem
    </button>
    <div v-else role="dialog" :aria-labelledby="titleId" class="dialog" data-testid="report-dialog">
      <h2 :id="titleId">Report a problem</h2>
      <div v-if="state.phase === 'sent'" class="receipt">
        <p role="status" data-testid="report-sent">Report sent</p>
        <p>
          Your reference: <strong data-testid="report-reference">{{ state.receipt.reference }}</strong>
        </p>
        <p>
          <a :href="state.receipt.followUpUrl" target="_blank" rel="noopener noreferrer" data-testid="report-follow-up"
            >Follow this report</a
          >
        </p>
        <div class="actions">
          <button type="button" data-testid="report-close" @click="handleCancel">Close</button>
        </div>
      </div>
      <form v-else novalidate :aria-busy="state.phase === 'sending'" @submit.prevent="handleSubmit">
        <label :for="messageId">What went wrong?</label>
        <textarea
          :id="messageId"
          :value="draft.message"
          required
          aria-required="true"
          :aria-invalid="shownRefusal !== null"
          :aria-describedby="shownRefusal !== null ? failureId : undefined"
          rows="5"
          :disabled="state.phase === 'sending'"
          data-testid="report-message"
          @input="handleMessage"
        ></textarea>
        <label :for="screenshotId">Screenshot (optional)</label>
        <input
          :id="screenshotId"
          type="file"
          accept="image/png,image/jpeg"
          :disabled="state.phase === 'sending'"
          data-testid="report-screenshot"
          @change="handleScreenshot"
        />
        <p v-if="shownRefusal !== null" :id="failureId" role="alert" class="failure" data-testid="report-failure">
          {{ failureWording(shownRefusal) }}
        </p>
        <div class="actions">
          <button v-if="canRetry" type="button" class="primary" data-testid="report-retry" @click="handleSubmit">Retry</button>
          <button v-else type="submit" :disabled="state.phase === 'sending'" data-testid="report-submit">Submit</button>
          <button type="button" :disabled="state.phase === 'sending'" data-testid="report-cancel" @click="handleCancel">Cancel</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ReportForm -- the Report Form as a Vue component, registered by
 * src/main.ts as <nightwatch-report>. Drives the pure state machine in
 * domain/report-form.ts and sends through the injected ReportSender. Asks
 * only for a message and an optional screenshot; never for who the reporter is.
 */
import { computed, inject, shallowRef, useId } from 'vue';
import { isRefusal, refusal, type Refusal } from '../domain/refusal.js';
import {
  failureWording,
  isRetryable,
  nextReportFormState,
  submissionOf,
  type FilingReceipt,
  type ReportDraft,
  type ReportFormEvent,
  type ReportFormState,
  type ReportSubmission,
  type SubmissionLimits,
} from '../domain/report-form.js';
import type { ReportSender } from '../ports/report-sender.js';
import { reportSenderKey } from './report-sender-key.js';

const props = defineProps<{
  endpoint: string;
  project: string;
  associatedEvent?: string;
  maxMessageLength?: number;
}>();

const injected = inject(reportSenderKey);
if (injected === undefined) throw new Error('nightwatch-report: no ReportSender was provided');
const sender: ReportSender = injected;

const titleId = `nw-title-${useId()}`;
const messageId = `nw-message-${useId()}`;
const screenshotId = `nw-screenshot-${useId()}`;
const failureId = `nw-failure-${useId()}`;

// Shallow: states are immutable values, and a File must reach the sender as itself, not a reactive proxy.
const state = shallowRef<ReportFormState>({ phase: 'idle' });

// No bound from the page means no bound here; the server still enforces its own.
const limits = computed<SubmissionLimits>(() => ({
  maxMessageLength: Number.isFinite(props.maxMessageLength) ? Number(props.maxMessageLength) : Number.POSITIVE_INFINITY,
}));

const draft = computed<ReportDraft>(() =>
  state.value.phase === 'editing' || state.value.phase === 'sending' || state.value.phase === 'failed'
    ? state.value.draft
    : { message: '', screenshot: null },
);

const shownRefusal = computed<Refusal | null>(() =>
  state.value.phase === 'editing' || state.value.phase === 'failed' ? state.value.refusal : null,
);

const canRetry = computed<boolean>(() => state.value.phase === 'failed' && isRetryable(state.value.refusal));

function dispatch(event: ReportFormEvent): void {
  state.value = nextReportFormState(state.value, event, limits.value);
}

function handleOpen(): void {
  dispatch({ kind: 'open' });
}

function handleCancel(): void {
  dispatch({ kind: 'cancel' });
}

function handleMessage(event: Event): void {
  dispatch({ kind: 'edit', draft: { ...draft.value, message: (event.target as HTMLTextAreaElement).value } });
}

function handleScreenshot(event: Event): void {
  const files = (event.target as HTMLInputElement).files;
  dispatch({ kind: 'edit', draft: { ...draft.value, screenshot: files?.[0] ?? null } });
}

// A send that throws never reached Nightwatch: the reporter is told so and may retry.
async function sendSafely(submission: ReportSubmission): Promise<FilingReceipt | Refusal> {
  try {
    return await sender.send(props.endpoint, submission);
  } catch {
    return refusal('not-sent');
  }
}

async function send(submission: ReportSubmission): Promise<void> {
  const outcome = await sendSafely(submission);
  dispatch(isRefusal(outcome) ? { kind: 'failed', refusal: outcome } : { kind: 'sent', receipt: outcome });
}

async function handleSubmit(): Promise<void> {
  dispatch({ kind: 'submit' });
  if (state.value.phase !== 'sending') return;
  const submission = submissionOf({
    draft: state.value.draft,
    project: props.project,
    associatedEventId: props.associatedEvent ?? null,
    limits: limits.value,
  });
  if (isRefusal(submission)) return dispatch({ kind: 'failed', refusal: submission });
  await send(submission);
}
</script>

<style>
.nightwatch-report {
  font:
    14px/1.4 system-ui,
    sans-serif;
  color: #1b1b1f;
}
.trigger,
.actions button {
  font: inherit;
  padding: 0.4em 0.9em;
  border-radius: 6px;
  border: 1px solid #5b5bd6;
  background: #5b5bd6;
  color: #fff;
  cursor: pointer;
}
.actions button[type='button']:not(.primary) {
  background: #fff;
  color: #1b1b1f;
  border-color: #c4c4cc;
}
button:disabled {
  opacity: 0.6;
  cursor: progress;
}
button:focus-visible,
textarea:focus-visible,
input:focus-visible,
a:focus-visible {
  outline: 2px solid #5b5bd6;
  outline-offset: 2px;
}
.dialog {
  max-width: 28rem;
  padding: 1rem;
  border-radius: 8px;
  border: 1px solid #c4c4cc;
  background: #fff;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
}
.dialog h2 {
  margin: 0 0 0.75rem;
  font-size: 1.1em;
}
form {
  display: grid;
  gap: 0.5rem;
}
textarea {
  font: inherit;
  width: 100%;
  box-sizing: border-box;
}
.failure {
  margin: 0;
  color: #b3261e;
}
.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
