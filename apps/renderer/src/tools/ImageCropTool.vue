<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ToolboxPage from '../ToolboxPage.vue'
import SvgIcon from '../components/SvgIcon.vue'

/*
 * 图片裁剪：在原图上直接拖拽框选。
 *
 * 坐标系始终以「原图像素」为准（crop 存原图像素，显示时乘缩放比），
 * 原图 URL 全程不被覆写，因此可以反复调整选框、切换规格重新导出。
 * 导出时才真正 drawImage 抠图，所见即所选。
 */
type Rect = { x: number; y: number; width: number; height: number }
type Corner = 'nw' | 'ne' | 'se' | 'sw'
type Edge = 'n' | 'e' | 's' | 'w'
type Handle = 'move' | 'draw' | Corner | Edge

const MIN_SIZE = 8
const maxImageFileSize = 100 * 1024 * 1024
const maxImagePixels = 12_000_000

// 常用证件照规格（300 dpi 换算像素）。选中后锁定比例，导出时缩放到精确像素。
const ID_SPECS = [
  { label: '一寸', note: '25×35mm', width: 295, height: 413 },
  { label: '大二寸', note: '35×53mm', width: 413, height: 626 },
  { label: '二寸', note: '35×49mm', width: 413, height: 579 },
  { label: '小一寸', note: '22×32mm', width: 260, height: 378 },
  { label: '大一寸', note: '33×48mm', width: 390, height: 567 },
  { label: '小二寸', note: '35×45mm', width: 413, height: 531 }
] as const
const ASPECTS = [
  { label: '自由', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 }
] as const

const router = useRouter()
const imageInput = ref<HTMLInputElement>()
const stageEl = ref<HTMLElement>()
const frameEl = ref<HTMLElement>()
const imageEl = ref<HTMLImageElement>()

const originalUrl = ref('')
const imageFile = ref<File>()
const imageInfo = ref<{ width: number; height: number }>()
const message = ref('选择或拖入一张本地图片，之后可直接在图上拖动框选裁剪区域。')
const crop = ref<Rect>({ x: 0, y: 0, width: 0, height: 0 })
const aspect = ref<number | null>(null)
const specLabel = ref('')
const exportFormat = ref<'image/png' | 'image/jpeg'>('image/png')
const jpegQuality = ref(0.92)
const error = ref(false)
const busy = ref(false)

const stageSize = ref({ width: 0, height: 0 })
const drag = ref<{ handle: Handle; origin: Rect; start: { x: number; y: number }; before: Rect } | null>(null)
let observer: ResizeObserver | undefined
let loadRequest = 0

