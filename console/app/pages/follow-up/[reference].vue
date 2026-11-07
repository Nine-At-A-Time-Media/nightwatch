<template>
  <main>
    <FollowUpView :view="data ?? null" :refusal="refusal" @reply="handleReply" />
    <p v-if="replyRefusal" role="alert" data-testid="follow-up-reply-refused">Your reply was not sent.</p>
  </main>
</template>

<script setup lang="ts">
// The Follow-up Page of a Report Reference (design Reports, Follow-up Page):
// the API answers the Follow-up View, or a Refusal the view reads as "not
// found" or "sign in". A reply posts to the API and reloads the view.
import type { FollowUpView as View } from '#nightwatch/domain/report/thread.js';
import FollowUpView from '../../components/FollowUpView.vue';

const route = useRoute();
const reference = computed(() => String(route.params['reference'] ?? ''));
const { data, error, refresh } = await useFetch<View>(() => `/api/follow-up/${encodeURIComponent(reference.value)}`);
const refusal = computed(() => (error.value ? ((error.value.data as { refusal?: string } | undefined)?.refusal ?? 'not-found') : null));
const replyRefusal = ref(false);

useHead({ title: 'Your report' });

async function handleReply(text: string): Promise<void> {
  replyRefusal.value = false;
  try {
    await $fetch(`/api/follow-up/${encodeURIComponent(reference.value)}/reply`, { method: 'POST', body: { text } });
    await refresh();
  } catch {
    replyRefusal.value = true;
  }
}
</script>
