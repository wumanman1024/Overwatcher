<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import ToolboxPage from '../ToolboxPage.vue'
import { DRAFT_OPTIONS_KEY, DRAFT_SOURCE_KEY, DRAFT_STORAGE_KEY, FLAG_LABELS, MENU_ICONS, MENU_TYPE_LABEL } from '../menu-sql/constants'
import { buildTree, buildUserPrompt, SYSTEM_PROMPT } from '../menu-sql/llm'
import { countByDepth, parseMenuText } from '../menu-sql/parse-tree'
import { addChild, createNode, derivePermsPrefix, deriveRouteName, findNode, locate, moveSibling, nextOrderNum, normalizeOrder, removeNode, updateNode } from '../menu-sql/model'
import { generateSql } from '../menu-sql/sql'
import { summarize, validateMenuTree } from '../menu-sql/validate'
import { useModels } from '../use-models'
import type { MenuNode, MenuType, SqlOptions } from '../menu-sql/types'

const router = useRouter()
const backToPortal = () => router.push({ name: 'portal' })

const { models, activeModel, setActive, ready: modelsReady, loadError: modelsError } = useModels()

const menuTree = ref<MenuNode[]>([])
const selectedId = ref('')
const collapsed = ref<Set<string>>(new Set())
const sqlOptions = reactive<SqlOptions>({ roleKeys: '', scope: 'all', manualIds: false, manualStartId: 1 })
const message = ref('粘贴中文菜单树，一键生成 sys_menu 的 MySQL 脚本；内容只保存在本机。')
const fileName = ref('sys_menu.sql')
const draftFileInput = ref<HTMLInputElement>()
let draftTimer: ReturnType<typeof setTimeout> | undefined

/* ---------- 粘贴文本 → 大模型命名 → 菜单树 ---------- */
const PASTE_PLACEHOLDER = `- 系统管理
  - 用户管理
    - 用户查询
    - 用户新增
    - 用户删除
  - 字典管理
    - 字典数据
- 监控中心
  - 缓存监控`

const sourceText = ref('')
const generating = ref(false)
/** 上一次生成时的微调区快照，用于判断用户是否手动改过、重新生成前要不要确认。 */
let lastGeneratedJson = ''

const parsedLines = computed(() => parseMenuText(sourceText.value))
const parsedStat = computed(() => countByDepth(parsedLines.value))
const hasSource = computed(() => parsedStat.value.total > 0)

