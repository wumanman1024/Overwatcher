import { branchOf, locate, walkNodes } from './model'
import type { MenuNode, SqlOptions } from './types'

const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
const sqlValue = (value: string) => (value.trim() ? quote(value.trim()) : 'NULL')
const roleVariable = (roleKey: string) => `r_${roleKey.replace(/[^A-Za-z0-9_]/g, '_')}`
const TYPE_TAG: Record<MenuNode['menuType'], string> = { M: '目录', C: '菜单', F: '按钮' }
/** 只导出分支时，分支根的上级不在脚本内，用它占位并由脚本头部提示替换。 */
const BRANCH_PARENT_PLACEHOLDER = '@parent_menu_id'

/** 一行待生成的菜单，附带引用它时使用的 SQL 表达式（会话变量或字面量 ID）。 */
interface PlannedRow { node: MenuNode; parents: MenuNode[]; ref: string }

/**
 * 深度优先展开成线性 INSERT 序列。父节点必然先于子节点出现，
 * 因此自增模式下 parent_id 可直接引用父节点的 LAST_INSERT_ID() 变量；
 * 手工 ID 模式下父子共用同一套连续编号，起始值由用户指定。
 */
function planRows(roots: MenuNode[], manualIds: boolean, startId: number): PlannedRow[] {
  const rows: PlannedRow[] = []
  walkNodes(roots, (node, parents) => {
    rows.push({ node, parents, ref: manualIds ? String(startId + rows.length) : `@m${rows.length + 1}` })
  })
  return rows
}

/** 可空列：值为空时整列省略，与后端 insertMenu 的 <if test="x != ''"> 行为一致。 */
const OPTIONAL_FIELDS: Array<{ column: string; read: (node: MenuNode) => string }> = [
  { column: 'path', read: (node) => node.path },
  { column: 'component', read: (node) => node.component },
  { column: '`query`', read: (node) => node.query },
  { column: 'route_name', read: (node) => node.routeName },
  { column: 'perms', read: (node) => node.perms },
  { column: 'icon', read: (node) => node.icon },
  { column: 'redirect', read: (node) => node.redirect },
  { column: 'active_menu', read: (node) => node.activeMenu },
  { column: 'remark', read: (node) => node.remark }
]

function insertStatement(node: MenuNode, parentRef: string, manualId: string | null): string {
  const pairs: Array<[string, string]> = []
  if (manualId) pairs.push(['menu_id', manualId])
  pairs.push(
    ['menu_name', sqlValue(node.menuName)],
    ['parent_id', parentRef],
    ['order_num', String(node.orderNum)],
    ['menu_type', quote(node.menuType)],
    ['visible', quote(node.visible)],
    ['status', quote(node.status)],
    ['is_frame', quote(node.isFrame)],
    ['is_cache', quote(node.isCache)]
  )
  // 路由地址对 M/C 必填，为空说明还没填完；仍按可空列省略，交由校验器提示而不是在这里抛错。
  for (const { column, read } of OPTIONAL_FIELDS) {
    const value = read(node)
    if (value.trim()) pairs.push([column, sqlValue(value)])
  }
  pairs.push(['create_time', 'NOW()'], ['update_time', 'NOW()'])
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
  const manualIds = options.manualIds
  const rows = planRows(scoped, manualIds, Math.max(1, Math.trunc(options.manualStartId) || 1))
  const roleKeys = [...new Set(options.roleKeys.split(',').map((value) => value.trim()).filter(Boolean))]
  const countOf = (type: MenuNode['menuType']) => rows.filter((row) => row.node.menuType === type).length
  // branchOf 会把选中节点变成新根、丢掉它的祖先链，因此父级名称要回到完整树里查。
  const branchParent = branchMode ? locate(roots, selectedLocalId as string)?.parents.at(-1) : undefined

  const lines: string[] = [
    '-- 由 LocalForge「菜单 SQL 生成器」导出',
    `-- 节点：${rows.length}（目录 ${countOf('M')} / 菜单 ${countOf('C')} / 按钮 ${countOf('F')}）${branchMode ? ' · 仅选中分支' : ''}`,
    manualIds
      ? `-- 主键：手工指定 menu_id，自 ${rows[0]?.ref ?? '-'} 起按深度优先顺序连续编号；执行前请确认与现网既有 ID 不冲突`
      : '-- 主键：依赖 sys_menu.menu_id 自增；父子关系用 LAST_INSERT_ID() 会话变量串联，换库执行无需改动',
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
    lines.push(insertStatement(row.node, parentRefFor(rows, row, index === 0 && !!branchParent), manualIds ? row.ref : null))
    if (!manualIds) lines.push(`SET ${row.ref} := LAST_INSERT_ID();`)
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
