<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

/*
 * 冻结式取色：进入取色时主进程为每个显示器抓一帧快照，这里铺满屏幕当作底图。
 * 之后取色、放大预览全在本地画布完成——鼠标移动零 IPC、零重复截屏，
 * 彻底告别旧实现「每次移动都整屏抓图」的卡顿。代价是取色期间画面冻结，
 * 这也是系统级取色器的通用做法。
 *
 * 坐标换算：覆盖层的 CSS 像素 = 显示器 bounds（DIP），快照是设备像素，
 * 二者相差一个 devicePixelRatio；鼠标坐标 ×DPR 向下取整即为快照像素下标。
 */
const displayId = Number(new URLSearchParams(location.search).get('displayId'))
const dpr = window.devicePixelRatio || 1

// 快照画布（离屏，仅用于 getImageData / drawImage 取像素）与放大的展示画布。
const viewCanvas = ref<HTMLCanvasElement | null>(null)
const loupeCanvas = ref<HTMLCanvasElement | null>(null)

// 放大镜：视野边长取奇数，中心像素正好落在正中间。
const FIELD = 21
const ZOOM = 12
// 放大镜的物理边长（CSS 像素）。画布后备缓冲再按 DPR 放大，保证 HiDPI 下像素边缘锐利。
const loupeSize = FIELD * ZOOM
const loupeBuffer = Math.round(loupeSize * dpr)

const source = ref<{ data: Uint8ClampedArray; width: number; height: number } | null>(null)
const cursor = ref({ x: -100, y: -100 })
const sample = ref({ color: '#000000', x: 0, y: 0 })
const ready = ref(false)
const failed = ref('')

let offscreen: HTMLCanvasElement | null = null
let frame = 0

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`

function drawLoupe(px: number, py: number) {
  const ctx = loupeCanvas.value?.getContext('2d')
  const src = source.value
  if (!ctx || !src || !offscreen) return
  // 后备缓冲按 DPR 放大，绘制统一用 CSS 坐标；关闭平滑 → nearest-neighbor，
  // 放大后是清晰的方块像素而非糊成一团。
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  const half = Math.floor(FIELD / 2)
  const ox = Math.min(Math.max(px - half, 0), Math.max(0, src.width - FIELD))
  const oy = Math.min(Math.max(py - half, 0), Math.max(0, src.height - FIELD))
  ctx.clearRect(0, 0, loupeSize, loupeSize)
  ctx.drawImage(offscreen, ox, oy, FIELD, FIELD, 0, 0, loupeSize, loupeSize)
  // 高亮当前取色的那一个像素；贴边时视野整体平移，故按像素在窗口内的实际偏移定位。
  const center = (px - ox) * ZOOM
  const centerY = (py - oy) * ZOOM
  ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1
  ctx.strokeRect(center + 0.5, centerY + 0.5, ZOOM - 1, ZOOM - 1)
  ctx.strokeStyle = 'rgba(0,0,0,.55)'
  ctx.strokeRect(center - 0.5, centerY - 0.5, ZOOM + 1, ZOOM + 1)
}

function update(px: number, py: number) {
  const src = source.value
  if (!src) return
  const x = Math.min(Math.max(px, 0), src.width - 1)
  const y = Math.min(Math.max(py, 0), src.height - 1)
  sample.value = { color: colorAt(x, y), x, y }
  drawLoupe(x, y)
}

// 从快照原始字节取一个像素；与 update / choose 共用，保证预览与最终结果同源同值。
function colorAt(x: number, y: number): string {
  const src = source.value
  if (!src) return '#000000'
  const offset = (y * src.width + x) * 4
  return hex(src.data[offset], src.data[offset + 1], src.data[offset + 2])
}

function move(event: PointerEvent) {
  cursor.value = { x: event.clientX, y: event.clientY }
  const px = Math.floor(event.clientX * dpr)
  const py = Math.floor(event.clientY * dpr)
  // 合并到下一帧再算，密集移动时每个刷新周期只取样一次。
  if (frame) return
  frame = requestAnimationFrame(() => { frame = 0; update(px, py) })
}

const cancel = () => window.screenColorPicker?.cancel()
function choose(event: PointerEvent) {
  if (event.button !== 0) { cancel(); return }
  const src = source.value
  if (!src) return
  // 按点击坐标即时算色，不依赖可能滞后一帧的预览值。
  const x = Math.min(Math.max(Math.floor(event.clientX * dpr), 0), src.width - 1)
  const y = Math.min(Math.max(Math.floor(event.clientY * dpr), 0), src.height - 1)
  window.screenColorPicker?.choose(colorAt(x, y))
}
const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }

onMounted(async () => {
  window.addEventListener('keydown', handleKey)
  try {
    const snap = await window.screenColorPicker?.snapshot(displayId)
    if (!snap) throw new Error('未获取到屏幕画面')
    // 主进程传的是 Node Buffer，跨 IPC 到渲染层按 Uint8Array 处理；包一层保证是标准视图。
    const bytes = new Uint8ClampedArray(snap.image.buffer, snap.image.byteOffset, snap.image.byteLength)
    source.value = { data: bytes, width: snap.width, height: snap.height }
    offscreen = document.createElement('canvas')
    offscreen.width = snap.width; offscreen.height = snap.height
    offscreen.getContext('2d')!.putImageData(new ImageData(bytes, snap.width, snap.height), 0, 0)
    // 把快照作为可见底图铺满（位图尺寸=设备像素，与屏幕物理像素 1:1）。
    const view = viewCanvas.value
    if (view) {
      view.width = snap.width; view.height = snap.height
      view.getContext('2d')!.drawImage(offscreen, 0, 0)
    }
    ready.value = true
  } catch (error) {
    failed.value = error instanceof Error ? error.message : String(error)
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKey)
  if (frame) cancelAnimationFrame(frame)
  offscreen = null
})

const loupeStyle = computed(() => {
  // 靠近屏幕右/下边缘时把放大镜翻到光标另一侧，避免被裁掉。
  const flipX = cursor.value.x + loupeSize + 40 > window.innerWidth
  const flipY = cursor.value.y + loupeSize + 110 > window.innerHeight
  return {
    left: `${cursor.value.x + (flipX ? -(loupeSize + 20) : 20)}px`,
    top: `${cursor.value.y + (flipY ? -(loupeSize + 90) : 20)}px`
  }
})
</script>

<template>
  <main class="screen-color-picker" @pointermove="move" @pointerdown.prevent="choose" @contextmenu.prevent="cancel">
    <canvas ref="viewCanvas" class="screen-color-picker__view" />
    <p v-if="failed" class="screen-color-picker__error">取色失败：{{ failed }}</p>

    <div class="screen-color-picker__cursor" :style="{ left: `${cursor.x}px`, top: `${cursor.y}px` }"><i></i></div>

    <div class="screen-color-picker__loupe" :style="loupeStyle">
      <canvas ref="loupeCanvas" :width="loupeBuffer" :height="loupeBuffer" :style="{ width: `${loupeSize}px`, height: `${loupeSize}px` }" class="screen-color-picker__loupe-canvas" />
      <div class="screen-color-picker__readout">
        <span class="screen-color-picker__swatch" :style="{ backgroundColor: sample.color }"></span>
        <strong>{{ sample.color }}</strong>
        <em>{{ sample.x }}, {{ sample.y }}</em>
      </div>
    </div>

    <aside v-if="ready && !failed" class="screen-color-picker__hint">移动鼠标取样 · 单击确认并复制 · 右键 / Esc 取消</aside>
  </main>
</template>
