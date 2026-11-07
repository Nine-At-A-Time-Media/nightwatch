<template>
  <main>
    <h1>My reports</h1>
    <p v-if="error" data-testid="my-reports-unsigned">Sign in to see your reports.</p>
    <ReportList v-else :reports="data?.reports ?? []" />
  </main>
</template>

<script setup lang="ts">
// The reporter's own Reports in every Organization that trusts their
// sign-in (design Reports, My reports).
import type { ReportList as List } from '#nightwatch/domain/report/filing.js';
import ReportList from '../components/ReportList.vue';

const { data, error } = await useFetch<List>('/api/my-reports');

useHead({ title: 'My reports' });
</script>
