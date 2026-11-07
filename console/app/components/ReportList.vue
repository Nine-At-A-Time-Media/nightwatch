<template>
  <p v-if="reports.length === 0" data-testid="report-list-empty">You have not filed any reports.</p>
  <table v-else>
    <caption>
      Your reports
    </caption>
    <thead>
      <tr>
        <th scope="col">Reference</th>
        <th scope="col">Message</th>
        <th scope="col">Status</th>
        <th scope="col">Filed</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="report in reports" :key="report.reportId" data-testid="report-list-entry">
        <td>
          <a :href="followUpPath(report.reference)">{{ report.reference }}</a>
        </td>
        <td>{{ report.message }}</td>
        <td data-testid="report-list-status">{{ statusLabel(report.status) }}</td>
        <td>
          <time :datetime="isoInstant(report.filedAt)">{{ utcMinute(report.filedAt) }}</time>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
// The reporter's own Reports, each linked to its Follow-up Page by the
// Report Reference minted for this listing.
import type { ReportListEntry } from '#nightwatch/domain/report/filing.js';
import { followUpPath, isoInstant, statusLabel, utcMinute } from '../utils/format';

defineProps<{ reports: readonly ReportListEntry[] }>();
</script>