async function generate() {
  if (!hasSource.value) { message.value = '先粘贴菜单树再生成。'; return }
  if (!window.llmTools) { message.value = 'AI 组件未加载，请重启应用。'; return }
  const config = activeModel.value
  if (!config) { message.value = '尚未配置模型，请先点左下角「模型管理」添加。'; return }
  if (hasTree.value && JSON.stringify(menuTree.value) !== lastGeneratedJson && !window.confirm('微调区里的改动会被生成结果覆盖，继续吗？')) return

  generating.value = true
  generateProgress.value = `正在请求 ${config.name} 为 ${parsedStat.value.total} 个节点命名…`
  try {
    const result = await window.llmTools.chat({
      config,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserPrompt(parsedLines.value) }]
    })
    const outcome = buildTree(parsedLines.value, result.content)
    menuTree.value = outcome.tree
    selectedId.value = outcome.tree[0]?.children[0]?.localId ?? outcome.tree[0]?.localId ?? ''
    collapsed.value = new Set()
    lastGeneratedJson = JSON.stringify(menuTree.value)
    const summary = summarize(validateMenuTree(menuTree.value))
    message.value = outcome.notes.length
      ? `已生成 ${parsedStat.value.total} 个节点。${outcome.notes.join(' ')}`
      : `已生成 ${parsedStat.value.total} 个节点，${summary.errors ? `${summary.errors} 个错误待修正` : '校验通过'}。`
    ElMessage.success({ message: '菜单 SQL 已生成', duration: 1_600 })
  } catch (error) {
    message.value = `生成失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    generating.value = false
    generateProgress.value = ''
  }
}

/** 离线兜底：不调模型，纯英文树也能直接规范化生成；中文名会落占位标识并在微调区提示修正。 */
function generateOffline() {
  if (!hasSource.value) { message.value = '先粘贴菜单树再生成。'; return }
  if (hasTree.value && JSON.stringify(menuTree.value) !== lastGeneratedJson && !window.confirm('微调区里的改动会被生成结果覆盖，继续吗？')) return
  const outcome = buildTree(parsedLines.value, JSON.stringify({ nodes: [] }))
  menuTree.value = outcome.tree
  selectedId.value = outcome.tree[0]?.localId ?? ''
  collapsed.value = new Set()
  lastGeneratedJson = JSON.stringify(menuTree.value)
  message.value = `已离线生成 ${parsedStat.value.total} 个节点（英文标识未经翻译）：${outcome.notes.join(' ') || '全部沿用原名称。'}`
}

const selected = computed(() => (selectedId.value ? findNode(menuTree.value, selectedId.value) : undefined))
const selectedLocation = computed(() => (selectedId.value ? locate(menuTree.value, selectedId.value) : undefined))
const selectedParentName = computed(() => selectedLocation.value?.parents.at(-1)?.menuName || '主类目')
const canMoveUp = computed(() => (selectedLocation.value?.index ?? 0) > 0)
const canMoveDown = computed(() => {
  const location = selectedLocation.value
  return !!location && location.index < location.siblings.length - 1
})
const issues = computed(() => validateMenuTree(menuTree.value))
const issueSummary = computed(() => summarize(issues.value))
const issuesOfSelected = computed(() => issues.value.filter((issue) => issue.localId === selectedId.value))
const hasTree = computed(() => menuTree.value.length > 0)
const sql = computed(() => (hasTree.value ? generateSql(menuTree.value, sqlOptions, selectedId.value) : ''))

interface FlatNode { node: MenuNode; depth: number; hasChildren: boolean; errors: number; warnings: number }
const visibleNodes = computed<FlatNode[]>(() => {
  const out: FlatNode[] = []
  const visit = (nodes: MenuNode[], depth: number) => {
    for (const node of nodes) {
      const own = issues.value.filter((issue) => issue.localId === node.localId)
      out.push({ node, depth, hasChildren: node.children.length > 0, errors: own.filter((issue) => issue.level === 'error').length, warnings: own.length })
      if (!collapsed.value.has(node.localId)) visit(node.children, depth + 1)
    }
  }
  visit(menuTree.value, 0)
  return out
})

const patch = <K extends keyof MenuNode>(key: K, value: MenuNode[K]) => {
  if (!selectedId.value) return
  menuTree.value = updateNode(menuTree.value, selectedId.value, { [key]: value } as Partial<MenuNode>)
}

const toggleCollapse = (localId: string) => {
  const next = new Set(collapsed.value)
  if (next.has(localId)) next.delete(localId)
  else next.add(localId)
  collapsed.value = next
}

const changeType = (menuType: MenuType) => {
  if (!selectedId.value) return
  // 目录不需要组件与路由名，按钮只需要权限码：切换类型时清掉不该残留的值，避免生成出矛盾记录。
  const cleared: Partial<MenuNode> = menuType === 'M'
    ? { component: '', routeName: '', query: '', perms: '' }
    : menuType === 'F'
      ? { component: '', routeName: '', query: '', path: '', icon: '' }
      : {}
  menuTree.value = updateNode(menuTree.value, selectedId.value, { menuType, ...cleared })
}

/* ---------- 增删改 ---------- */
const addNode = (menuType: MenuType, topLevel = false) => {
  const parentId = topLevel ? '' : selectedId.value
  const parent = parentId ? findNode(menuTree.value, parentId) : undefined
  if (parent?.menuType === 'F') { message.value = '按钮节点下不能再挂子节点。'; return }
  const node = createNode(menuType, {
    orderNum: nextOrderNum(parentId ? (parent?.children ?? []) : menuTree.value),
    // 子节点默认跟随父级的权限前缀，少敲一遍模块名。
    ...(menuType !== 'M' && parent ? { perms: `${derivePermsPrefix(ancestorPath(parent))}:` } : {})
  })
  menuTree.value = addChild(menuTree.value, parentId || null, node)
  if (parent && collapsed.value.has(parent.localId)) toggleCollapse(parent.localId)
  selectedId.value = node.localId
  message.value = `已新增${MENU_TYPE_LABEL[menuType]}节点，请填写名称与路由地址。`
}

function ancestorPath(node: MenuNode): string {
  const location = locate(menuTree.value, node.localId)
  if (!location) return node.path
  return [...location.parents.map((parent) => parent.path), node.path].filter(Boolean).join('/')
}

const removeSelected = () => {
  const target = selected.value
  if (!target) return
  const descendants = countDescendants(target)
  if (!window.confirm(`删除「${target.menuName || '（未命名）'}」${descendants ? `及其 ${descendants} 个子节点` : ''}？`)) return
  menuTree.value = removeNode(menuTree.value, target.localId)
  selectedId.value = ''
  message.value = `已删除「${target.menuName || '（未命名）'}」。`
}

function countDescendants(node: MenuNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0)
}

const move = (delta: number) => { if (selectedId.value) menuTree.value = moveSibling(menuTree.value, selectedId.value, delta) }

const renumber = () => {
  menuTree.value = normalizeOrder(menuTree.value)
  message.value = '已按当前树中顺序回填各层的显示顺序。'
}

/** 组件路径本身已含模块前缀（system/post/index），优先单独使用；只有路由地址时才借祖先路径补全。 */
const deriveRoute = () => {
  const target = selected.value
  if (!target) return
  const parents = selectedLocation.value?.parents.map((parent) => parent.path) ?? []
  const source = target.component || [...parents, target.path].filter(Boolean).join('/')
  if (!source) { message.value = '先填写组件路径或路由地址，再派生路由名称。'; return }
  const routeName = deriveRouteName(source)
  if (!routeName) { message.value = '无法从当前路径派生出路由名称。'; return }
  patch('routeName', routeName)
}

/** 权限码沿用 fork 约定：模块:资源:动作，动作取自节点名或常用动作。 */
const permsActions = ['list', 'query', 'add', 'edit', 'remove', 'export']
const derivePerms = () => {
  const target = selected.value
  if (!target) return
  const parents = selectedLocation.value?.parents ?? []
  // 按钮挂在菜单下，权限前缀取自父菜单；菜单自身则取自己的路径。
  const source = target.menuType === 'F'
    ? [parents.at(-2)?.path, parents.at(-1)?.path].filter(Boolean).join('/')
    : [parents.map((parent) => parent.path).join('/'), target.path || target.component].filter(Boolean).join('/')
  const prefix = derivePermsPrefix(source)
  if (!prefix) { message.value = '无法从上级路径派生出权限前缀，请先补全上级的路由地址。'; return }
  const matched = permsActions.find((action) => target.perms.endsWith(`:${action}`))
  patch('perms', matched ? `${prefix}:${matched}` : `${prefix}:list`)
}

/* ---------- 示例 / 导入导出 ---------- */
const sample = (): MenuNode[] => [
  createNode('M', { menuName: '系统管理', path: 'system', icon: 'system', orderNum: 1, children: [
    createNode('C', { menuName: '岗位管理', path: 'post', component: 'system/post/index', routeName: 'SystemPost', icon: 'post', perms: 'system:post:list', orderNum: 1, children: [
      createNode('F', { menuName: '岗位查询', perms: 'system:post:query', orderNum: 1 }),
      createNode('F', { menuName: '岗位新增', perms: 'system:post:add', orderNum: 2 }),
      createNode('F', { menuName: '岗位删除', perms: 'system:post:remove', orderNum: 3 })
    ] }),
    createNode('C', { menuName: '字典管理', path: 'dict', component: 'system/dict/index', routeName: 'SystemDict', icon: 'dict', perms: 'system:dict:list', orderNum: 2 })
  ] })
]

const loadSample = () => {
  if (hasTree.value && !window.confirm('载入示例会替换当前编辑内容，继续吗？')) return
  menuTree.value = sample()
  selectedId.value = menuTree.value[0].children[0].localId
  collapsed.value = new Set()
  message.value = '已载入示例：系统管理（目录）→ 岗位管理（菜单）→ 查询/新增/删除（按钮）。'
}

const clearAll = () => {
  const hadAnything = hasTree.value || !!sourceText.value
  if (hadAnything && !window.confirm('清空粘贴的菜单树与已生成的节点？')) return
  menuTree.value = []
  sourceText.value = ''
  lastGeneratedJson = ''
  selectedId.value = ''
  message.value = '已清空。'
}

const exportJson = () => download(`${fileName.value.replace(/\.sql$/i, '') || 'menu'}.json`, JSON.stringify({ version: 1, tree: menuTree.value, options: sqlOptions }, null, 2), 'application/json')

const importJson = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const parsed = JSON.parse(await file.text()) as { tree?: unknown; options?: Partial<SqlOptions> }
    if (!Array.isArray(parsed.tree)) throw new Error('文件里找不到 tree 数组')
    menuTree.value = reviveTree(parsed.tree)
    if (parsed.options) Object.assign(sqlOptions, parsed.options)
    selectedId.value = ''
    message.value = `已导入 ${countTree(menuTree.value)} 个菜单节点。`
  } catch (error) {
    message.value = `导入失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    input.value = ''
  }
}

