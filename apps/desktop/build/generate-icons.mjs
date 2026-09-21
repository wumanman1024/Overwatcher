#!/usr/bin/env node
/**
 * LocalForge 品牌标识生成器：工具箱 + 扳手（探出式构图）
 *
 * 单一事实来源：桌面/窗口图标、托盘图标、渲染层内联标记全部由本文件产出。
 * 输出：
 *   apps/desktop/build/app-icon.{svg,png}      桌面/窗口/exe 图标（绿色渐变圆角方块）
 *   apps/desktop/build/tray-icon.{svg,png}     系统托盘图标（单色，透明底）
 *   apps/renderer/src/assets/icons/app-mark.svg 渲染层 SVG sprite 用的当前色标记
 *
 * 运行： pnpm --filter @localforge/desktop icons
 * 依赖： @resvg/resvg-js（devDependency，纯 WASM/原生绑定，无需系统库）
 *
 * 几何刻意不使用 mask/filter：全部由矩形、圆角路径与 evenodd 镂空构成，
 * 因此同一份路径可安全用于 SVG sprite（<symbol> + <use>）、PNG 光栅化与 ICO 打包。
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Resvg } = require('@resvg/resvg-js')
const pngToIco = require('png-to-ico').default ?? require('png-to-ico')
const here = dirname(fileURLToPath(import.meta.url))
const n = (v) => v.toFixed(2)

// ── 基础图形 ────────────────────────────────────────────────────────
/** 仅部分角圆角的矩形路径 */
function rectPath(x, y, w, h, [tl, tr, br, bl]) {
  return `M ${n(x + tl)} ${n(y)}
    H ${n(x + w - tr)}${tr ? ` A ${tr} ${tr} 0 0 1 ${n(x + w)} ${n(y + tr)}` : ''}
    V ${n(y + h - br)}${br ? ` A ${br} ${br} 0 0 1 ${n(x + w - br)} ${n(y + h)}` : ''}
    H ${n(x + bl)}${bl ? ` A ${bl} ${bl} 0 0 1 ${n(x)} ${n(y + h - bl)}` : ''}
    V ${n(y + tl)}${tl ? ` A ${tl} ${tl} 0 0 1 ${n(x + tl)} ${n(y)}` : ''} Z`
}
/** 整圆，dir=1 顺时针（并集）/ dir=0 逆时针（镂空） */
const circle = (cx, cy, r, dir) =>
  `M ${n(cx)} ${n(cy - r)} A ${n(r)} ${n(r)} 0 0 ${dir} ${n(cx)} ${n(cy + r)} A ${n(r)} ${n(r)} 0 0 ${dir} ${n(cx)} ${n(cy - r)} Z`

/**
 * 开口扳手（叉形头），单一 path（fill-rule=evenodd）。
 * 局部坐标：轴沿 y，开口朝 -y，原点在钳口底部（头的下缘）。
 *
 * 头必须是“比杆宽、顶端开方口”的叉形——这是开口扳手的可识别剪影；
 * 圆头加槽无论怎么调比例都像“球上划道缝”，已实测排除。
 *
 * evenodd 下重叠次数为偶数即镂空，所以三块必须严格不重叠：
 *   头(head) 与 杆(bar) 仅在 neck 处首尾相接、不交叠；
 *   开口(notch) 从头顶上方一直切到 neck 之上，留出实心横梁，
 *   绝不能越过 neck 扎进杆里（否则 头+杆+口 三重覆盖会变回实心）。
 *   hw 头半宽 / g 开口半宽 / dep 开口深 / hr 头圆角 / sh 杆半宽 / len 杆长
 */
function wrenchPath({ hw = 25, g = 12.5, dep = 34, hr = 7, sh = 10.5, len = 92 } = {}) {
  const top = -dep                  // 钳口端面
  const neck = 4                    // 头下缘 = 杆上缘
  const head = roundedRect(-hw, top, hw * 2, neck - top, hr)
  const bar = roundedRect(-sh, neck, sh * 2, len - neck, 3)
  const notch = roundedRect(-g, top - 8, g * 2, dep + 6, 4)   // 止于 neck−6，留 6px 实心横梁
  return head + bar + notch
}