const backToPortal = () => router.push({ name: 'portal' })
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`
const isSupportedImageFile = (file: File) => ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml'].includes(file.type.toLowerCase()) || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name)

// 图片按 contain 铺进舞台；frame 元素尺寸即显示尺寸，选框坐标换算只需再乘一个 scale。
const fit = computed(() => {
  const info = imageInfo.value
  const avail = stageSize.value
  if (!info || !avail.width || !avail.height) return { width: 0, height: 0, scale: 1 }
  const ratio = Math.min(avail.width / info.width, avail.height / info.height, 1)
  const width = Math.max(1, Math.round(info.width * ratio))
  return { width, height: Math.max(1, Math.round(info.height * ratio)), scale: width / info.width }
})
const frameStyle = computed(() => ({ width: `${fit.value.width}px`, height: `${fit.value.height}px` }))
const boxStyle = computed(() => {
  const s = fit.value.scale
  return { left: `${crop.value.x * s}px`, top: `${crop.value.y * s}px`, width: `${crop.value.width * s}px`, height: `${crop.value.height * s}px` }
})
const activeSpec = computed(() => ID_SPECS.find((item) => item.label === specLabel.value))
// 输出尺寸：证件照规格会缩放到精确像素，否则按选框原样输出。
const outputSize = computed(() => {
  const spec = activeSpec.value
  if (spec) return { width: spec.width, height: spec.height }
  return { width: crop.value.width, height: crop.value.height }
})
const outputHint = computed(() => `${outputSize.value.width} × ${outputSize.value.height} px`)
/*
 * 框上标签优先显示「导出尺寸」：证件照模式下用户关心的是"出来的是几寸"，
 * 而不是从原图截了多大一块（受原图分辨率限制，选区往往比目标大/小，导出时才缩放）。
 * 无规格时两者相同，直接显示选区像素。
 */
const boxLabel = computed(() => (activeSpec.value ? `${activeSpec.value.width} × ${activeSpec.value.height}` : `${crop.value.width} × ${crop.value.height}`))
// 证件照模式下选区会被缩放到精确像素，把"截自原图多大一块"作为次级信息一并显示。
const boxSourceLabel = computed(() => (activeSpec.value ? `截自 ${crop.value.width} × ${crop.value.height}` : ''))
const zoomedOut = computed(() => fit.value.scale > 0 && fit.value.scale < 0.999)
const viewPercent = computed(() => Math.round(fit.value.scale * 100))

// 夹到图片范围内；先夹尺寸再回推位置，保证一定落在边界内。
function fitRect(rect: Rect): Rect {
  const info = imageInfo.value
  if (!info) return rect
  const width = Math.min(Math.max(Math.round(rect.width), Math.min(MIN_SIZE, info.width)), info.width)
  const height = Math.min(Math.max(Math.round(rect.height), Math.min(MIN_SIZE, info.height)), info.height)
  const x = Math.min(Math.max(Math.round(rect.x), 0), info.width - width)
  const y = Math.min(Math.max(Math.round(rect.y), 0), info.height - height)
  return { x, y, width, height }
}

// 锁定比例时按当前框中心内切出最大合规框，避免切换预设后选框跑出画面。
function applyAspect(value: number | null, label = '') {
  aspect.value = value
  specLabel.value = label
  const info = imageInfo.value
  if (!value || !info) return
  const box = crop.value
  // 先在原框内取最大合规框，再依次按图片宽高夹取；每夹一边就重算另一边以维持比例。
  let width = box.width
  let height = width / value
  if (height > box.height) { height = box.height; width = height * value }
  if (width > info.width) { width = info.width; height = width / value }
  if (height > info.height) { height = info.height; width = height * value }
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  crop.value = fitRect({ x: centerX - width / 2, y: centerY - height / 2, width, height })
}

function selectSpec(spec: typeof ID_SPECS[number]) {
  if (specLabel.value === spec.label) { applyAspect(null); return }
  applyAspect(spec.width / spec.height, spec.label)
}

function measure() {
  const el = stageEl.value
  if (el) stageSize.value = { width: el.clientWidth, height: el.clientHeight }
}

// 舞台元素在图片载入后才渲染出来，onMounted 时还拿不到；改为观察这个 ref 本身。
// 必须 flush: 'post'——DOM 落位后才量得到尺寸。视口高度由 CSS 固定、宽度随父容器伸缩，
// 测量结果不依赖图片尺寸，不会自激振荡。
watch(stageEl, (el) => {
  observer?.disconnect()
  if (!el) return
  measure()
  if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(measure); observer.observe(el) }
}, { flush: 'post' })

function loadImage(file?: File) {
  const request = ++loadRequest
  if (!file) return
  if (!isSupportedImageFile(file)) { message.value = '请选择 PNG、JPEG、WebP、GIF、BMP 或 SVG 图片文件。'; error.value = true; return }
  if (file.size > maxImageFileSize) { message.value = '单张图片不能超过 100 MB。'; error.value = true; return }
  if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
  const url = URL.createObjectURL(file)
  originalUrl.value = url
  imageFile.value = file
  error.value = false
  const probe = new Image()
  probe.onload = () => {
    if (request !== loadRequest || url !== originalUrl.value) { URL.revokeObjectURL(url); return }
    if (!probe.naturalWidth || !probe.naturalHeight || probe.naturalWidth * probe.naturalHeight > maxImagePixels) {
      error.value = true
      message.value = '图片像素过大，请使用不超过 1200 万像素的图片。'
      imageInfo.value = undefined
      return
    }
    imageInfo.value = { width: probe.naturalWidth, height: probe.naturalHeight }
    // 载入即铺满，之后用户再怎么调都不会丢原图。
    crop.value = { x: 0, y: 0, width: probe.naturalWidth, height: probe.naturalHeight }
    if (aspect.value) applyAspect(aspect.value, specLabel.value)
    message.value = `已载入 ${probe.naturalWidth} × ${probe.naturalHeight}，在图上拖动即可框选。`
  }
  probe.onerror = () => { if (request !== loadRequest) return; error.value = true; message.value = '图片无法加载，请确认文件未损坏。'; imageInfo.value = undefined }
  probe.src = url
}

const onImageSelected = (event: Event) => { const input = event.target as HTMLInputElement; loadImage(input.files?.[0]); input.value = '' }
const onImageDropped = (event: DragEvent) => loadImage(event.dataTransfer?.files[0])

function imagePoint(event: PointerEvent) {
  const rect = frameEl.value!.getBoundingClientRect()
  const info = imageInfo.value!
  const scale = fit.value.scale
  return {
    x: Math.min(Math.max((event.clientX - rect.left) / scale, 0), info.width),
    y: Math.min(Math.max((event.clientY - rect.top) / scale, 0), info.height)
  }
}

const CORNERS: Record<Corner, { fromRight: boolean; fromBottom: boolean }> = {
  nw: { fromRight: true, fromBottom: true },
  ne: { fromRight: false, fromBottom: true },
  se: { fromRight: false, fromBottom: false },
  sw: { fromRight: true, fromBottom: false }
}

function resizeRect(handle: Edge | Corner, origin: Rect, dx: number, dy: number): Rect {
  const ratio = aspect.value
  const right = origin.x + origin.width
  const bottom = origin.y + origin.height
  if (handle === 'n' || handle === 's') {
    // 上下边：高由拖拽决定，宽按比例跟随并保持水平中心。
    const height = Math.max(MIN_SIZE, handle === 'n' ? bottom - (origin.y + dy) : origin.height + dy)
    const width = ratio ? height * ratio : origin.width
    return { x: origin.x + (origin.width - width) / 2, y: handle === 'n' ? bottom - height : origin.y, width, height }
  }
  if (handle === 'e' || handle === 'w') {
    const width = Math.max(MIN_SIZE, handle === 'w' ? right - (origin.x + dx) : origin.width + dx)
    const height = ratio ? width / ratio : origin.height
    return { x: handle === 'w' ? right - width : origin.x, y: origin.y + (origin.height - height) / 2, width, height }
  }
  const anchor = CORNERS[handle]
  const widthDelta = anchor.fromRight ? -dx : dx
  const heightDelta = anchor.fromBottom ? -dy : dy
  // 锁定比例时以拖拽幅度更主导的那个轴为准，跟手更自然。
  const drivenByWidth = !ratio || Math.abs(widthDelta) >= Math.abs(heightDelta) * ratio
  const width = Math.max(MIN_SIZE, origin.width + widthDelta)
  const height = ratio ? (drivenByWidth ? width / ratio : Math.max(MIN_SIZE, origin.height + heightDelta)) : Math.max(MIN_SIZE, origin.height + heightDelta)
  const finalWidth = ratio && !drivenByWidth ? height * ratio : width
  return {
    x: anchor.fromRight ? right - finalWidth : origin.x,
    y: anchor.fromBottom ? bottom - height : origin.y,
    width: finalWidth,
    height
  }
}

function drawRect(start: { x: number; y: number }, at: { x: number; y: number }): Rect {
  let width = Math.abs(at.x - start.x)
  let height = Math.abs(at.y - start.y)
  const ratio = aspect.value
  if (ratio) { if (width >= height * ratio) height = width / ratio; else width = height * ratio }
  // 以按下点为锚，允许朝任意方向拖拽。
  const x = at.x >= start.x ? start.x : start.x - width
  const y = at.y >= start.y ? start.y : start.y - height
  return { x, y, width, height }
}

function onPointerDown(event: PointerEvent) {
  if (!imageInfo.value || event.button !== 0) return
  const handle = ((event.target as HTMLElement).dataset.handle ?? 'draw') as Handle
  const start = imagePoint(event)
  drag.value = { handle, origin: handle === 'draw' ? { x: start.x, y: start.y, width: 0, height: 0 } : { ...crop.value }, start, before: { ...crop.value } }
  frameEl.value?.setPointerCapture(event.pointerId)
  if (handle === 'draw') crop.value = { x: start.x, y: start.y, width: 0, height: 0 }
}

function onPointerMove(event: PointerEvent) {
  const active = drag.value
  if (!active || !imageInfo.value) return
  const at = imagePoint(event)
  if (active.handle === 'draw') crop.value = fitRect(drawRect(active.start, at))
  else if (active.handle === 'move') crop.value = fitRect({ ...active.origin, x: active.origin.x + (at.x - active.start.x), y: active.origin.y + (at.y - active.start.y) })
  else crop.value = fitRect(resizeRect(active.handle, active.origin, at.x - active.start.x, at.y - active.start.y))
}

function onPointerUp() {
  // 按下却没拖出有效区域（误点）时还原，避免选框被收成一条线。
  if (drag.value?.handle === 'draw' && (crop.value.width < 3 || crop.value.height < 3)) crop.value = drag.value.before
  drag.value = null
}

// 方向键微调：1px，Shift 加速到 10px，便于像素级对齐。
function onKeyDown(event: KeyboardEvent) {
  if (!imageInfo.value || !crop.value.width) return
  // 焦点在输入框时让方向键归输入框自己用，否则会同时改数值和移选框。
  if ((event.target as HTMLElement).closest('input, select, textarea')) return
  const step = event.shiftKey ? 10 : 1
  const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  const move = moves[event.key]
  if (!move) return
  event.preventDefault()
  crop.value = fitRect({ ...crop.value, x: crop.value.x + move[0], y: crop.value.y + move[1] })
}

// 数字微调：锁定比例时改一条边自动换算另一条。
function setField(key: keyof Rect, event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  const info = imageInfo.value
  if (!info) return
  const next = { ...crop.value }
  if (key === 'width' || key === 'height') {
    next[key] = raw
    if (aspect.value) { if (key === 'width') next.height = raw / aspect.value; else next.width = raw * aspect.value }
  } else {
    next[key] = raw
  }
  crop.value = fitRect(next)
}

function resetCrop() {
  if (!imageInfo.value) return
  crop.value = { x: 0, y: 0, width: imageInfo.value.width, height: imageInfo.value.height }
  if (aspect.value) applyAspect(aspect.value, specLabel.value)
}



async function exportImage() {
  const info = imageInfo.value
  const source = imageEl.value
  if (!info || !source || !crop.value.width) return
  busy.value = true
  try {
    const spec = activeSpec.value
    const width = spec?.width ?? Math.round(crop.value.width)
    const height = spec?.height ?? Math.round(crop.value.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建导出画布')
    // JPEG 不支持透明，铺白底避免透明区域被渲染成黑色。
    if (exportFormat.value === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height) }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, Math.round(crop.value.x), Math.round(crop.value.y), Math.round(crop.value.width), Math.round(crop.value.height), 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, exportFormat.value, exportFormat.value === 'image/jpeg' ? jpegQuality.value : undefined))
    if (!blob) throw new Error('图片编码失败')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    const base = imageFile.value?.name.replace(/\.[^.]+$/, '') ?? 'image'
    const extension = exportFormat.value === 'image/jpeg' ? 'jpg' : 'png'
    link.download = `${base}-${spec ? spec.label : 'crop'}.${extension}`
    link.click()
    URL.revokeObjectURL(link.href)
    message.value = `已导出 ${width} × ${height}（${formatBytes(blob.size)}）。原图未改动，可继续调整。`
    error.value = false
  } catch (cause) {
    error.value = true
    message.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

// 舞台的 ResizeObserver 由上面的 watch(stageEl) 负责（此时还没渲染出舞台）。
onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
})

const fields: Array<{ key: keyof Rect; label: string }> = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: '宽' },
  { key: 'height', label: '高' }
]
</script>

<template>
  <ToolboxPage>
    <header class="toolbox-heading">
      <div><p>设计工具 / CROP</p><h2>图片裁剪</h2><span>在图上直接拖拽框选，支持比例锁定、证件照规格与像素微调。</span></div>
      <button class="back-button" @click="backToPortal">‹ 返回工具列表</button>
    </header>
    <input ref="imageInput" class="visually-hidden" type="file" accept="image/*" @change="onImageSelected">

    <section v-if="!imageInfo" class="image-dropzone" @click="imageInput?.click()" @dragover.prevent @drop.prevent="onImageDropped">
      <div><SvgIcon name="image" /><strong>选择或拖入图片</strong><span>支持 PNG / JPEG / WebP / GIF / BMP / SVG</span></div>
    </section>

    <template v-else>
      <div class="crop-toolbar">
        <div class="crop-group"><span>比例</span><button v-for="item in ASPECTS" :key="item.label" class="chip" :class="{ active: !specLabel && aspect === item.value }" @click="applyAspect(item.value)">{{ item.label }}</button></div>
        <button class="ghost" @click="imageInput?.click()">更换图片</button>
        <button class="ghost" @click="resetCrop">重置选框</button>
      </div>

      <div class="crop-specs">
        <span>证件照</span>
        <button v-for="spec in ID_SPECS" :key="spec.label" class="chip" :class="{ active: specLabel === spec.label }" @click="selectSpec(spec)">{{ spec.label }}<em>{{ spec.width }}×{{ spec.height }}</em></button>
      </div>

      <div class="crop-stage" :class="{ 'is-dragging': !!drag }" @dragover.prevent @drop.prevent="onImageDropped">
        <div ref="stageEl" class="crop-viewport">
          <span v-if="zoomedOut" class="crop-zoom">视图 {{ viewPercent }}% · 数值均为原图像素</span>
          <div
            ref="frameEl"
            class="crop-frame"
            :style="frameStyle"
            @pointerdown.prevent="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <img ref="imageEl" :src="originalUrl" alt="待裁剪图片" draggable="false">
            <div v-if="crop.width" class="crop-box" :style="boxStyle" data-handle="move">
              <i class="crop-rule crop-rule--third-v left"></i><i class="crop-rule crop-rule--third-v right"></i>
              <i class="crop-rule crop-rule--third-h top"></i><i class="crop-rule crop-rule--third-h bottom"></i>
              <span class="crop-size" :class="{ inside: crop.y * fit.scale < 26 }">{{ boxLabel }}<em v-if="boxSourceLabel">{{ boxSourceLabel }}</em></span>
              <button v-for="handle in ['nw','n','ne','e','se','s','sw','w']" :key="handle" class="crop-handle" :class="`crop-handle--${handle}`" :data-handle="handle" :aria-label="handle" @pointerdown.stop="onPointerDown"></button>
            </div>
          </div>
        </div>
        <p class="crop-tip">空白处拖动新建选框 · 拖框内移动 · 拖手柄缩放 · 方向键微调 1px（Shift 10px）</p>
      </div>

      <section class="crop-panel">
        <div class="crop-fields">
          <h3>选框位置</h3>
          <label v-for="field in fields" :key="field.key">
            {{ field.label }}
            <input type="number" :value="Math.round(crop[field.key])" min="0" @change="setField(field.key, $event)">
          </label>
        </div>
        <div class="crop-fields">
          <h3>导出</h3>
          <label class="crop-format">
            格式
            <select v-model="exportFormat">
              <option value="image/png">PNG（保留透明）</option>
              <option value="image/jpeg">JPEG</option>
            </select>
          </label>
          <label v-if="exportFormat === 'image/jpeg'" class="crop-format">
            质量
            <input v-model.number="jpegQuality" type="range" min="0.5" max="1" step="0.01">
            <output>{{ Math.round(jpegQuality * 100) }}%</output>
          </label>
          <p class="crop-output">输出 <strong>{{ outputHint }}</strong><em v-if="activeSpec">{{ activeSpec.label }} {{ activeSpec.note }}</em></p>
          <button class="primary crop-export" :disabled="busy || !crop.width" @click="exportImage">{{ busy ? '导出中…' : '导出图片' }}</button>
        </div>
      </section>
    </template>

    <p class="tool-message" :class="{ error }">{{ message }}</p>
  </ToolboxPage>
</template>
