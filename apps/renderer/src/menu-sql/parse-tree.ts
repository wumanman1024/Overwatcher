export interface ParsedLine {
  /** 文档顺序里的稳定 id，也是发给大模型并要求回显的对齐锚点。 */
  id: string
  /** 父行的 id；一级节点为 null。 */
  parentId: string | null
  depth: number
  name: string
}

const BULLET_PATTERN = /^(\s*)(?:[-*+•]|\d+[.)、])\s+(.*)$/
const CHECKBOX_PATTERN = /^\[[ xX]\]\s+/
const TAB_WIDTH = 4

const indentWidth = (indent: string): number => {
  let width = 0
  for (const character of indent) width = character === '\t' ? Math.floor(width / TAB_WIDTH) * TAB_WIDTH + TAB_WIDTH : width + 1
  return width
}

/** 去掉勾选框、成对包裹的引号与结尾冒号，得到干净的菜单名称。 */
function cleanName(raw: string): string {
  let name = raw.replace(CHECKBOX_PATTERN, '').trim()
  name = name.replace(/[:：]\s*$/, '').trim()
  const quoted = /^["'“”](.*)["'“”]$/.exec(name)
  if (quoted) name = quoted[1].trim()
  return name.replace(/\s+/g, ' ')
}

interface Frame { indent: number; id: string }

/**
 * 解析 markdown 缩进列表为扁平父子结构。
 *
 * 深度用「缩进栈」推导而非固定 step 相除：粘贴来源的缩进可能是 2/4/8 空格或 tab 混用，
 * 相除在混用时会算错。栈里维护当前从根到当前行的祖先链，遇到更浅的缩进就出栈回到对应祖先，
 * 因此任意 step、甚至跳级缩进都会被自然处理成「比最近的祖先深一层」，不会凭空多出空层。
 */
export function parseMenuText(text: string): ParsedLine[] {
  const lines: ParsedLine[] = []
  const stack: Frame[] = []

  for (const original of text.split(/\r?\n/)) {
    const trimmedLine = original.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) continue

    const bullet = BULLET_PATTERN.exec(original)
    const rawIndent = bullet ? bullet[1] : /^(\s*)/.exec(original)?.[1] ?? ''
    const name = cleanName(bullet ? bullet[2] : trimmedLine)
    if (!name) continue

    const indent = indentWidth(rawIndent)
    // 回到当前行所属的祖先链：缩进不小于自己的都不是祖先。
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const depth = stack.length

    const id = String(lines.length)
    lines.push({ id, parentId: depth === 0 ? null : stack[stack.length - 1].id, depth, name })
    stack.push({ indent, id })
  }

  return lines
}

/** 统计节点数，供界面上的即时反馈使用。 */
export function countByDepth(lines: ParsedLine[]): { total: number; roots: number; maxDepth: number } {
  return {
    total: lines.length,
    roots: lines.filter((line) => line.depth === 0).length,
    maxDepth: lines.reduce((max, line) => Math.max(max, line.depth + 1), 0)
  }
}
