import { MENU_DEFAULTS } from './constants'
import type { MenuNode, MenuType } from './types'

let localIdSeed = 0
const nextLocalId = () => `n${Date.now().toString(36)}${(localIdSeed++).toString(36)}`

export function createNode(menuType: MenuType, overrides: Partial<MenuNode> = {}): MenuNode {
  return {
    localId: nextLocalId(),
    menuType,
    menuName: '',
    orderNum: MENU_DEFAULTS.orderNum,
    path: '',
    component: '',
    query: '',
    routeName: '',
    isFrame: MENU_DEFAULTS.isFrame,
    isCache: MENU_DEFAULTS.isCache,
    visible: MENU_DEFAULTS.visible,
    status: MENU_DEFAULTS.status,
    perms: '',
    icon: '',
    redirect: '',
    activeMenu: '',
    remark: '',
    children: [],
    ...overrides
  }
}

export interface NodeLocation { node: MenuNode; siblings: MenuNode[]; index: number; parents: MenuNode[] }

export function locate(nodes: MenuNode[], localId: string, parents: MenuNode[] = []): NodeLocation | undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node.localId === localId) return { node, siblings: nodes, index, parents }
    const found = locate(node.children, localId, [...parents, node])
    if (found) return found
  }
  return undefined
}

export function findNode(nodes: MenuNode[], localId: string): MenuNode | undefined {
  return locate(nodes, localId)?.node
}

/** 深度优先遍历，回调里拿到节点与它的祖先链（用于生成面包屑标签）。 */
export function walkNodes(nodes: MenuNode[], visit: (node: MenuNode, parents: MenuNode[]) => void, parents: MenuNode[] = []): void {
  for (const node of nodes) {
    visit(node, parents)
    walkNodes(node.children, visit, [...parents, node])
  }
}

export function addChild(nodes: MenuNode[], parentLocalId: string | null, child: MenuNode): MenuNode[] {
  if (!parentLocalId) return [...nodes, child]
  const location = locate(nodes, parentLocalId)
  if (!location) return nodes
  const updated = { ...location.node, children: [...location.node.children, child] }
  return replaceNode(nodes, parentLocalId, updated)
}

export function removeNode(nodes: MenuNode[], localId: string): MenuNode[] {
  return nodes.filter((node) => node.localId !== localId).map((node) => ({ ...node, children: removeNode(node.children, localId) }))
}

export function updateNode(nodes: MenuNode[], localId: string, patch: Partial<MenuNode>): MenuNode[] {
  return nodes.map((node) => node.localId === localId
    ? { ...node, ...patch, children: node.children }
    : { ...node, children: updateNode(node.children, localId, patch) })
}

function replaceNode(nodes: MenuNode[], localId: string, replacement: MenuNode): MenuNode[] {
  return nodes.map((node) => node.localId === localId
    ? replacement
    : { ...node, children: replaceNode(node.children, localId, replacement) })
}

/** 同级上下移动，用于调整 order_num 的相对顺序。 */
export function moveSibling(nodes: MenuNode[], localId: string, delta: number): MenuNode[] {
  const location = locate(nodes, localId)
  if (!location) return nodes
  const target = location.index + delta
  if (target < 0 || target >= location.siblings.length) return nodes
  const next = [...location.siblings]
  const [moved] = next.splice(location.index, 1)
  next.splice(target, 0, moved)
  return location.parents.length === 0
    ? next
    : replaceNode(nodes, location.parents[location.parents.length - 1].localId, {
      ...location.parents[location.parents.length - 1],
      children: next
    })
}

/** 按当前同级顺序回填 order_num（1 起），保证层级与显示顺序一致。 */
export function normalizeOrder(nodes: MenuNode[]): MenuNode[] {
  return nodes.map((node, index) => ({ ...node, orderNum: index + 1, children: normalizeOrder(node.children) }))
}

/** 生成范围=仅本分支时，取选中节点作为新根。 */
export function branchOf(nodes: MenuNode[], localId: string): MenuNode[] {
  const node = findNode(nodes, localId)
  return node ? [node] : nodes
}

const pascal = (value: string) => value
  .split(/[^a-zA-Z0-9]+/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join('')

/** `/system/post` 或 `system/post` → `SystemPost`，用于一键派生 route_name。 */
export function deriveRouteName(source: string): string {
  const cleaned = source.replace(/^\/+/, '').replace(/:\w+/g, '').replace(/^https?:\/\//, '')
  const segments = cleaned.split('/').filter(Boolean)
  // 末段常是 index/list，命名路由时优先取上一个更有语义的段。
  const meaningful = segments.filter((segment) => !['index', 'list', 'view'].includes(segment.toLowerCase()))
  const picked = meaningful.length ? meaningful : segments
  return pascal(picked.slice(-2).join('-'))
}

/** `system/post/index` → `system:post`，配合动作拼成完整权限码。 */
export function derivePermsPrefix(source: string): string {
  const segments = source.replace(/^\/+/, '').split('/').filter(Boolean).filter((segment) => !['index', 'list', 'view'].includes(segment.toLowerCase()))
  return segments.length ? segments.join(':') : ''
}

export function nextOrderNum(siblings: MenuNode[]): number {
  return siblings.reduce((max, node) => Math.max(max, node.orderNum), 0) + 1
}
