<script setup lang="ts">
defineProps<{ type: string }>()
</script>

<template>
  <svg class="hardware-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="type === 'system'">
      <rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>
    </template>
    <template v-else-if="type === 'cpu'">
      <rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>
    </template>
    <template v-else-if="type === 'board'">
      <rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="7" height="7" rx="1"/><path d="M17 7h1m-1 4h1m-5 6v1H8v-1m9 0h1"/>
    </template>
    <template v-else-if="type === 'memory'">
      <rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10v4m3-4v4m4-4v4m3-4v4M7 17v2m3-2v2m4-2v2m3-2v2"/>
    </template>
    <template v-else-if="type === 'gpu'">
      <path d="M3 6h16a2 2 0 0 1 2 2v8H3zM3 9H1m2 4H1m6 3v3m10-3v3"/><circle cx="12" cy="11" r="3"/><path d="M12 8v6m-3-3h6"/>
    </template>
    <template v-else-if="type === 'storage' || type === 'disk'">
      <rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="10" r="4"/><circle cx="12" cy="10" r="1"/><path d="M8 18h8"/>
    </template>
    <template v-else-if="type === 'display'">
      <rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 8h10"/>
    </template>
    <template v-else-if="type === 'network'">
      <path d="M5 12.5a10 10 0 0 1 14 0M8 16a6 6 0 0 1 8 0M11 19.5a2 2 0 0 1 2 0"/><circle cx="12" cy="21" r=".5" fill="currentColor" stroke="none"/>
    </template>
    <template v-else>
      <circle cx="12" cy="12" r="9"/><path d="M9 12h6M12 9v6"/>
    </template>
  </svg>
</template>
