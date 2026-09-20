<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { REASONING_EFFORT_LABEL, REASONING_EFFORTS, validateModelInput } from '@localforge/shared/model-config'
import type { ModelConfig, ModelConfigInput } from '@localforge/shared/model-config'
import { useModels } from '../use-models'
import SvgIcon from './SvgIcon.vue'

const emit = defineEmits<{ close: [] }>()
const { models, loadError, add, update, remove, setDefault } = useModels()

type Draft = ModelConfigInput & { id?: string }
const emptyDraft = (): Draft => ({ name: '', baseUrl: '', modelId: '', apiKey: '', effort: 'off', temperature: 0.2, maxTokens: undefined, timeoutMs: 120_000 })

const draft = reactive<Draft>(emptyDraft())
const editingId = ref('')
const message = ref('')
const busy = ref(false)
const testing = reactive<Record<string, 'pending' | 'ok' | 'fail'>>({})
const testDetail = reactive<Record<string, string>>({})

const editing = computed(() => !!editingId.value)
const draftError = computed(() => (draft.name || draft.baseUrl || draft.modelId ? validateModelInput(draft) : null))
const canSave = computed(() => !draftError.value && !!draft.name && !!draft.baseUrl && !!draft.modelId && !busy.value)
const bridgeReady = () => !!window.llmTools

// CRUD 走主进程 SQLite，全异步；失败统一 catch 成中文提示，不让异常冒到模板。
const run = async (action: () => Promise<void>, done: string) => {
  busy.value = true
  try {
    await action()
    message.value = done
    ElMessage.success({ message: done, duration: 1_600 })
    return true
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
    return false
  } finally {
    busy.value = false
  }
}

const startCreate = () => {
  editingId.value = ''
  Object.assign(draft, emptyDraft())
  message.value = ''
}

const startEdit = (model: ModelConfig) => {
  editingId.value = model.id
  const { id: _id, isDefault: _isDefault, ...rest } = model
  Object.assign(draft, emptyDraft(), rest)
  message.value = `正在编辑「${model.name}」。`
}

const payload = (): ModelConfigInput => ({
  name: draft.name.trim(),
  baseUrl: draft.baseUrl.trim(),
  modelId: draft.modelId.trim(),
  apiKey: draft.apiKey.trim(),
  effort: draft.effort,
  temperature: Number(draft.temperature),
  ...(draft.maxTokens ? { maxTokens: Math.trunc(Number(draft.maxTokens)) } : {}),
  timeoutMs: Math.trunc(Number(draft.timeoutMs)) || 120_000
})

const save = async () => {
  if (!canSave.value) { message.value = draftError.value || '请完整填写名称、服务地址与模型标识。'; return }
  const input = payload()
  const ok = editingId.value
    ? await run(() => update(editingId.value, input), `已更新「${input.name}」。`)
    : await run(() => add(input), `已添加「${input.name}」。`)
  if (ok) startCreate()
}

const drop = async (model: ModelConfig) => {
  if (!window.confirm(`删除模型「${model.name}」？`)) return
  const ok = await run(() => remove(model.id), `已删除「${model.name}」。`)
  if (ok && editingId.value === model.id) startCreate()
}

const markDefault = (model: ModelConfig) => {
  void run(() => setDefault(model.id), `已将「${model.name}」设为默认模型。`)
}

const test = async (model: ModelConfig) => {
  if (!bridgeReady()) { message.value = 'AI 组件未加载，请重启应用后再测试。'; return }
  testing[model.id] = 'pending'
  testDetail[model.id] = ''
  try {
    const result = await window.llmTools!.test(model)
    testing[model.id] = result.ok ? 'ok' : 'fail'
    testDetail[model.id] = result.ok ? (result.count === undefined ? '可访问' : `${result.count} 个模型`) : (result.error || '不可访问')
  } catch (error) {
    testing[model.id] = 'fail'
    testDetail[model.id] = error instanceof Error ? error.message : String(error)
  }
}

</script>

