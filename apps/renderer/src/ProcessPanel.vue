<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { formatByteSize } from '@localforge/shared/formatters'

type Row = ManagedProcessRow

const rows = ref<Row[]>([])
const selected = ref<Set<number>>(new Set())
const state = ref<'loading' | 'ready' | 'error'>('loading')
const message = ref('')
const query = ref('')
const busy = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return keyword ? rows.value.filter((row) => `${row.name} ${row.pid}`.toLowerCase().includes(keyword)) : rows.value
})
const selectedRows = computed(() => rows.value.filter((row) => selected.value.has(row.pid)))
const selectedMemory = computed(() => selectedRows.value.reduce((total, row) => total + row.memoryBytes, 0))
const allSelected = computed(() => filtered.value.length > 0 && filtered.value.every((row) => selected.value.has(row.pid)))

const load = async (announce = false) => {
  if (!window.processPanel) { state.value = 'error'; message.value = '进程管理不可用'; return }
  if (state.value !== 'ready') state.value = 'loading'
  try {
    const list = await window.processPanel.list()
    const alive = new Set(list.map((row) => row.pid))
    rows.value = list
    // 进程可能在我们刷新前自己退出了，勾选项要跟着剔除，否则会拿着已消失的 PID 去结束。
    selected.value = new Set([...selected.value].filter((pid) => alive.has(pid)))
    state.value = 'ready'
    if (announce) message.value = `已刷新，共 ${list.length} 个可管理进程。`
  } catch (error) {
    // 自动刷新失败不该把整个界面打翻，保留上一次结果只提示一句。
    if (state.value === 'ready') message.value = `刷新失败：${error instanceof Error ? error.message : String(error)}`
    else { state.value = 'error'; message.value = error instanceof Error ? error.message : String(error) }
  }
}

const toggle = (pid: number) => {
  const next = new Set(selected.value)
  if (next.has(pid)) next.delete(pid); else next.add(pid)
  selected.value = next
}
const toggleAll = () => {
  selected.value = allSelected.value ? new Set() : new Set(filtered.value.map((row) => row.pid))
}

/*
 * 结束进程会丢掉该程序未保存的内容，因此每次都要求明确确认，
 * 并把要结束的名字逐个列出来 —— 只说「确定结束 5 个进程吗」是不够的。
 */
const terminateSelected = async () => {
  if (!window.processPanel || !selectedRows.value.length || busy.value) return
  const names = selectedRows.value.map((row) => `${row.name}(${row.pid})`).join('、')
  const detail = names.length > 400 ? `${names.slice(0, 400)}…` : names
  if (!window.confirm(`将强制结束以下 ${selectedRows.value.length} 个进程，它们的子进程也会一并终止，未保存的内容会丢失：\n\n${detail}\n\n是否继续？`)) return
  busy.value = true
  try {
    const outcomes = await window.processPanel.terminate(selectedRows.value.map((row) => row.pid))
    const failed = outcomes.filter((item) => !item.ok)
    message.value = failed.length
      ? `已结束 ${outcomes.length - failed.length} 个，${failed.length} 个失败：${failed.map((item) => `${item.pid} ${item.error ?? ''}`).join('；')}`
      : `已结束 ${outcomes.length} 个进程。`
    selected.value = new Set()
    await load()
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

const shortCommand = (row: Row) => {
  if (!row.command) return row.name
  // 命令行常常长得离谱（浏览器一带就是几百字符参数），只取最有辨识度的开头。
  return row.command.length > 90 ? `${row.command.slice(0, 90)}…` : row.command
}

onMounted(() => {
  void load()
  // 自动刷新：CPU 占用只有持续采样才有意义；手动刷新按钮仍然保留。
  timer = setInterval(() => { if (!busy.value && !selected.value.size) void load() }, 3_000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <section class="process-workbench" aria-label="进程管理">
    <div class="process-toolbar">
      <label class="process-search">筛选进程名或 PID<input v-model.trim="query" placeholder="例如 chrome、node、1204"></label>
      <div class="process-actions">
        <button type="button" :disabled="state === 'loading'" @click="load(true)">{{ state === 'loading' ? '读取中…' : '刷新' }}</button>
        <button type="button" class="danger" :disabled="!selectedRows.length || busy" @click="terminateSelected">{{ busy ? '结束中…' : `结束选中${selectedRows.length ? ` ${selectedRows.length} 个` : ''}` }}</button>
      </div>
    </div>

    <p class="tool-message" :class="{ error: state === 'error' }">
      {{ message || `共 ${rows.length} 个可管理进程，已隐藏系统关键进程与本应用自身。` }}
      <template v-if="selectedRows.length"> 已选 {{ selectedRows.length }} 个，合计约占 {{ formatByteSize(selectedMemory) }}。</template>    </p>

    <div class="process-table" role="table">
      <div class="process-row process-head" role="row">
        <span class="process-check"><input type="checkbox" :checked="allSelected" aria-label="全选当前结果" @change="toggleAll"></span>
        <span role="columnheader">进程</span>
        <span role="columnheader">CPU</span>
        <span role="columnheader">内存</span>
        <span role="columnheader">PID</span>
      </div>
      <div v-for="row in filtered" :key="row.pid" class="process-row" role="row" :class="{ picked: selected.has(row.pid) }" @click="toggle(row.pid)">
        <span class="process-check"><input type="checkbox" :checked="selected.has(row.pid)" :aria-label="`选择 ${row.name}`" @click.stop @change="toggle(row.pid)"></span>
        <span class="process-name" :title="shortCommand(row)"><strong>{{ row.name }}</strong><small v-if="row.command">{{ shortCommand(row) }}</small></span>
        <span class="process-metric"><i class="bar" :style="{ '--fill': `${Math.min(row.cpuPercent, 100)}%` }"></i>{{ row.cpuPercent.toFixed(1) }}%</span>
        <span class="process-metric"><i class="bar" :style="{ '--fill': `${Math.min(row.memoryPercent, 100)}%` }"></i>{{ formatByteSize(row.memoryBytes) }} <em>{{ row.memoryPercent.toFixed(1) }}%</em></span>
        <span class="process-pid">{{ row.pid }}</span>
      </div>
      <p v-if="state === 'loading' && !rows.length" class="empty-state">正在读取进程列表…</p>
      <p v-else-if="!filtered.length" class="empty-state">{{ query ? '没有匹配的进程。' : '没有可管理的进程。' }}</p>
    </div>
  </section>
</template>
