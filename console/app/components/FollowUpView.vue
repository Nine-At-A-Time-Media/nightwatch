<template>
  <section aria-labelledby="follow-up-heading">
    <h1 id="follow-up-heading">Your report</h1>
    <p v-if="refusal === 'unsigned'" data-testid="follow-up-unsigned">Sign in to see this report.</p>
    <p v-else-if="view === null" data-testid="follow-up-not-found">This report was not found.</p>
    <template v-else>
      <p>
        Status:
        <strong data-testid="follow-up-status">{{ statusLabel(view.status) }}</strong>
      </p>

      <h2>History</h2>
      <ol>
        <li v-for="(change, index) in view.changes" :key="index" data-testid="follow-up-change">
          {{ statusLabel(change.status) }} <time :datetime="isoInstant(change.at)">{{ utcMinute(change.at) }}</time>
        </li>
      </ol>

      <h2>Conversation</h2>
      <p v-if="view.thread.length === 0">No messages yet.</p>
      <ol v-else>
        <li v-for="(entry, index) in view.thread" :key="index" data-testid="follow-up-thread-entry">
          <strong>{{ entry.author === 'team' ? 'Team' : 'You' }}</strong>
          <time :datetime="isoInstant(entry.at)">{{ utcMinute(entry.at) }}</time>
          <p>{{ entry.text }}</p>
        </li>
      </ol>

      <form @submit.prevent="handleSubmit">
        <label for="follow-up-reply">Reply to the team</label>
        <textarea id="follow-up-reply" v-model="draft" data-testid="follow-up-reply-text" rows="4" required />
        <button type="submit" data-testid="follow-up-reply-submit">Send reply</button>
      </form>
    </template>
  </section>
</template>

<script setup lang="ts">
// The Follow-up Page's body: the Report Status, its change dates and the
// shared Thread from the Follow-up View, and a reply box. It shows nothing
// the view does not hold; a refused reference reads "not found" whatever
// the reason, except a missing sign-in.
import { ref } from 'vue';
import type { FollowUpView } from '#nightwatch/domain/report/thread.js';
import { isoInstant, statusLabel, utcMinute } from '../utils/format';

defineProps<{ view: FollowUpView | null; refusal: string | null }>();
const emit = defineEmits<{ reply: [text: string] }>();

const draft = ref('');

function handleSubmit(): void {
  const text = draft.value.trim();
  if (text === '') return;
  emit('reply', text);
  draft.value = '';
}
</script>