const MENU_TEXT_FIELDS = ['menuName', 'path', 'component', 'query', 'routeName', 'perms', 'icon', 'redirect', 'activeMenu', 'remark'] as const
const MENU_FLAG_FIELDS = ['isFrame', 'isCache', 'visible', 'status'] as const
function reviveTree(raw: unknown[]): MenuNode[] {
  return raw.map((item) => {
    const value = (item ?? {}) as Record<string, unknown>
    const menuType: MenuType = value.menuType === 'M' || value.menuType === 'F' ? value.menuType : 'C'
    const node = createNode(menuType)
    const text = (key: typeof MENU_TEXT_FIELDS[number]) => { if (typeof value[key] === 'string') node[key] = value[key] as string }
    const flag = (key: typeof MENU_FLAG_FIELDS[number]) => { node[key] = value[key] === '1' ? '1' : '0' }
    MENU_TEXT_FIELDS.forEach(text)
    MENU_FLAG_FIELDS.forEach(flag)
    node.orderNum = Number.isFinite(Number(value.orderNum)) ? Number(value.orderNum) : 1
    node.children = Array.isArray(value.children) ? reviveTree(value.children) : []
    return node
  })
}

function countTree(nodes: MenuNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countTree(node.children), 0)
}

const copySql = async () => {
  if (!sql.value) return
  await navigator.clipboard.writeText(sql.value)
  message.value = 'SQL 已复制到剪贴板。'
}

