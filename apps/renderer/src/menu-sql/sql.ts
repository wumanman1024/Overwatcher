import { branchOf, createNode, locate, walkNodes } from './model'
import { nextSnowflakeId } from './snowflake'
import type { MenuIdMode, MenuNode, SqlOptions } from './types'

const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
const sqlValue = (value: string) => (value.trim() ? quote(value.trim()) : 'NULL')
const roleVariable = (roleKey: string) => `r_${roleKey.replace(/[^A-Za-z0-9_]/g, '_')}`
const TYPE_TAG: Record<MenuNode['menuType'], string> = { M: '目录', C: '菜单', F: '按钮' }
/** 只导出分支时，分支根的上级不在脚本内，用它占位并由脚本头部提示替换。 */
const BRANCH_PARENT_PLACEHOLDER = '@parent_menu_id'

/** 默认补齐的增删改查按钮：动作码与现网 system:post:query/add/edit/remove 的惯例一致。 */
const CRUD_BUTTONS: Array<{ name: string; action: string }> = [
  { name: '查询', action: 'query' },
  { name: '新增', action: 'add' },
  { name: '修改', action: 'edit' },
  { name: '删除', action: 'remove' }
]

/** 一行待生成的菜单，附带引用它时使用的 SQL 表达式（字面量 ID 或会话变量）。 */
interface PlannedRow { node: MenuNode; parents: MenuNode[]; ref: string }

/**
 * 为每个页面菜单补上增删改查四个按钮。已有按钮的菜单跳过，避免把用户手工维护的
 * 按钮重复一套；权限前缀取菜单自身 perms 去掉动作段。返回全新节点，绝不就地改界面那棵树。
 */
function withCrudButtons(roots: MenuNode[]): MenuNode[] {
  const visit = (node: MenuNode): MenuNode => {
    const children = node.children.map(visit)
    const needsCrud = node.menuType === 'C' && !!node.perms && !children.some((child) => child.menuType === 'F')
    if (!needsCrud) return { ...node, children }
    // 菜单 perms 形如 system:post:list，去掉动作段就是按钮的权限前缀。
    const prefix = node.perms.replace(/:[^:]+$/, '')
    let order = children.reduce((max, child) => Math.max(max, child.orderNum), 0)
    const buttons = CRUD_BUTTONS.map((button) => createNode('F', {
      // localId 由父节点与动作确定，重算时不变，雪花 ID 缓存才能命中。
      localId: `${node.localId}::crud:${button.action}`,
      menuName: `${node.menuName.replace(/管理$/, '')}${button.name}`,
      perms: `${prefix}:${button.action}`,
      orderNum: (order += 1)
    }))
    return { ...node, children: [...children, ...buttons] }
  }
  return roots.map(visit)
}

/**
 * 雪花 ID 按节点缓存：SQL 预览是 computed，改范围/角色等任何选项都会重算整段脚本；
 * 若每次都现取新 ID，用户会看到满屏 ID 不停跳动，刚复制的脚本也和屏幕上显示的对不上。
 * 深度优先展开成线性 INSERT 序列时按 localId 取号，同一棵树的 ID 因此稳定可复现。
 */
const snowflakeByLocalId = new Map<string, string>()

function planRows(roots: MenuNode[], mode: MenuIdMode, startId: number): PlannedRow[] {
  const rows: PlannedRow[] = []
  walkNodes(roots, (node, parents) => {
    const index = rows.length
    let ref: string
    if (mode === 'snowflake') {
      ref = snowflakeByLocalId.get(node.localId) ?? nextSnowflakeId()
      snowflakeByLocalId.set(node.localId, ref)
    } else ref = mode === 'manual' ? String(startId + index) : `@m${index + 1}`
    rows.push({ node, parents, ref })
  })
  return rows
}

/** 可空列：值为空时整列省略，与后端 insertMenu 的 <if test="x != ''"> 行为一致。两组按 sys_menu 表定义的列序切开，中间夹固定的标志列。 */
type FieldReader = { column: string; read: (node: MenuNode) => string }
const FIELDS_BEFORE_FLAGS: FieldReader[] = [
  { column: 'path', read: (node) => node.path },
  { column: 'component', read: (node) => node.component },
  { column: '`query`', read: (node) => node.query },
  { column: 'route_name', read: (node) => node.routeName }
]
const FIELDS_AFTER_FLAGS: FieldReader[] = [
  { column: 'perms', read: (node) => node.perms },
  { column: 'icon', read: (node) => node.icon },
  { column: 'redirect', read: (node) => node.redirect },
  { column: 'active_menu', read: (node) => node.activeMenu }
]

/** 路由地址对 M/C 必填，为空说明还没填完；仍按可空列省略，交由校验器提示而不是在这里抛错。 */
function pushOptional(pairs: Array<[string, string]>, node: MenuNode, fields: FieldReader[]): void {
  for (const { column, read } of fields) {
    const value = read(node)
    if (value.trim()) pairs.push([column, sqlValue(value)])
  }
}