/** 圆角多边形（顺时针顶点）：每个顶点按半径 r 倒角，用于梯形盖面 */
function roundedPoly(pts, r) {
  const N = pts.length
  let d = ''
  for (let i = 0; i < N; i++) {
    const cur = pts[i], prev = pts[(i - 1 + N) % N], next = pts[(i + 1) % N]
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
    const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
    const mul = (a, k) => [a[0] * k, a[1] * k]
    const len = (a) => Math.hypot(a[0], a[1])
    const unit = (a) => mul(a, 1 / len(a))
    const rt = Math.min(r, len(sub(prev, cur)) / 2, len(sub(next, cur)) / 2)
    const A = add(cur, mul(unit(sub(prev, cur)), rt))
    const B = add(cur, mul(unit(sub(next, cur)), rt))
    d += `${i === 0 ? 'M' : 'L'} ${n(A[0])} ${n(A[1])} Q ${n(cur[0])} ${n(cur[1])} ${n(B[0])} ${n(B[1])} `
  }
  return d + 'Z'
}
/** 圆角矩形路径（锁扣槽、箱体用） */
function roundedRect(x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2)
  return `M ${n(x + q)} ${n(y)} H ${n(x + w - q)} A ${q} ${q} 0 0 1 ${n(x + w)} ${n(y + q)} V ${n(y + h - q)} A ${q} ${q} 0 0 1 ${n(x + w - q)} ${n(y + h)} H ${n(x + q)} A ${q} ${q} 0 0 1 ${n(x)} ${n(y + h - q)} V ${n(y + q)} A ${q} ${q} 0 0 1 ${n(x + q)} ${n(y)} Z`
}

// ── 标识构图（256 网格）─────────────────────────────────────────────
// 造型刻意区别于“公文包”，采用金属工具箱的三大特征：
//   1. 上窄下宽的浅梯形盖面 + 竖直侧边的矩形箱体（梯形是“盖”不是“箱体”，
//      否则像篮子）；
//   2. 明显高出箱体的拱形提手；
//   3. 盖缝处左右两条锁扣（公文包只有居中一个扣，这是关键区别）。
// 盖缝与锁扣都用“透明挖除”实现（盖/箱两块间的间隙 + 箱体 evenodd 镂空），
// 无需遮罩，因此在渐变绿 / 深蓝 / 白任何底色上都成立，也能安全用于 SVG sprite。
const BOX = { cx: 112, bodyW: 172, bodyY: 158, bodyH: 68, bodyR: 16, lidTopHalf: 60, lidH: 40, seam: 12 }
const HANDLE = { w: 70, rise: 40, sw: 12 }
const CLASP = { off: 44, w: 15 }
// 扳手：头部圆心 (188,58) 旋转 34°，斜向探入箱盖。
// 位置经计算避开三处碰撞：方块圆角（弧心 (190,66) r54）、提手拱形（x≤147）、
// 盖缝（y 146..158，杆端 y_max≈140 恰好留在缝之上，否则白杆会把盖缝切断）。
const WRENCH = { x: 188, y: 58, deg: 34, geom: { hw: 25, g: 12.5, dep: 33, hr: 7, sh: 10.5, len: 92 } }

/**
 * @param mk 主色（当前色或具体颜色）
 * 扳手先画、箱体后画 → 杆与尾端被箱盖遮住，视觉上“从右上角探出”。
 */
