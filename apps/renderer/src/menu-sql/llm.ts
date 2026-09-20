import { MENU_ICONS } from './constants'
import { createNode, deriveRouteName } from './model'
import type { ParsedLine } from './parse-tree'
import type { MenuNode, MenuType } from './types'

/*
 * 把「中文名称树」变成「可直接生成 SQL 的 MenuNode 树」。
 *
 * 分工是刻意的：大模型只做人类才做得好的那件事——把中文名译成合适的英文 slug、判断节点类型；
 * path / component / routeName / perms 这些有严格格式约定的字段，全部由本地代码拼装
 * （routeName 走 deriveRouteName，perms 前缀走 permsPrefixFor）。这样即使模型输出跑偏，也不可能
 * 产出格式非法的脏数据，validate.ts 的二十来条规则始终是最终裁判。
 */

/** 大模型为单个节点返回的最小信息。 */
interface NamedNode { id: string; slug?: unknown; type?: unknown; action?: unknown; icon?: unknown }

export interface GenerateOutcome { tree: MenuNode[]; notes: string[] }

const ACTIONS = ['list', 'query', 'add', 'edit', 'remove', 'export', 'import'] as const
const ICON_SET = new Set<string>(MENU_ICONS)
const ACTION_HINT = /查询|查看|搜索|新增|添加|新建|修改|编辑|更新|删除|移除|导出|导入|下载|审核|重置|授权|发布/

const SYSTEM_PROMPT = `你是后台管理系统的菜单命名助手。输入是一棵后台菜单树的中文名称，每行格式为「id|深度|父id|名称」（父id 为 - 表示一级节点）。
为每个节点输出：
- slug：1~2 个小写英文单词，用作 URL 路径段，多个词用连字符。禁止拼音、驼峰、下划线、中文。例：岗位管理→post，字典管理→dict，字典数据→dict-data，代码生成→gen，定时任务→job，在线用户→online，登录日志→logininfor，缓存监控→cache。
- type：M=目录（只做分组、下面挂页面）、C=菜单（对应一个具体页面）、F=按钮（页面内的操作，名称是查询/新增/修改/删除/导出等动作词）。判断依据：有子节点且子节点是页面→M；名称是动作词且没有子节点→F；其余→C。
- action：仅 type=F 时给，从 list/query/add/edit/remove/export/import 中选一个最贴切的；type 非 F 时给空字符串。
- icon：仅 type=M 或 C 时给，从下面的图标清单里选语义最接近的一个；选不出来给空字符串。type=F 一律给空字符串。
图标清单：${MENU_ICONS.join(', ')}
硬性要求：必须为每一个输入 id 输出且仅输出一条，id 原样回显、不得增删改；同一父节点下的 slug 不得重复；名称本身已是英文的，slug 直接用其小写规范化形式。
只输出一个 JSON 对象，不要解释、不要 markdown 代码围栏，形如：
{"nodes":[{"id":"0","slug":"system","type":"M","action":"","icon":"system"}]}`

/** 给模型的行：带深度与父 id，让它能靠父子语境判断 M/C/F 并保证同模块 slug 一致。 */
function buildUserPrompt(lines: ParsedLine[]): string {
  const body = lines.map((line) => `${line.id}|${line.depth}|${line.parentId ?? '-'}|${line.name}`).join('\n')
  return `菜单节点如下：\n${body}`
}

/** 模型可能包 markdown 围栏、也可能前后带说明文字，这里逐层剥到第一个完整 JSON 对象。 */
function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('模型没有返回 JSON 结果')
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('模型返回的 JSON 无法解析，可降低思考强度或减少节点数后重试')
  }
}

const normalizeSlug = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/** 中文名没有离线翻译能力时的兜底：纯英文名规范化，否则用占位 slug 并提示用户去微调。 */
function fallbackSlug(line: ParsedLine, index: number, notes: string[]): string {
  if (/^[\x00-\x7F]+$/.test(line.name)) {
    const slug = normalizeSlug(line.name)
    if (slug) return slug
  }
  notes.push(`「${line.name}」未能译成英文，已用占位标识，请在「微调」里修正。`)
  return `menu${index + 1}`
}

const typeOf = (value: unknown, hasChildren: boolean): MenuType => {
  if (hasChildren && value === 'F') return 'C' // 按钮下不可能再挂节点，模型给错了就纠正。
  return value === 'M' || value === 'C' || value === 'F' ? value : 'C'
}

