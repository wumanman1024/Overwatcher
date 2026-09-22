<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import ToolboxPage from '../ToolboxPage.vue'

const router = useRouter()
const backToPortal = () => router.push({ name: 'portal' })

const pad = (value: number) => String(value).padStart(2, '0')
// datetime-local 控件用的是「无时区」的本地时间字符串，浏览器会按本地时区解析，符合直觉。
const toInputValue = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
const fromInputValue = (value: string) => { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new Error('请选择有效的日期时间'); return date }

const copyValue = async (value: string, label: string) => { if (!value || value === '—') return; await navigator.clipboard.writeText(value); ElMessage.success({ message: `已复制${label}`, duration: 1_600 }) }

// —— 模块一：时间戳 ↔ 日期 双向解析 ——
const stampSource = ref(String(Math.floor(Date.now() / 1000)))
// 纯数字按时间戳解析，其余按日期字符串解析；时间戳自动识别秒 / 毫秒。
const parsedDate = computed(() => {
  const text = stampSource.value.trim()
  if (!text) return null
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text)
    if (!Number.isFinite(numeric)) return null
    const ms = Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const normalized = text.replace(/\//g, '-').replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
})
const stampFields = computed<Array<{ label: string; value: string }>>(() => {
  const date = parsedDate.value
  if (!date) return []
  const time = date.getTime()
  const offset = -date.getTimezoneOffset()
  const offsetLabel = `UTC${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  return [
    { label: `本地时间 · ${offsetLabel}`, value: date.toLocaleString('zh-CN', { hour12: false }) },
    { label: 'ISO 8601', value: date.toISOString() },
    { label: 'Unix 秒', value: String(Math.floor(time / 1000)) },
    { label: 'Unix 毫秒', value: String(time) }
  ]
})
const stampMessage = computed(() => (stampSource.value.trim() && !parsedDate.value) ? '无法识别，请输入 Unix 时间戳或日期（如 2026-01-01 12:00:00）。' : '')
const useNow = () => { stampSource.value = String(Math.floor(Date.now() / 1000)) }

// —— 模块二：时间差 / 距今多久 ——
const dateA = ref(toInputValue(new Date()))
const dateB = ref(toInputValue(new Date()))
const difference = computed(() => {
  try {
    const a = fromInputValue(dateA.value).getTime(); const b = fromInputValue(dateB.value).getTime()
    let rest = Math.abs(b - a); const signed = b - a
    const days = Math.floor(rest / 86_400_000); rest -= days * 86_400_000
    const hours = Math.floor(rest / 3_600_000); rest -= hours * 3_600_000
    const minutes = Math.floor(rest / 60_000); rest -= minutes * 60_000
    const seconds = Math.floor(rest / 1_000)
    const parts = [days && `${days} 天`, hours && `${hours} 小时`, minutes && `${minutes} 分`, seconds && `${seconds} 秒`].filter(Boolean).join('') || '0 秒'
    return { text: `${signed < 0 ? '-' : ''}${parts}`, fields: [
      { label: '总计毫秒', value: Math.abs(b - a).toLocaleString('en-US') },
      { label: '总计秒', value: Math.round(Math.abs(b - a) / 1000).toLocaleString('en-US') },
      { label: '总计分钟', value: (Math.abs(b - a) / 60_000).toFixed(2) },
      { label: '总计天数', value: (Math.abs(b - a) / 86_400_000).toFixed(4) }
    ] }
  } catch { return null }
})
const swapDates = () => { const value = dateA.value; dateA.value = dateB.value; dateB.value = value }
const measureFromNow = () => { dateA.value = toInputValue(new Date()) }

// —— 模块三：日期加减偏移 ——
type OffsetUnit = '分' | '时' | '天' | '周' | '月' | '年'
const baseDate = ref(toInputValue(new Date()))
const offsetAmount = ref(30)
const offsetDirection = ref<'add' | 'sub'>('add')
const offsetUnit = ref<OffsetUnit>('天')
const offsetResult = computed(() => {
  try {
    const source = fromInputValue(baseDate.value)
    const amount = (offsetDirection.value === 'sub' ? -1 : 1) * Math.trunc(Number(offsetAmount.value) || 0)
    const result = new Date(source.getTime())
    if (offsetUnit.value === '月' || offsetUnit.value === '年') {
      const dayOfMonth = result.getDate()
      result.setDate(1)
      if (offsetUnit.value === '月') result.setMonth(result.getMonth() + amount); else result.setFullYear(result.getFullYear() + amount)
      const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
      result.setDate(Math.min(dayOfMonth, lastDay)) // 月末做钳制，避免 1月31日 + 1月 跳到 3 月
    } else {
      const unitMs = { 分: 60_000, 时: 3_600_000, 天: 86_400_000, 周: 604_800_000 }[offsetUnit.value as Exclude<OffsetUnit, '月' | '年'>] // 月 / 年已在上方分支处理
      result.setTime(source.getTime() + amount * unitMs)
    }
    return { fields: [
      { label: '结果 · 本地时间', value: result.toLocaleString('zh-CN', { hour12: false }) },
      { label: 'ISO 8601', value: result.toISOString() },
      { label: 'Unix 秒', value: String(Math.floor(result.getTime() / 1000)) },
      { label: 'Unix 毫秒', value: String(result.getTime()) }
    ] }
  } catch { return null }
})
</script>

<template>
  <ToolboxPage>
    <header class="toolbox-heading">
      <div><p>数据工具 / TIME</p><h2>时间工作台</h2><span>时间戳与日期互转、时间差计算、日期加减偏移，全部在本机完成。</span></div>
      <button class="back-button" @click="backToPortal">‹ 返回工具列表</button>
    </header>

    <section class="time-block">
      <h3>时间戳 ↔ 日期</h3>
      <div class="converter-card">
        <label class="time-input">输入时间戳或日期<input v-model.trim="stampSource" spellcheck="false" placeholder="如 1767225600 或 2026-01-01 12:00:00"></label>
        <button type="button" @click="useNow">取当前时间戳</button>
        <p v-if="stampMessage" class="tool-message error">{{ stampMessage }}</p>
        <section v-if="stampFields.length" class="time-grid">
          <div v-for="field in stampFields" :key="field.label">
            <small>{{ field.label }}</small>
            <strong :title="field.value">{{ field.value }}</strong>
            <button type="button" @click="copyValue(field.value, field.label)">复制</button>
          </div>
        </section>
      </div>
    </section>

    <section class="time-block">
      <h3>时间差 / 距今多久</h3>
      <div class="converter-card">
        <label>起始时间<input v-model="dateA" type="datetime-local" step="1"></label>
        <label>结束时间<input v-model="dateB" type="datetime-local" step="1"></label>
        <button type="button" @click="swapDates">交换</button>
        <button type="button" @click="measureFromNow">距今（起=现在）</button>
        <div class="time-diff-summary">
          <small>相差</small>
          <strong>{{ difference ? difference.text : '—' }}</strong>
          <button v-if="difference" type="button" @click="copyValue(difference.text, '时间差')">复制</button>
        </div>
        <section v-if="difference" class="time-grid">
          <div v-for="field in difference.fields" :key="field.label"><small>{{ field.label }}</small><strong :title="field.value">{{ field.value }}</strong><button type="button" @click="copyValue(field.value, field.label)">复制</button></div>
        </section>
      </div>
    </section>

    <section class="time-block">
      <h3>日期加减偏移</h3>
      <div class="converter-card">
        <label>基准时间<input v-model="baseDate" type="datetime-local" step="1"></label>
        <label>偏移量<input v-model.number="offsetAmount" type="number" inputmode="numeric"></label>
        <label>方向<select v-model="offsetDirection"><option value="add">向后加</option><option value="sub">向前排减</option></select></label>
        <label>单位<select v-model="offsetUnit"><option>分</option><option>时</option><option>天</option><option>周</option><option>月</option><option>年</option></select></label>
        <section v-if="offsetResult" class="time-grid">
          <div v-for="field in offsetResult.fields" :key="field.label"><small>{{ field.label }}</small><strong :title="field.value">{{ field.value }}</strong><button type="button" @click="copyValue(field.value, field.label)">复制</button></div>
        </section>
      </div>
    </section>
  </ToolboxPage>
</template>

<style scoped>
.time-block { margin-bottom: 26px; }
.time-block h3 { margin-bottom: 12px; color: #1f2321; font-size: 15px; font-weight: 800; }
.time-block .converter-card { align-items: start; }
.time-input { flex: 1 1 320px; }
.time-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0; flex-basis: 100%; overflow: hidden; border: 1px solid #e3e9e5; border-radius: 5px; }
.time-grid > div { display: grid; gap: 6px; padding: 15px 17px; border-right: 1px solid #e7ece9; border-bottom: 1px solid #e7ece9; }
.time-grid small { color: #7a8c82; font-size: 10px; font-weight: 850; letter-spacing: .06em; }
.time-grid strong { color: #078f46; font: 750 15px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
.time-grid button { justify-self: start; padding: 4px 10px; font-size: 12px; }
.time-diff-summary { display: grid; gap: 6px; flex-basis: 100%; padding: 15px 17px; border: 1px solid #bfe3ce; border-radius: 5px; background: #f1faf5; }
.time-diff-summary small { color: #7a8c82; font-size: 10px; font-weight: 850; letter-spacing: .06em; }
.time-diff-summary strong { color: #069f4f; font: 800 24px/1.1 ui-monospace, SFMono-Regular, Consolas, monospace; }
.time-diff-summary button { justify-self: start; padding: 4px 10px; font-size: 12px; }
</style>
