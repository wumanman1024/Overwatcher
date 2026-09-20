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

/* ------------------------------------------------------------------ */
/* 树形编辑器：菜单结构 = 一行一个节点（id + 深度 + 名称）的扁平序列。  */
/* 深度是唯一事实（与 parseMenuText 同规则），parentId 用时再推导，    */
/* 这样缩进/移动只需改一个数字，不必重排整棵子树的指针。               */
/* ------------------------------------------------------------------ */

export interface EditorLine { id: string; depth: number; name: string }

let editorIdSeed = 0
export const newEditorId = () => `e${Date.now().toString(36)}${(editorIdSeed++).toString(36)}`

/** 按缩进列表序列化回 markdown 文本，供切回「文本粘贴」模式时回填 textarea。 */
export function serializeMenuText(lines: EditorLine[]): string {
  return lines.map((line) => `${'  '.repeat(line.depth)}- ${line.name}`).join('\n')
}

/** textarea 文本 → 编辑器行（id 现场生成，仅作 v-for key 与操作定位）。 */
export function editorLinesFromText(text: string): EditorLine[] {
  return parseMenuText(text).map((line) => ({ id: newEditorId(), depth: line.depth, name: line.name }))
}

/**
 * 补上 id/parentId，产出与 parseMenuText 完全同构的 ParsedLine[]。
 * 父级用深度栈推导（同一份约定，两处实现会漂移）：id 取文档序下标，保证发给模型的锚点稳定。
 */
export function linkEditorLines(lines: EditorLine[]): ParsedLine[] {
  const out: ParsedLine[] = []
  const stack: { depth: number; id: string }[] = []
  for (const [index, line] of lines.entries()) {
    while (stack.length && stack[stack.length - 1].depth >= line.depth) stack.pop()
    const id = String(index)
    out.push({ id, parentId: stack.length ? stack[stack.length - 1].id : null, depth: line.depth, name: line.name })
    stack.push({ depth: line.depth, id })
  }
  return out
}

/** index 处节点（连同整棵子树）的右开区间终点。 */
function subtreeEnd(lines: EditorLine[], index: number): number {
  let end = index + 1
  while (end < lines.length && lines[end].depth > lines[index].depth) end += 1
  return end
}

const shiftDepths = (lines: EditorLine[], start: number, end: number, delta: number): EditorLine[] =>
  lines.map((line, index) => (index >= start && index < end ? { ...line, depth: line.depth + delta } : line))

export function addRootLine(lines: EditorLine[]): EditorLine[] {
  return [...lines, { id: newEditorId(), depth: 0, name: '' }]
}

/** 在指定节点子树的末尾追加一个子级（保持子级紧邻父级）。 */
export function addChildLine(lines: EditorLine[], id: string): EditorLine[] {
  const index = lines.findIndex((line) => line.id === id)
  if (index === -1) return lines
  const child: EditorLine = { id: newEditorId(), depth: lines[index].depth + 1, name: '' }
  const end = subtreeEnd(lines, index)
  return [...lines.slice(0, end), child, ...lines.slice(end)]
}

/** 回车续行：在本节点子树之后补一个同级节点。 */
export function addSiblingLine(lines: EditorLine[], id: string): EditorLine[] {
  const index = lines.findIndex((line) => line.id === id)
  if (index === -1) return lines
  const sibling: EditorLine = { id: newEditorId(), depth: lines[index].depth, name: '' }
  const end = subtreeEnd(lines, index)
  return [...lines.slice(0, end), sibling, ...lines.slice(end)]
}

/** 删除节点及其整棵子树（子树深度都大于它，正好落在同一区间里）。 */
export function removeEditorLine(lines: EditorLine[], id: string): EditorLine[] {
  const index = lines.findIndex((line) => line.id === id)
  if (index === -1) return lines
  return [...lines.slice(0, index), ...lines.slice(subtreeEnd(lines, index))]
}

/** 降级：成为紧邻前一个节点的子级。前面没有同级的祖先链节点时不合法。 */
export function indentLine(lines: EditorLine[], id: string): EditorLine[] {
  const index = lines.findIndex((line) => line.id === id)
  if (index <= 0 || lines[index - 1].depth < lines[index].depth) return lines
  return shiftDepths(lines, index, subtreeEnd(lines, index), 1)
}

/** 升级：除一级节点外恒可执行，子树整体跟随。 */
export function outdentLine(lines: EditorLine[], id: string): EditorLine[] {
  const index = lines.findIndex((line) => line.id === id)
  if (index === -1 || lines[index].depth === 0) return lines
  return shiftDepths(lines, index, subtreeEnd(lines, index), -1)
}

/** 同级上下移动，整棵子树一起换。上移要求存在紧邻的前一个同级节点。 */
export function moveEditorLine(lines: EditorLine[], id: string, delta: number): EditorLine[] {
  const index = lines.findIndex((line) => line.id === id)
  if (index === -1) return lines
  const depth = lines[index].depth
  const end = subtreeEnd(lines, index)
  const block = lines.slice(index, end)
  if (delta < 0) {
    // 越过本节点之前那棵子树的深层行，回到的正好是前一个同级节点的开头。
    let previous = index - 1
    while (previous >= 0 && lines[previous].depth > depth) previous -= 1
    if (previous < 0 || lines[previous].depth !== depth) return lines
    return [...lines.slice(0, previous), ...block, ...lines.slice(previous, index), ...lines.slice(end)]
  }
  if (end >= lines.length || lines[end].depth !== depth) return lines
  const nextEnd = subtreeEnd(lines, end)
  return [...lines.slice(0, index), ...lines.slice(end, nextEnd), ...block, ...lines.slice(nextEnd)]
}

export const canIndentLine = (lines: EditorLine[], id: string): boolean => {
  const index = lines.findIndex((line) => line.id === id)
  return index > 0 && lines[index - 1].depth >= lines[index].depth
}

export const canMoveEditorLine = (lines: EditorLine[], id: string, delta: number): boolean => {
  const index = lines.findIndex((line) => line.id === id)
  if (index === -1) return false
  const depth = lines[index].depth
  if (delta < 0) {
    let previous = index - 1
    while (previous >= 0 && lines[previous].depth > depth) previous -= 1
    return previous >= 0 && lines[previous].depth === depth
  }
  const end = subtreeEnd(lines, index)
  return end < lines.length && lines[end].depth === depth
}
