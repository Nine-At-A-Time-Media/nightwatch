<template>
  <main>
    <h1>Nightwatch</h1>
    <ul>
      <li><NuxtLink to="/my-reports">My reports</NuxtLink></li>
    </ul>
  </main>
</template>

<script setup lang="ts">
// The console's landing page; a Project's Issues are at /projects/<project>/issues.
useHead({ title: 'Nightwatch' });
</script>
