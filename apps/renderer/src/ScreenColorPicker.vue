<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const displayId = new URLSearchParams(location.search).get('displayId')
const cursor = ref({ x: -100, y: -100 })
const sample = ref({ color: '#000000', preview: '' })
let previewTimer: ReturnType<typeof setTimeout> | undefined
let latestPoint = { x: 0, y: 0 }
let requestId = 0

const cancel = () => window.screenColorPicker?.cancel()
const choose = (event: PointerEvent) => {
  if (event.button !== 0) { cancel(); return }
  window.screenColorPicker?.choose({ x: Math.round(window.screenX + event.clientX), y: Math.round(window.screenY + event.clientY) })
}
const refreshPreview = async () => {
  const id = ++requestId
  try {
    const next = await window.screenColorPicker?.preview(latestPoint)
    if (next && id === requestId) sample.value = next
  } catch { /* 鼠标跨屏时短暂失效，下一次移动会自动刷新。 */ }
}
const move = (event: PointerEvent) => {
  cursor.value = { x: event.clientX, y: event.clientY }
  latestPoint = { x: Math.round(window.screenX + event.clientX), y: Math.round(window.screenY + event.clientY) }
  if (!previewTimer) previewTimer = setTimeout(() => { previewTimer = undefined; void refreshPreview() }, 55)
}
const handleKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => { window.removeEventListener('keydown', handleKeydown); if (previewTimer) clearTimeout(previewTimer) })
</script>

<template>
  <main class="screen-color-picker" :data-display-id="displayId" @pointermove="move" @pointerdown.prevent="choose" @contextmenu.prevent="cancel">
    <div class="screen-color-picker__cursor" :style="{ left: `${cursor.x}px`, top: `${cursor.y}px` }"><i></i></div>
    <aside class="screen-color-picker__preview">
      <div class="screen-color-picker__magnifier"><img v-if="sample.preview" :src="sample.preview" alt="取色区域放大预览"><i></i></div>
      <div><small>实时取色</small><strong>{{ sample.color }}</strong><span :style="{ backgroundColor: sample.color }"></span><em>单击确认 · 右键取消</em></div>
    </aside>
  </main>
</template>