function insertStatement(node: MenuNode, parentRef: string, manualId: string | null, createBy: string): string {
  const pairs: Array<[string, string]> = []
  if (manualId) pairs.push(['menu_id', manualId])
  pairs.push(
    ['menu_name', sqlValue(node.menuName)],
    ['parent_id', parentRef],
    ['order_num', String(node.orderNum)]
  )
  pushOptional(pairs, node, FIELDS_BEFORE_FLAGS)
  pairs.push(
    ['is_frame', quote(node.isFrame)],
    ['is_cache', quote(node.isCache)],
    ['menu_type', quote(node.menuType)],
    ['visible', quote(node.visible)],
    ['status', quote(node.status)]
  )
  pushOptional(pairs, node, FIELDS_AFTER_FLAGS)
  const author = createBy.trim()
  if (author) pairs.push(['create_by', quote(author)])
  pairs.push(['create_time', 'NOW()'])
  if (author) pairs.push(['update_by', quote(author)])
  pairs.push(['update_time', 'NOW()'])
  // remark 在表定义里位于 update_time 之后，放在最后与现网导出的行逐列对齐。
  if (node.remark.trim()) pairs.push(['remark', sqlValue(node.remark)])
  const width = Math.max(...pairs.map(([column]) => column.length))
  // 用「列 = 值」写法而非位置化 VALUES，逐行可读、可逐行与后台界面生成的记录比对。
  return `INSERT INTO sys_menu\nSET\n${pairs.map(([column, value]) => `  ${column.padEnd(width)} = ${value}`).join(',\n')};`
}

function commentFor(node: MenuNode): string {
  const tail = node.menuType === 'C' ? node.component : node.menuType === 'F' ? node.perms : node.path
  return `-- [${node.menuType}·${TYPE_TAG[node.menuType]}] ${node.menuName || '（未命名）'}${tail ? ` → ${tail}` : ''}`
}

/** 分支根的上级不在脚本内（branchOf 会丢掉祖先链），必须优先于父级查找返回占位符。 */
function parentRefFor(rows: PlannedRow[], row: PlannedRow, isBranchRoot: boolean): string {
  if (isBranchRoot) return BRANCH_PARENT_PLACEHOLDER
  const parent = row.parents.at(-1)
  if (!parent) return '0'
  return rows.find((candidate) => candidate.node.localId === parent.localId)?.ref ?? '0'
}

export function generateSql(roots: MenuNode[], options: SqlOptions, selectedLocalId?: string): string {
  const branchMode = options.scope === 'branch' && !!selectedLocalId
  const scoped = branchMode ? branchOf(roots, selectedLocalId as string) : roots
  const source = options.crudButtons ? withCrudButtons(scoped) : scoped
  const mode = options.menuIdMode
  const rows = planRows(source, mode, Math.max(1, Math.trunc(options.manualStartId) || 1))
  const roleKeys = [...new Set(options.roleKeys.split(',').map((value) => value.trim()).filter(Boolean))]
  const countOf = (type: MenuNode['menuType']) => rows.filter((row) => row.node.menuType === type).length
  // branchOf 会把选中节点变成新根、丢掉它的祖先链，因此父级名称要回到完整树里查。
  const branchParent = branchMode ? locate(roots, selectedLocalId as string)?.parents.at(-1) : undefined

  const header = mode === 'snowflake'
    ? '-- 主键：雪花 ID，执行前请确认与现网既有 menu_id 不冲突'
    : mode === 'manual'
      ? `-- 主键：手工指定 menu_id，自 ${rows[0]?.ref ?? '-'} 起按深度优先顺序连续编号；执行前请确认与现网既有 ID 不冲突`
      : '-- 主键：依赖 sys_menu.menu_id 自增；父子关系用 LAST_INSERT_ID() 会话变量串联，换库执行无需改动'

  const lines: string[] = [
    '-- 由 LocalForge「菜单 SQL 生成器」导出',
    `-- 节点：${rows.length}（目录 ${countOf('M')} / 菜单 ${countOf('C')} / 按钮 ${countOf('F')}）${branchMode ? ' · 仅选中分支' : ''}${options.crudButtons ? ' · 已补增删改查按钮' : ''}`,
    header,
    '',
    'SET NAMES utf8mb4;'
  ]

  if (branchParent) {
    lines.push(
      `-- 注意：本分支的上级「${branchParent.menuName || '（未命名）'}」不在脚本内`,
      `--       执行前请把下面的 @parent_menu_id 改成它在目标库中的 menu_id`,
      `SET ${BRANCH_PARENT_PLACEHOLDER} := 0; -- TODO 替换为上级菜单的 menu_id`
    )
  }

  lines.push('', 'START TRANSACTION;', '')

  rows.forEach((row, index) => {
    lines.push(commentFor(row.node))
    lines.push(insertStatement(row.node, parentRefFor(rows, row, index === 0 && !!branchParent), mode === 'auto' ? null : row.ref, options.createBy))
    if (mode === 'auto') lines.push(`SET ${row.ref} := LAST_INSERT_ID();`)
    if (index < rows.length - 1) lines.push('')
  })

  if (roleKeys.length) {
    lines.push(
      '',
      '-- 授权给角色：按 role_key 反查 role_id，避免手工查表填错',
      ...roleKeys.map((roleKey) => `SET @${roleVariable(roleKey)} := (SELECT role_id FROM sys_role WHERE role_key = ${quote(roleKey)} AND del_flag = '0');`)
    )
    for (const roleKey of roleKeys) {
      const pairs = rows.map((row) => `(@${roleVariable(roleKey)}, ${row.ref})`)
      lines.push('', `-- 角色 ${roleKey}`)
      // sys_role_menu 在标准 RuoYi 里以 (role_id, menu_id) 为主键；若实际无唯一约束，重复执行会产生重复行。
      lines.push(`INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES\n  ${pairs.join(',\n  ')};`)
    }
  }

  lines.push('', 'COMMIT;', '')
  return lines.join('\n')
}
