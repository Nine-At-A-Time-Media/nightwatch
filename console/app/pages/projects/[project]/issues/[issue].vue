<template>
  <main>
    <p v-if="error" role="alert">This issue was not found, or you are not a member of its project.</p>
    <template v-else-if="data">
      <h1>
        <span data-testid="issue-short-id">{{ data.shortId }}</span>
        {{ data.title ?? 'User report' }}
      </h1>
      <p>{{ data.culprit }}</p>
      <dl>
        <dt>Status</dt>
        <dd data-testid="issue-status">
          {{ 'substatus' in data.state ? `${data.state.status} (${data.state.substatus})` : data.state.status }}
        </dd>
        <dt>Priority</dt>
        <dd>
          <label for="issue-priority">Priority</label>
          <select id="issue-priority" :value="data.state.priority.level" @change="handlePriority">
            <option v-for="level in PRIORITY_LEVELS" :key="level" :value="level">{{ level }}</option>
          </select>
        </dd>
        <dt>Events</dt>
        <dd>{{ data.state.count }}</dd>
        <dt>Users</dt>
        <dd>{{ data.state.userCount }}</dd>
        <dt>First seen</dt>
        <dd>{{ utcMinute(data.state.firstSeen) }}</dd>
        <dt>Last seen</dt>
        <dd>{{ utcMinute(data.state.lastSeen) }}</dd>
        <dt>GitHub</dt>
        <dd>
          {{
            data.externalLink ? `${data.externalLink.repository}#${data.externalLink.number} (${data.externalLink.state})` : 'not linked'
          }}
        </dd>
      </dl>

      <section aria-label="Triage">
        <template v-if="data.state.status === 'unresolved'">
          <button type="button" @click="triage({ kind: 'resolve', resolution: { kind: 'plain' } })">Resolve</button>
          <button type="button" @click="triage({ kind: 'resolve', resolution: { kind: 'in_next_release' } })">
            Resolve in next release
          </button>
          <label for="issue-archive">Archive</label>
          <select id="issue-archive" v-model="archiveChoice">
            <option value="until_escalating">until escalating</option>
            <option value="forever">forever</option>
          </select>
          <button type="button" @click="handleArchive">Archive</button>
        </template>
        <button v-if="data.state.status === 'resolved'" type="button" @click="triage({ kind: 'unresolve' })">Unresolve</button>
        <button v-if="data.state.status === 'archived'" type="button" @click="triage({ kind: 'unarchive' })">Unarchive</button>
        <button v-if="data.state.forReviewSince !== null" type="button" @click="triage({ kind: 'mark_reviewed' })">Mark reviewed</button>
        <button type="button" @click="handleAssignToMe">Assign to me</button>
      </section>

      <h2>Comments</h2>
      <ol>
        <li v-for="comment in data.comments" :key="comment.id">
          <strong>{{ 'member' in comment.author ? 'Member' : 'Reporter' }}</strong>
          <span>{{ comment.shared ? 'shared with reporters' : 'private' }}</span>
          <time :datetime="isoInstant(comment.at)">{{ utcMinute(comment.at) }}</time>
          <p>{{ comment.text }}</p>
        </li>
      </ol>

      <form @submit.prevent="handleComment">
        <label for="issue-comment">Comment</label>
        <textarea id="issue-comment" v-model="comment" rows="4" required />
        <label>
          <input v-model="shared" type="checkbox" />
          Shared with the reporters
        </label>
        <button type="submit">Save comment</button>
      </form>

      <form v-if="!data.externalLink" @submit.prevent="handleGitHub">
        <label for="issue-repository">Repository (owner/name)</label>
        <input id="issue-repository" v-model="repository" required />
        <button type="submit">Open GitHub issue</button>
      </form>
      <p v-if="actionRefusal" role="alert">That did not work: {{ actionRefusal }}.</p>
    </template>
  </main>
</template>

<script setup lang="ts">
// One Issue for a Member: its summary and Short Id, the triage actions
// (resolve, resolve in next release, archive, unresolve, unarchive, mark
// reviewed, Priority, assign to me), every Comment (shared or private), a
// comment box marked shared or private, and opening a GitHub issue.
import type { IssueView } from '#nightwatch/application/issues/view-issue.js';
import type { PriorityLevel } from '#nightwatch/domain/issue/priority.js';
import type { TriageAction } from '#nightwatch/domain/issue/triage.js';
import { isoInstant, utcMinute } from '../../../../utils/format';

const route = useRoute();
const base = computed(
  () =>
    `/api/projects/${encodeURIComponent(String(route.params['project'] ?? ''))}/issues/${encodeURIComponent(String(route.params['issue'] ?? ''))}`,
);
const { data, error, refresh } = await useFetch<IssueView>(base);
const comment = ref('');
const shared = ref(false);
const repository = ref('');
const actionRefusal = ref<string | null>(null);
const archiveChoice = ref<'until_escalating' | 'forever'>('until_escalating');

const PRIORITY_LEVELS: readonly PriorityLevel[] = ['low', 'medium', 'high'];

useHead({ title: 'Issue' });

function refusalOf(caught: unknown): string {
  const data = (caught as { data?: { refusal?: string } }).data;
  return data?.refusal ?? 'unavailable';
}

async function post(path: string, body: Record<string, unknown>): Promise<void> {
  actionRefusal.value = null;
  try {
    await $fetch(`${base.value}/${path}`, { method: 'POST', body });
    await refresh();
  } catch (caught) {
    actionRefusal.value = refusalOf(caught);
  }
}

async function triage(action: TriageAction): Promise<void> {
  await post('triage', action);
}

async function handleArchive(): Promise<void> {
  await triage({ kind: 'archive', archive: { substatus: archiveChoice.value } });
}

async function handlePriority(event: Event): Promise<void> {
  const level = (event.target as HTMLSelectElement).value as PriorityLevel;
  await triage({ kind: 'set_priority', level });
}

async function handleAssignToMe(): Promise<void> {
  await post('assign', { assignee: 'me' });
}

async function handleComment(): Promise<void> {
  actionRefusal.value = null;
  try {
    await $fetch(`${base.value}/comments`, { method: 'POST', body: { text: comment.value, shared: shared.value } });
    comment.value = '';
    shared.value = false;
    await refresh();
  } catch (caught) {
    actionRefusal.value = refusalOf(caught);
  }
}

async function handleGitHub(): Promise<void> {
  actionRefusal.value = null;
  try {
    await $fetch(`${base.value}/github`, { method: 'POST', body: { repository: repository.value } });
    await refresh();
  } catch (caught) {
    actionRefusal.value = refusalOf(caught);
  }
}
</script>