const saveFile = async () => {
  if (!sql.value) return
  if (issueSummary.value.errors) { message.value = `还有 ${issueSummary.value.errors} 个错误未修正，建议先处理再导出。`; return }
  if (!window.menuSqlTools) { message.value = '导出组件未加载，请重启应用；也可以先复制 SQL。'; return }
  try {
    const saved = await window.menuSqlTools.saveScript({ fileName: fileName.value, content: sql.value })
    if (saved) message.value = `已导出到：${saved.path}`
  } catch (error) {
    message.value = `导出失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/* ---------- 草稿 ---------- */
onMounted(() => {
  try {
    sourceText.value = localStorage.getItem(DRAFT_SOURCE_KEY) ?? ''
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (raw) {
      menuTree.value = reviveTree(JSON.parse(raw))
      // 恢复的树视作「上次生成的结果」，避免用户还没微调就被覆盖确认拦住。
      lastGeneratedJson = JSON.stringify(menuTree.value)
      if (menuTree.value.length) message.value = `已恢复上次编辑的 ${countTree(menuTree.value)} 个菜单节点。`
    }
    const rawOptions = localStorage.getItem(DRAFT_OPTIONS_KEY)
    if (rawOptions) Object.assign(sqlOptions, JSON.parse(rawOptions))
  } catch {
    message.value = '上次草稿读取失败，已从空白开始。'
  }
})
watch(menuTree, (tree) => {
  clearTimeout(draftTimer)
  draftTimer = setTimeout(() => localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(tree)), 500)
}, { deep: true })
watch(sourceText, (text) => localStorage.setItem(DRAFT_SOURCE_KEY, text))
watch(sqlOptions, (options) => localStorage.setItem(DRAFT_OPTIONS_KEY, JSON.stringify(options)), { deep: true })
onBeforeUnmount(() => clearTimeout(draftTimer))

const typeModel = computed({
  get: () => selected.value?.menuType ?? 'C',
  set: (value: MenuType) => changeType(value)
})
</script>

<template>
  <ToolboxPage>
    <header class="toolbox-heading">
      <div><p>智能体 / 菜单 SQL</p><h2>菜单管理 SQL 生成器</h2><span>粘贴中文菜单树，由大模型自动译出英文标识并生成 sys_menu 的 MySQL 脚本；数据只存在本机。</span></div>
      <button class="back-button" @click="backToPortal">‹ 返回工具列表</button>
    </header>

    <section class="menu-paste">
      <div class="menu-paste-head">
        <strong>菜单结构</strong>
        <small>支持 markdown 缩进列表，缩进用空格或 Tab，# 开头为注释</small>
      </div>
      <textarea v-model="sourceText" class="menu-source" spellcheck="false" :placeholder="PASTE_PLACEHOLDER"></textarea>

      <div class="menu-generate">
        <label class="menu-model-pick">使用模型
          <select :value="activeModel?.id ?? ''" :disabled="!models.length" @change="setActive(($event.target as HTMLSelectElement).value)">
            <option v-if="!models.length" value="">未配置模型</option>
            <option v-for="model in models" :key="model.id" :value="model.id">{{ model.name }}（{{ model.modelId }}）</option>
          </select>
        </label>
        <button class="primary" :disabled="!hasSource || generating || !modelsReady || !activeModel" @click="generate">
          {{ generating ? 'AI 命名中…' : `⚡ 生成 SQL（${parsedStat.total} 个节点）` }}
        </button>
        <button :disabled="!hasSource || generating" @click="generateOffline">离线生成</button>
        <button @click="draftFileInput?.click()">导入 JSON</button>
        <button :disabled="!hasTree" @click="exportJson">导出 JSON</button>
        <button class="danger" :disabled="!hasTree && !sourceText" @click="clearAll">清空</button>
        <input ref="draftFileInput" class="visually-hidden" type="file" accept="application/json,.json" @change="importJson" />
      </div>
      <p v-if="modelsError" class="tool-message error">{{ modelsError }}</p>
      <p v-else-if="!modelsReady" class="tool-message">正在读取模型配置…</p>
      <p v-else-if="!models.length" class="tool-message">尚未配置模型：点左下角「模型管理」添加一个 OpenAI 兼容服务后即可一键生成。</p>
    </section>

    <p class="tool-message" :class="{ error: issueSummary.errors > 0 }">
      {{ message }}<template v-if="hasTree"> · {{ issueSummary.errors ? `${issueSummary.errors} 个错误` : '校验通过' }}<template v-if="issueSummary.warnings">，{{ issueSummary.warnings }} 个提示</template></template>
    </p>

    <details v-if="hasTree" class="menu-tune">
      <summary>微调（可选）：调整结构、修改个别英文标识或图标</summary>
      <section class="json-actions menu-tune-toolbar">
        <button class="primary" @click="addNode('M', true)">+ 一级目录</button>
        <button :disabled="!selected" @click="addNode('C')">+ 子菜单</button>
        <button :disabled="!selected" @click="addNode('M')">+ 子目录</button>
        <button :disabled="!selected" @click="addNode('F')">+ 按钮</button>
        <button @click="loadSample">示例数据</button>
        <button :disabled="!hasTree" @click="renumber">重排顺序</button>
      </section>

    <section v-if="hasTree" class="menu-workbench">
      <div class="menu-tree-pane">
        <header><strong>菜单结构</strong><small>点击选中 · ▾ 折叠</small></header>
        <ul class="menu-tree">
          <li
            v-for="row in visibleNodes"
            :key="row.node.localId"
            :class="{ active: row.node.localId === selectedId }"
            :style="{ paddingLeft: `${8 + row.depth * 15}px` }"
            @click="selectedId = row.node.localId"
          >
            <button v-if="row.hasChildren" class="menu-caret" @click.stop="toggleCollapse(row.node.localId)">{{ collapsed.has(row.node.localId) ? '▸' : '▾' }}</button>
            <span v-else class="menu-caret menu-caret-blank"></span>
            <em class="menu-type" :class="`type-${row.node.menuType}`">{{ row.node.menuType }}</em>
            <span class="menu-name">{{ row.node.menuName || '（未命名）' }}</span>
            <small v-if="row.node.path">{{ row.node.path }}</small>
            <b v-if="row.errors" class="menu-badge error" title="有错误">!</b>
            <b v-else-if="row.warnings" class="menu-badge" title="有提示">i</b>
          </li>
        </ul>
        <div v-if="selected" class="menu-tree-tools">
          <button :disabled="!canMoveUp" @click="move(-1)">↑ 上移</button>
          <button :disabled="!canMoveDown" @click="move(1)">↓ 下移</button>
          <button class="danger" @click="removeSelected">删除</button>
        </div>
      </div>

      <div class="menu-form-pane">
        <p v-if="!selected" class="menu-empty">从左侧选择一个节点开始编辑，或用上方按钮新增。</p>
        <form v-else class="menu-form" @submit.prevent>
          <header><em>{{ MENU_TYPE_LABEL[selected.menuType] }}</em><strong>{{ selected.menuName || '（未命名）' }}</strong><small>上级：{{ selectedParentName }}</small></header>

          <div class="menu-grid">
            <label>菜单类型
              <select v-model="typeModel"><option value="M">目录 · 仅分组</option><option value="C">菜单 · 打开页面</option><option value="F">按钮 · 仅权限码</option></select>
            </label>
            <label>上级菜单<input :value="selectedParentName" readonly /></label>
            <label>菜单名称<input :value="selected.menuName" placeholder="如：岗位管理" @input="patch('menuName', ($event.target as HTMLInputElement).value)" /></label>
            <label>显示顺序<input type="number" min="0" :value="selected.orderNum" @input="patch('orderNum', Number(($event.target as HTMLInputElement).value) || 0)" /></label>
          </div>

          <template v-if="selected.menuType !== 'F'">
            <div class="menu-grid">
              <label>菜单图标
                <input list="menu-icon-options" :value="selected.icon" placeholder="post" @input="patch('icon', ($event.target as HTMLInputElement).value)" />
                <datalist id="menu-icon-options"><option v-for="icon in MENU_ICONS" :key="icon" :value="icon"></option></datalist>
              </label>
              <label v-if="selected.menuType === 'C'">是否缓存
                <select :value="selected.isCache" @change="patch('isCache', ($event.target as HTMLSelectElement).value as '0' | '1')"><option value="0">{{ FLAG_LABELS.isCache['0'] }}</option><option value="1">{{ FLAG_LABELS.isCache['1'] }}</option></select>
              </label>
              <label>显示状态
                <select :value="selected.visible" @change="patch('visible', ($event.target as HTMLSelectElement).value as '0' | '1')"><option value="0">{{ FLAG_LABELS.visible['0'] }}</option><option value="1">{{ FLAG_LABELS.visible['1'] }}</option></select>
              </label>
              <label>是否外链
                <select :value="selected.isFrame" @change="patch('isFrame', ($event.target as HTMLSelectElement).value as '0' | '1')"><option value="1">{{ FLAG_LABELS.isFrame['1'] }}</option><option value="0">{{ FLAG_LABELS.isFrame['0'] }}</option></select>
              </label>
            </div>
            <label>路由地址
              <input :value="selected.path" :placeholder="selected.menuType === 'M' ? 'system（不带前导 /）' : selectedParentName === '主类目' ? '/system/post' : 'post'" @input="patch('path', ($event.target as HTMLInputElement).value)" />
              <small>{{ selected.menuType === 'M' && selectedParentName === '主类目' ? '一级目录存 system 即可，后端下发时会自动补 “/”。' : '子级写相对路径；一级菜单需以 / 开头。' }}</small>
            </label>
          </template>

          <template v-if="selected.menuType === 'C'">
            <label>组件路径
              <input :value="selected.component" placeholder="system/post/index" @input="patch('component', ($event.target as HTMLInputElement).value)" />
              <small>相对 packages/modules/src，不带 .vue、不带前导 /。</small>
            </label>
            <label>路由名称
              <span class="menu-inline"><input :value="selected.routeName" placeholder="SystemPost" @input="patch('routeName', ($event.target as HTMLInputElement).value)" /><button type="button" @click="deriveRoute">派生</button></span>
              <small>PascalCase 且全局唯一，同时作为 keep-alive 组件名。</small>
            </label>
            <label>路由参数<input :value="selected.query" placeholder='{"type":"user"}' @input="patch('query', ($event.target as HTMLInputElement).value)" /></label>
          </template>

          <label v-if="selected.menuType !== 'M'">权限标识
            <span class="menu-inline"><input :value="selected.perms" placeholder="system:post:list" @input="patch('perms', ($event.target as HTMLInputElement).value)" /><button type="button" @click="derivePerms">派生</button></span>
            <small>格式 模块:资源:动作（list/query/add/edit/remove/export），前端 v-access:code 消费。</small>
          </label>

          <div class="menu-grid">
            <label>菜单状态
              <select :value="selected.status" @change="patch('status', ($event.target as HTMLSelectElement).value as '0' | '1')"><option value="0">{{ FLAG_LABELS.status['0'] }}</option><option value="1">{{ FLAG_LABELS.status['1'] }}</option></select>
            </label>
            <label>重定向<input :value="selected.redirect" placeholder="/system/post" @input="patch('redirect', ($event.target as HTMLInputElement).value)" /></label>
          </div>
          <label>高亮菜单<input :value="selected.activeMenu" placeholder="/system" @input="patch('activeMenu', ($event.target as HTMLInputElement).value)" /><small>详情页需要高亮父菜单时填写。</small></label>
          <label>备注<textarea rows="2" :value="selected.remark" @input="patch('remark', ($event.target as HTMLTextAreaElement).value)"></textarea></label>

          <ul v-if="issuesOfSelected.length" class="menu-field-issues">
            <li v-for="(issue, index) in issuesOfSelected" :key="index" :class="issue.level">{{ issue.message }}</li>
          </ul>
        </form>
      </div>
    </section>
    </details>

    <section v-if="hasTree" class="results-card menu-output">
      <div class="results-heading">
        <div><h3>生成的 SQL</h3><p>{{ sqlOptions.scope === 'branch' ? '仅当前选中节点及其子树' : '整棵菜单树' }}{{ sqlOptions.roleKeys ? ' · 含角色授权' : '' }}</p></div>
        <div class="json-actions">
          <label>范围 <select v-model="sqlOptions.scope"><option value="all">全部</option><option value="branch">选中分支</option></select></label>
          <label class="menu-roles">授权角色<input v-model="sqlOptions.roleKeys" placeholder="admin，逗号分隔" /></label>
          <label class="menu-manual"><input v-model="sqlOptions.manualIds" type="checkbox" /> 手工指定 ID</label>
          <label v-if="sqlOptions.manualIds">起始 ID<input v-model.number="sqlOptions.manualStartId" type="number" min="1" /></label>
          <label>文件名<input v-model="fileName" class="menu-filename" placeholder="sys_menu.sql" /></label>
          <button class="primary" @click="copySql">复制 SQL</button>
          <button @click="saveFile">导出 .sql</button>
        </div>
      </div>
      <textarea class="menu-sql" spellcheck="false" readonly :value="sql"></textarea>
    </section>
  </ToolboxPage>
</template>