export function mark({ mk = 'currentColor' } = {}) {
  const b = BOX
  const half = b.bodyW / 2
  const lidY = b.bodyY - b.lidH
  const lidBottom = b.bodyY - b.seam
  const lid = roundedPoly([[b.cx - b.lidTopHalf, lidY], [b.cx + b.lidTopHalf, lidY], [b.cx + half, lidBottom], [b.cx - half, lidBottom]], 12)

  // 提手：高拱，明显高出箱体
  const hx = b.cx - HANDLE.w / 2, archTop = lidY - HANDLE.rise
  const handle = `M ${n(hx)} ${n(lidY + 2)} V ${n(archTop + 18)} C ${n(hx)} ${n(archTop)} ${n(hx + 12)} ${n(archTop)} ${n(hx + 17)} ${n(archTop)} h ${n(HANDLE.w - 34)} C ${n(hx + HANDLE.w - 12)} ${n(archTop)} ${n(hx + HANDLE.w)} ${n(archTop)} ${n(hx + HANDLE.w)} ${n(archTop + 18)} V ${n(lidY + 2)}`

  // 箱体：单个 evenodd 复合路径，两条锁扣槽从顶部咬进箱体形成透明缺口
  const body = roundedRect(b.cx - half, b.bodyY, b.bodyW, b.bodyH, b.bodyR)
  const slotY = b.bodyY - 2, slotH = 18
  const slots = roundedRect(b.cx - CLASP.off - CLASP.w / 2, slotY, CLASP.w, slotH, 4)
    + roundedRect(b.cx + CLASP.off - CLASP.w / 2, slotY, CLASP.w, slotH, 4)

  const w = `<g transform="translate(${WRENCH.x} ${WRENCH.y}) rotate(${WRENCH.deg})" fill-rule="evenodd"><path d="${wrenchPath(WRENCH.geom)}"/></g>`
  // stroke-width="0" 必需——渲染层 .svg-icon 全局设了 stroke:currentColor + stroke-width:1.8，
  // 不显式关闭会让实心图形被描边糊掉。
  return `<g fill="${mk}" stroke-width="0">
  ${w}
  <path d="${handle}" fill="none" stroke="${mk}" stroke-width="${HANDLE.sw}" stroke-linecap="round"/>
  <path d="${lid}"/>
  <path d="${body} ${slots}" fill-rule="evenodd"/>
</g>`
}

/** 圆角方块底 */
const tile = (inner, { grad = ['#12b063', '#04612f'], size = 1024 } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${grad[0]}"/><stop offset="1" stop-color="${grad[1]}"/>
  </linearGradient></defs>
  <rect x="12" y="12" width="232" height="232" rx="54" fill="url(#g)"/>
  ${inner}
</svg>`

const toPng = (markup, width) =>
  new Resvg(markup, { fitTo: { mode: 'width', value: width } }).render().asPng()

// ── 产物 ────────────────────────────────────────────────────────────
const white = mark({ mk: '#ffffff' })

// 桌面 / 窗口 / exe 图标（完整 256 方块）
const appSvg = tile(white)
writeFileSync(join(here, 'app-icon.svg'), appSvg)
const appPng = toPng(appSvg, 1024)
writeFileSync(join(here, 'app-icon.png'), appPng)
// Windows exe / 安装包图标用 .ico（electron-builder 只从 PNG 自动转换会丢多尺寸）
writeFileSync(join(here, 'app-icon.ico'), await pngToIco(toPng(appSvg, 256)))

// 内容包围盒（非方块场景裁掉四周留白）：
// 扳手头圆心 (204,28) r26 → 右上到约 (230,2)；箱体左沿 x30、底 y226。
// 内容 x[30,230] y[2,226]，取其居中正方形取景框（托盘图标会被
// nativeImage.resize({width,height}) 拉成等宽高，非正方形会变形）。
const CONTENT = '14 -2 232 232'

// 系统托盘：单色、透明底，Windows 通知区会用其自身遮罩着色
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CONTENT}">${mark({ mk: '#0a8a45' })}</svg>`
writeFileSync(join(here, 'tray-icon.svg'), traySvg)
writeFileSync(join(here, 'tray-icon.png'), toPng(traySvg, 64))

// 渲染层 sprite：当前色，供 <SvgIcon name="app-mark" /> 使用
const spriteSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CONTENT}">${mark({ mk: 'currentColor' })}</svg>`
writeFileSync(join(here, '../../renderer/src/assets/icons/app-mark.svg'), spriteSvg)

console.log('✓ 已生成 app-icon(.svg/.png/.ico) / tray-icon(.svg/.png) / app-mark.svg')
