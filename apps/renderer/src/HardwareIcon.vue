<script setup lang="ts">
import { computed } from 'vue'
import SvgIcon from './components/SvgIcon.vue'

const props = defineProps<{ type: string }>()
const supportedTypes = new Set(['system', 'cpu', 'board', 'memory', 'gpu', 'storage', 'display', 'network'])
const iconName = computed(() => `hardware-${props.type === 'disk' ? 'storage' : supportedTypes.has(props.type) ? props.type : 'default'}`)
</script>

<template>
  <SvgIcon class="hardware-icon" :name="iconName" />
</template>