/** 中文动作词到权限动作的映射，模型漏答时兜底用。 */
const ACTION_BY_WORD: Array<[RegExp, string]> = [
  [/查询|查看|搜索|详情/, 'query'],
  [/新增|添加|新建/, 'add'],
  [/修改|编辑|更新/, 'edit'],
  [/删除|移除/, 'remove'],
  [/导出|下载/, 'export'],
  [/导入|上传/, 'import']
]

const guessAction = (name: string): string => ACTION_BY_WORD.find(([pattern]) => pattern.test(name))?.[1] ?? 'list'

const actionOf = (value: unknown, name: string): string => {
  const action = typeof value === 'string' ? value.toLowerCase() : ''
  return (ACTIONS as readonly string[]).includes(action) ? action : guessAction(name)
}

const iconOf = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const bare = value.trim().replace(/^(?:svg|menu):/, '')
  return ICON_SET.has(bare) ? bare : ''
}

/** 同一父级下 slug 撞车会让 path 重复，追加序号后缀区分开。按钮不产生路径，不参与去重。 */
function dedupeSlugs(lines: ParsedLine[], slugs: Map<string, string>, types: Map<string, MenuType>, notes: string[]): Map<string, string> {
  const used = new Map<string, number>()
  const resolved = new Map<string, string>()
  for (const line of lines) {
    const base = slugs.get(line.id) as string
    if (types.get(line.id) === 'F') { resolved.set(line.id, base); continue }
    const key = `${line.parentId ?? '#'}::${base}`
    const seen = used.get(key) ?? 0
    used.set(key, seen + 1)
    if (!seen) { resolved.set(line.id, base); continue }
    const suffix = seen + 1
    notes.push(`「${line.name}」的英文标识与同级重复，已改为 ${base}-${suffix}。`)
    resolved.set(line.id, `${base}-${suffix}`)
  }
  return resolved
}

