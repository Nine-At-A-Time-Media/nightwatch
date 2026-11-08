<template>
  <main>
    <h1>Issues</h1>
    <form role="search" @submit.prevent="handleSearch">
      <label for="issue-search">Search issues</label>
      <input id="issue-search" v-model="draft" type="search" placeholder="is:unresolved" data-testid="issue-search-query" />
      <button type="submit">Search</button>
    </form>
    <p v-if="refusal" role="alert" data-testid="issue-search-refused">{{ refusalText }}</p>
    <p v-else-if="(data?.issues.length ?? 0) === 0">No issues match.</p>
    <table v-else>
      <caption>
        Issues, most recently seen first
      </caption>
      <thead>
        <tr>
          <th scope="col">Issue</th>
          <th scope="col">Status</th>
          <th scope="col">Events</th>
          <th scope="col">Users</th>
          <th scope="col">Last seen</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="issue in data?.issues ?? []" :key="issue.issueId" data-testid="issue-list-entry">
          <td>
            <NuxtLink :to="`/projects/${encodeURIComponent(issue.projectId)}/issues/${encodeURIComponent(issue.issueId)}`">
              {{ issue.shortId }} {{ issue.title }}
            </NuxtLink>
            <div>{{ issue.culprit }}</div>
          </td>
          <td>{{ issue.status }}</td>
          <td>{{ issue.count }}</td>
          <td>{{ issue.userCount }}</td>
          <td>
            <time :datetime="isoInstant(issue.lastSeen)">{{ utcMinute(issue.lastSeen) }}</time>
          </td>
        </tr>
      </tbody>
    </table>
    <NuxtLink v-if="data?.next" :to="{ query: { query: query, cursor: data.next } }">Next page</NuxtLink>
  </main>
</template>

<script setup lang="ts">
// A Member's Issue search (design Issues, Search). The query is the Issue
// Query language; the API searches the Member's Organization, so each
// result links to the Project that holds it.
import { isoInstant, utcMinute } from '../../../../utils/format';

type ListedIssue = {
  issueId: string;
  projectId: string;
  shortId: string;
  title: string;
  culprit: string;
  status: string;
  count: number;
  userCount: number;
  lastSeen: number;
};

const route = useRoute();
const project = computed(() => String(route.params['project'] ?? ''));
const query = computed(() => String(route.query['query'] ?? ''));
const cursor = computed(() => String(route.query['cursor'] ?? ''));
const draft = ref(query.value);

const { data, error } = await useFetch<{ issues: ListedIssue[]; next: string | null }>(
  () => `/api/projects/${encodeURIComponent(project.value)}/issues`,
  { query: { query, cursor } },
);
const refusal = computed(() => (error.value ? ((error.value.data as { refusal?: string } | undefined)?.refusal ?? 'unavailable') : null));
const refusalText = computed(() =>
  refusal.value === 'unsigned' || refusal.value === 'not_a_member' ? 'Sign in as a member of this project.' : 'That search could not run.',
);

useHead({ title: 'Issues' });

async function handleSearch(): Promise<void> {
  await navigateTo({ query: { query: draft.value } });
}
</script>
