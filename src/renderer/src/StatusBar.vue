<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
const text = ref('正在读取硬件状态…')
let unsubscribe: (() => void) | undefined
onMounted(() => { unsubscribe = window.hardwareMonitor.subscribeStatus((next) => { text.value = next }) })
onUnmounted(() => unsubscribe?.())
</script>
<template><main class="status-bar">{{ text }}</main></template>
