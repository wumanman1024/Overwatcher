export type MenuType = 'M' | 'C' | 'F'

/** 一条 sys_menu 记录；localId 只用于生成 SQL 时串联父子关系，不入库。 */
export interface MenuNode {
  localId: string
  menuType: MenuType
  menuName: string
  orderNum: number
  path: string
  component: string
  query: string
  routeName: string
  isFrame: '0' | '1'
  isCache: '0' | '1'
  visible: '0' | '1'
  status: '0' | '1'
  perms: string
  icon: string
  redirect: string
  activeMenu: string
  remark: string
  children: MenuNode[]
}

/** 主键来源：雪花 ID（现网惯例）、表自增、手工连续号。 */
export type MenuIdMode = 'snowflake' | 'auto' | 'manual'

export interface SqlOptions {
  /** 授权目标角色的 role_key，逗号分隔；为空则不生成 sys_role_menu 段落。 */
  roleKeys: string
  /** 生成范围：整棵树或仅当前节点及其子树。 */
  scope: 'all' | 'branch'
  /** menu_id 的生成方式。 */
  menuIdMode: MenuIdMode
  /** menuIdMode 为 manual 时的起始 ID。 */
  manualStartId: number
  /** 为每个页面菜单自动补齐 查询/新增/修改/删除 四个按钮。 */
  crudButtons: boolean
  /** create_by / update_by 的落款账号；留空则整列省略，交给库默认值或触发器。 */
  createBy: string
}

export type IssueLevel = 'error' | 'warning'

export interface ValidationIssue {
  level: IssueLevel
  /** 出错节点的 localId，便于在树上高亮定位。 */
  localId: string
  label: string
  message: string
}