export function buildTree(lines: ParsedLine[], content: string): GenerateOutcome {
  const parsed = extractJson(content)
  const items = (parsed as { nodes?: unknown }).nodes
  if (!Array.isArray(items)) throw new Error('模型返回的结果里没有 nodes 数组')

  // 按 id 对齐而不是按位置：模型漏项、换序时，位置对齐会整体错位、静默串行。
  const byId = new Map<string, NamedNode>()
  for (const item of items) {
    const candidate = item as NamedNode
    if (candidate && typeof candidate.id === 'string') byId.set(candidate.id, candidate)
  }

  const notes: string[] = []
  const childCount = new Map<string, number>()
  for (const line of lines) if (line.parentId) childCount.set(line.parentId, (childCount.get(line.parentId) ?? 0) + 1)

  const rawSlugs = new Map<string, string>()
  const types = new Map<string, MenuType>()
  const actions = new Map<string, string>()
  const icons = new Map<string, string>()
  let missing = 0
  lines.forEach((line, index) => {
    const named = byId.get(line.id)
    if (named) {
      const slug = normalizeSlug(named.slug)
      rawSlugs.set(line.id, slug || fallbackSlug(line, index, notes))
      types.set(line.id, typeOf(named.type, (childCount.get(line.id) ?? 0) > 0))
      actions.set(line.id, actionOf(named.action, line.name))
      icons.set(line.id, iconOf(named.icon))
    } else {
      missing += 1
      rawSlugs.set(line.id, fallbackSlug(line, index, notes))
      const isActionLeaf = (childCount.get(line.id) ?? 0) === 0 && ACTION_HINT.test(line.name)
      types.set(line.id, isActionLeaf ? 'F' : 'C')
      actions.set(line.id, guessAction(line.name))
      icons.set(line.id, '')
    }
  })
  if (missing) notes.push(`${missing} 个节点模型未返回，已用兜底规则填充，请在「微调」里核对。`)

  const slugs = dedupeSlugs(lines, rawSlugs, types, notes)

  /*
   * 纠正「被误判为目录的页面」：模型偶尔把「用户管理」这类既挂按钮又不对应分组的节点给成 M。
   * 目录没有 component，前端打不开页面；而按钮必须挂在页面上。因此只要某节点的子节点里
   * 出现了按钮、又没有页面（C），它自身就一定是页面，按 C 处理。子级混合了页面时保留 M。
   */
  for (const line of lines) {
    if (types.get(line.id) !== 'M') continue
    const children = lines.filter((child) => child.parentId === line.id)
    if (!children.length) continue
    const hasButton = children.some((child) => types.get(child.id) === 'F')
    const hasPage = children.some((child) => types.get(child.id) === 'C')
    if (hasButton && !hasPage) {
      types.set(line.id, 'C')
      notes.push(`「${line.name}」下只挂按钮，已按页面（菜单）处理。`)
    }
  }

  const byIdLine = new Map(lines.map((line) => [line.id, line]))
  /** 取祖先链的 slug（跳过按钮，按钮不参与路径）。 */
  const ancestorSlugs = (line: ParsedLine): string[] => {
    const chain: string[] = []
    let parentId = line.parentId
    while (parentId) {
      const parent = byIdLine.get(parentId)
      if (!parent) break
      if (types.get(parentId) !== 'F') chain.unshift(slugs.get(parentId) as string)
      parentId = parent.parentId
    }
    return chain
  }

  const routeNames = new Set<string>()
  const nodeMap = new Map<string, MenuNode>()
  /*
   * 权限码固定为 模块:资源 两段（再加动作即三段），与 validate.ts 校验的约定一致。
   * 不能直接把整条祖先链拼进去：二级页面（如 系统管理/日志管理/操作日志）会拼出
   * system:log:operlog:list 这样的四段码，不符合约定。取「顶级模块 + 自身资源」即可保持唯一。
   */
  const permsPrefixFor = (line: ParsedLine): string => {
    const slug = slugs.get(line.id) as string
    const module = ancestorSlugs(line)[0]
    return !module || module === slug ? slug : `${module}:${slug}`
  }
  // lines 是文档顺序，父节点必然先于子节点出现，组装子节点时父的 component 已就绪。
  for (const line of lines) {
    const slug = slugs.get(line.id) as string
    const menuType = types.get(line.id) as MenuType
    const parents = ancestorSlugs(line)
    const orderNum = siblingOrder(lines, line)
    const node = createNode(menuType, { menuName: line.name, orderNum, icon: menuType === 'F' ? '' : icons.get(line.id) as string })

    if (menuType === 'F') {
      // 按钮权限前缀跟着父菜单走：父菜单的 perms 形如 模块:资源:list，去掉动作段即是前缀；
      // 父级是目录（没有 perms）时退回按「模块:资源」推导。
      const parentLine = line.parentId ? byIdLine.get(line.parentId) : undefined
      const parentNode = parentLine ? nodeMap.get(parentLine.id) : undefined
      const prefix = parentNode?.perms ? parentNode.perms.replace(/:[^:]+$/, '') : parentLine ? permsPrefixFor(parentLine) : ''
      if (prefix) node.perms = `${prefix}:${actions.get(line.id)}`
    } else {
      node.path = parents.length === 0 ? (menuType === 'C' ? `/${slug}` : slug) : slug
      if (menuType === 'C') {
        node.component = [...parents, slug, 'index'].join('/')
        let routeName = deriveRouteName(node.component)
        if (!routeName) routeName = slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
        let unique = routeName
        let suffix = 2
        while (routeNames.has(unique)) { unique = `${routeName}${suffix}`; suffix += 1 }
        if (unique !== routeName) notes.push(`路由名称 ${routeName} 重复，已改为 ${unique}。`)
        routeNames.add(unique)
        node.routeName = unique
        node.perms = `${permsPrefixFor(line)}:list`
      }
    }
    nodeMap.set(line.id, node)
  }

  const roots: MenuNode[] = []
  for (const line of lines) {
    const node = nodeMap.get(line.id) as MenuNode
    if (!line.parentId) roots.push(node)
    else nodeMap.get(line.parentId)?.children.push(node)
  }
  return { tree: roots, notes: [...new Set(notes)] }
}

/** 同一父级下的显示顺序（1 起）。 */
function siblingOrder(lines: ParsedLine[], target: ParsedLine): number {
  let order = 0
  for (const line of lines) {
    if (line.parentId === target.parentId) order += 1
    if (line.id === target.id) return order
  }
  return 1
}

export { buildUserPrompt, SYSTEM_PROMPT }
