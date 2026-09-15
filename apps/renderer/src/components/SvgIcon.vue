<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ name: string; label?: string }>()
const symbolId = computed(() => `#icon-${props.name}`)
</script>

<template>
  <svg class="svg-icon" aria-hidden="true" focusable="false"><use :href="symbolId" /></svg>
</template>
