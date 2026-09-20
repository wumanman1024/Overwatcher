import { COMPONENT_BASE_HINT, LAYOUT_COMPONENTS, MENU_ICONS, MENU_TYPE_LABEL } from './constants'
import { walkNodes } from './model'
import type { MenuNode, ValidationIssue } from './types'

const pascalPattern = /^[A-Z][A-Za-z0-9]*$/
const httpPattern = /^https?:\/\/.+/i

const labelOf = (node: MenuNode, parents: MenuNode[]) => [...parents.map((parent) => parent.menuName || '（未命名）'), node.menuName || '（未命名）'].join(' / ')

/** 按 @ultrapower vben fork 的约定检查一棵菜单树，产出可定位到节点的中文问题清单。 */
export function validateMenuTree(roots: MenuNode[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const iconSet = new Set<string>(MENU_ICONS)
  const routeNames = new Map<string, number>()
  const seenNames = new Map<string, number>()

  walkNodes(roots, (node, parents) => {
    const label = labelOf(node, parents)
    const push = (level: ValidationIssue['level'], message: string) => issues.push({ level, localId: node.localId, label, message })

    if (!node.menuName.trim()) push('error', '菜单名称不能为空。')

    if (node.menuType !== 'F') {
      if (!node.path.trim()) push('error', `${MENU_TYPE_LABEL[node.menuType]}必须填写路由地址。`)
      if (node.isFrame === '0' && node.path && !httpPattern.test(node.path)) push('error', '标记为外链时，路由地址必须以 http:// 或 https:// 开头。')
      if (node.isFrame === '1' && httpPattern.test(node.path)) push('warning', '路由地址是 URL 但「是否外链」为否，前端会按内部路由解析。')

      // 后端 SysMenuServiceImpl#getRouterPath：parent_id=0 且 menu_type='M' 且 is_frame='1' 时，
      // 下发给前端的是 "/" + 库里的 path。因此一级目录入库值不能再带前导 /，否则会拼成 //system。
      const topLevelDir = parents.length === 0 && node.menuType === 'M' && node.isFrame === '1'
      if (topLevelDir && node.path.startsWith('/')) push('error', '一级目录的路由地址不要带前导 /，后端会自动补 "/"（写了会拼成 //）。')
      // 菜单 C 由前端挂在根 Layout 下，顶级时 path 需要自带 /；子级节点写相对路径。
      if (parents.length === 0 && node.menuType === 'C' && node.path && !node.path.startsWith('/') && node.isFrame === '1') push('error', '一级菜单的路由地址必须以 / 开头。')
      if (parents.length > 0 && node.path.startsWith('/')) push('warning', '子菜单的路由地址通常写成相对路径，不带前导 /。')

      // SysMenuServiceImpl#getComponent：目录的 component 留空即可，后端会按层级补 Layout / ParentView。
      if (node.menuType === 'M' && node.component.trim()) push('warning', `目录的组件路径通常留空，后端会自动填 ${parents.length === 0 ? 'Layout' : 'ParentView'}。`)
    }

    if (node.menuType === 'C') {
      if (!node.component.trim()) push('error', '菜单必须填写组件路径。')
      else if (node.component.endsWith('.vue')) push('error', `组件路径不要带 .vue 后缀，应写相对 ${COMPONENT_BASE_HINT} 的目录路径。`)
      else if (node.component.startsWith('/')) push('error', '组件路径不要以前导 / 开头。')
      else if (!LAYOUT_COMPONENTS.includes(node.component as typeof LAYOUT_COMPONENTS[number]) && !node.component.includes('/')) push('warning', '组件路径通常形如 system/post/index，只有一段可能找不到页面。')

      if (!node.routeName.trim()) push('error', '菜单必须填写路由名称（同时作为 keep-alive 组件名）。')
      else if (!pascalPattern.test(node.routeName)) push('error', `路由名称 "${node.routeName}" 不是 PascalCase（如 SystemPost）。`)
    }

    if (node.menuType === 'F') {
      if (!node.perms.trim()) push('error', '按钮节点必须填写权限标识，否则前端 v-access 无码可用。')
      if (node.path.trim()) push('warning', '按钮节点不产生路由，路由地址会被忽略。')
    }

    if (node.perms && !/^[A-Za-z0-9_-]+(?::[A-Za-z0-9_*-]+){1,2}$/.test(node.perms)) push('warning', `权限标识 "${node.perms}" 不符合 模块:资源:动作 约定。`)

    if (node.icon) {
      const bare = node.icon.replace(/^(?:svg|menu):/, '')
      if (!iconSet.has(bare)) push('warning', `图标 "${node.icon}" 不在菜单图标库中，会回退为默认图标。`)
    }

    if (node.routeName) routeNames.set(node.routeName, (routeNames.get(node.routeName) ?? 0) + 1)
    if (node.menuName.trim()) {
      const key = `${parents.at(-1)?.localId ?? 'root'}::${node.menuName.trim()}`
      seenNames.set(key, (seenNames.get(key) ?? 0) + 1)
    }

    if (parents.length >= 3) push('warning', '层级超过 3 级，侧边栏可能显示异常。')
  })

  // 计数在遍历中累积，这里再走一遍，把参与冲突的每个节点都标出来。
  walkNodes(roots, (node, parents) => {
    if (node.routeName && (routeNames.get(node.routeName) ?? 0) > 1) {
      issues.push({ level: 'error', localId: node.localId, label: labelOf(node, parents), message: `路由名称 "${node.routeName}" 重复，vue-router 要求全局唯一。` })
    }
    if (node.menuName.trim() && (seenNames.get(`${parents.at(-1)?.localId ?? 'root'}::${node.menuName.trim()}`) ?? 0) > 1) {
      issues.push({ level: 'error', localId: node.localId, label: labelOf(node, parents), message: `同级已存在同名菜单 "${node.menuName}"，后端按（名称+父级）判重会拒绝。` })
    }
  })

  return issues
}

export function summarize(issues: ValidationIssue[]): { errors: number; warnings: number } {
  return { errors: issues.filter((issue) => issue.level === 'error').length, warnings: issues.filter((issue) => issue.level === 'warning').length }
}
