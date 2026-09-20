import { computed, ref } from 'vue'
import type { ModelConfig, ModelConfigInput } from '@localforge/shared/model-config'

/*
 * 模型配置的唯一真源。数据存在主进程的 SQLite（userData/localforge.db），
 * 这里只是渲染层的响应式镜像 + 读写入口；模块级单例，模型管理里改完，工具页立即跟着变。
 *
 * LEGACY_STORAGE_KEY 是 SQLite 之前用 localStorage 过渡时的键，启动时若发现旧数据且库里没有，
 * 一次性搬进数据库后删除，升级前配过模型的用户不会丢配置。
 */
const LEGACY_STORAGE_KEY = 'localforge:models'

const models = ref<ModelConfig[]>([])
const activeId = ref<string>('')
const ready = ref(false)
const loadError = ref('')

// 工具页顶部的临时选择，不写回数据库的 is_default：在 A 工具切了模型不应影响 B 工具的默认。
let loading: Promise<void> | null = null

const bridge = () => {
  if (!window.modelConfigs) throw new Error('模型组件未加载，请重启应用')
  return window.modelConfigs
}

/** 旧 localStorage 数据搬进数据库；仅当数据库为空且旧键存在时发生一次。搬完即删旧键。 */
async function migrateLegacy(): Promise<void> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LEGACY_STORAGE_KEY)
  } catch {
    return
  }
  if (!raw) return
  localStorage.removeItem(LEGACY_STORAGE_KEY)
  try {
    const parsed = JSON.parse(raw) as ModelConfig[]
    if (!Array.isArray(parsed) || !parsed.length) return
    for (const model of parsed) {
      const { id: _id, isDefault, ...input } = model
      const created = await bridge().save(input)
      if (isDefault) await bridge().setDefault(created.id)
    }
  } catch {
    // 旧数据读不动就忽略；旧键已删，不会每次启动都重试。
  }
}

async function load(): Promise<void> {
  try {
    if (!models.value.length) await migrateLegacy()
    models.value = await bridge().list()
    if (!models.value.some((model) => model.id === activeId.value)) {
      activeId.value = models.value.find((model) => model.isDefault)?.id ?? models.value[0]?.id ?? ''
    }
    loadError.value = ''
  } catch (error) {
    models.value = []
    loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    ready.value = true
  }
}

/** 应用启动时调用一次；重复调用复用同一个在途请求。 */
export function initModels(): Promise<void> {
  if (!loading) loading = load()
  return loading
}

export function useModels() {
  const activeModel = computed(() => models.value.find((model) => model.id === activeId.value) ?? models.value.find((model) => model.isDefault) ?? models.value[0])

  const refresh = () => load()
  const setActive = (id: string) => { activeId.value = id }

  const add = async (input: ModelConfigInput): Promise<void> => {
    const created = await bridge().save(input)
    await load()
    activeId.value = created.id
  }

  const update = async (id: string, input: ModelConfigInput): Promise<void> => {
    await bridge().save(input, id)
    await load()
  }

  const remove = async (id: string): Promise<void> => {
    await bridge().remove(id)
    if (activeId.value === id) activeId.value = ''
    await load()
  }

  const setDefault = async (id: string): Promise<void> => {
    await bridge().setDefault(id)
    activeId.value = id
    await load()
  }

  return { models, activeModel, activeId, ready, loadError, refresh, setActive, add, update, remove, setDefault }
}
