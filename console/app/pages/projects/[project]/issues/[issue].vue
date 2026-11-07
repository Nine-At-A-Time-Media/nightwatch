<template>
  <main>
    <p v-if="error" role="alert">This issue was not found, or you are not a member of its project.</p>
    <template v-else-if="data">
      <h1>{{ data.title ?? 'User report' }}</h1>
      <p>{{ data.culprit }}</p>
      <dl>
        <dt>Status</dt>
        <dd data-testid="issue-status">{{ data.state.status }}</dd>
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
// One Issue for a Member: its summary, every Comment (shared or private),
// a comment box marked shared or private, and opening a GitHub issue.
// Resolve, archive and unresolve are not offered: no triage use case is
// reachable from the console yet.
import type { IssueView } from '#nightwatch/application/issues/view-issue.js';
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

useHead({ title: 'Issue' });

function refusalOf(caught: unknown): string {
  const data = (caught as { data?: { refusal?: string } }).data;
  return data?.refusal ?? 'unavailable';
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
