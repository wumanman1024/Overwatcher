import type { MenuType } from './types'

/*
 * 本文件的字段语义取自后端 jar 的 MyBatis 映射与字节码，非推测：
 * E:\.maven-repository\com\ultrapower\common-system-mysql\2.0\common-system-mysql-2.0.jar
 *   -> mybatis/system/SysMenuMapper.xml（insertMenu 的列与 <if> 取舍）
 *   -> com.ultrapower.system.service.impl.SysMenuServiceImpl 常量池（Layout / ParentView / InnerLink）
 *   -> com.ultrapower.system.domain.vo.{RouterVo,MetaVo}（visible→hidden、is_cache→noCache 的换算）
 */

export const LAYOUT_COMPONENTS = ['Layout', 'ParentView', 'InnerLink'] as const

/*
 * 以下换算同样来自 SysMenuServiceImpl 字节码，UI 文案必须与之一致：
 *   hidden   = "1".equals(visible)                 → visible '0' 显示 / '1' 隐藏
 *   noCache  = "1".equals(isCache)                 → is_cache '0' 缓存 / '1' 不缓存
 *   一级目录（parent_id=0 且 M 且 is_frame='1'）下发 path = "/" + 库里 path
 *   目录 component 留空时后端按层级补 Layout（顶级）/ ParentView（多级）
 */
export const FLAG_LABELS = {
  visible: { '0': '显示', '1': '隐藏' },
  status: { '0': '正常', '1': '停用' },
  isFrame: { '0': '是外链', '1': '不是外链' },
  isCache: { '0': '缓存', '1': '不缓存' }
} as const

export const MENU_TYPE_LABEL: Record<MenuType, string> = { M: '目录', C: '菜单', F: '按钮' }

/** 表单默认值，与 packages/modules/src/system/menu/menu-form.vue 的 defaults 对齐。 */
export const MENU_DEFAULTS = {
  isCache: '0', isFrame: '1', visible: '0', status: '0', orderNum: 1
} as const

/**
 * 菜单图标可选值：不是 iconify 全集，而是 packages/assets/src/icons/menu/ 下的本地 svg 文件名。
 * IconPicker 与 normalizeLocalSvgName 同时接受裸名和 `svg:` / `menu:` 前缀写法。
 */
export const MENU_ICONS = [
  '404', 'admin', 'bug', 'build', 'button', 'cascader', 'chart', 'checkbox', 'clipboard', 'code',
  'color', 'component', 'dashboard', 'date-range', 'date', 'dict', 'documentation', 'download', 'drag', 'druid',
  'edit', 'education', 'email', 'enter', 'example', 'excel', 'exit-fullscreen', 'eye-open', 'eye', 'form',
  'fullscreen', 'github', 'guide', 'icon', 'input', 'international', 'job', 'language', 'link', 'list',
  'lock', 'log', 'logininfor', 'message', 'money', 'monitor', 'moon', 'more-up', 'nested', 'number',
  'online', 'password', 'pdf', 'people', 'peoples', 'phone', 'post', 'qq', 'question', 'radio',
  'rate', 'redis-list', 'redis', 'row', 'search', 'select', 'server', 'shopping', 'size', 'skill',
  'slider', 'star', 'sunny', 'swagger', 'switch', 'system', 'tab', 'table', 'textarea', 'theme',
  'time-range', 'time', 'tool', 'tree-table', 'tree', 'upload', 'user', 'validCode', 'wechat', 'zip'
] as const

/** 组件路径相对 packages/modules/src，不带 .vue、不带前导斜杠。 */
export const COMPONENT_BASE_HINT = 'packages/modules/src'

export const DRAFT_STORAGE_KEY = 'localforge:menu-sql-draft'
export const DRAFT_OPTIONS_KEY = 'localforge:menu-sql-options'
/** 粘贴进来的中文菜单树原文，与生成结果分开存，改文案不会丢已生成的树。 */
export const DRAFT_SOURCE_KEY = 'localforge:menu-sql-source'