<template>
  <div class="model-backdrop" @click.self="emit('close')">
    <section class="model-dialog" role="dialog" aria-modal="true" aria-labelledby="model-dialog-title">
      <header><div><p>LOCALFORGE / MODELS</p><h2 id="model-dialog-title">模型管理</h2></div><button type="button" aria-label="关闭模型管理" @click="emit('close')"><SvgIcon name="window-close" /></button></header>
      <p class="model-note">配置 OpenAI 兼容的大模型服务，供「智能体」分类下的工具调用。配置仅保存在本机，密钥按明文存储，请仅在可信设备上填写。</p>

      <div class="model-body">
        <div class="model-list-pane">
          <p v-if="loadError" class="model-empty">{{ loadError }}</p>
          <p v-else-if="!models.length" class="model-empty">还没有模型。在右侧填写服务地址与模型标识后点「添加模型」。</p>
          <ul v-else class="model-list">
            <li v-for="model in models" :key="model.id" :class="{ editing: model.id === editingId }">
              <label class="model-default" :title="model.isDefault ? '默认模型' : '设为默认'">
                <input type="radio" name="default-model" :checked="model.isDefault" @change="markDefault(model)" />
              </label>
              <div class="model-row-main">
                <strong>{{ model.name }}</strong>
                <code :title="model.baseUrl">{{ model.baseUrl }}</code>
                <small>{{ model.modelId }} · 思考 {{ REASONING_EFFORT_LABEL[model.effort] }}</small>
                <small v-if="testDetail[model.id]" :class="{ fail: testing[model.id] === 'fail' }">{{ testDetail[model.id] }}</small>
              </div>
              <span class="model-lamp" :class="testing[model.id] || 'idle'" :title="testing[model.id] === 'pending' ? '测试中' : testDetail[model.id] || '未测试'"></span>
              <div class="model-row-actions">
                <button :disabled="testing[model.id] === 'pending' || !bridgeReady()" @click="test(model)">{{ testing[model.id] === 'pending' ? '测试中' : '测试' }}</button>
                <button @click="startEdit(model)">编辑</button>
                <button class="danger" @click="drop(model)">删除</button>
              </div>
            </li>
          </ul>
        </div>

        <form class="model-form" @submit.prevent="save">
          <header><strong>{{ editing ? '编辑模型' : '添加模型' }}</strong><button v-if="editing" type="button" @click="startCreate">取消编辑</button></header>
          <label>显示名称<input v-model="draft.name" placeholder="例如：内网推理服务" /></label>
          <label>服务地址<input v-model="draft.baseUrl" placeholder="https://api.example.com/v1" spellcheck="false" /><small>OpenAI 兼容服务的 base url，通常以 /v1 结尾，末尾斜杠可省。</small></label>
          <label>模型标识<input v-model="draft.modelId" placeholder="例如：gpt-4o-mini" spellcheck="false" /><small>请求时作为 model 字段发送。</small></label>
          <label>API Key<input v-model="draft.apiKey" type="password" placeholder="留空表示服务无需鉴权" spellcheck="false" autocomplete="off" /></label>
          <div class="model-grid">
            <label>思考强度
              <select v-model="draft.effort"><option v-for="level in REASONING_EFFORTS" :key="level" :value="level">{{ REASONING_EFFORT_LABEL[level] }}</option></select>
            </label>
            <label>温度<input v-model.number="draft.temperature" type="number" min="0" max="2" step="0.1" /></label>
            <label>最大 tokens<input v-model.number="draft.maxTokens" type="number" min="1" placeholder="不限" /></label>
            <label>超时（毫秒）<input v-model.number="draft.timeoutMs" type="number" min="1000" step="1000" /></label>
          </div>
          <p class="model-form-error" :class="{ error: !!draftError }">{{ draftError || message || '填写完成后点「添加模型」，列表中可随时测试连通性。' }}</p>
          <footer>
            <button type="button" @click="emit('close')">关闭</button>
            <button class="primary" type="submit" :disabled="!canSave">{{ editing ? '保存修改' : '添加模型' }}</button>
          </footer>
        </form>
      </div>
    </section>
  </div>
</template>
