<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ToolboxPage from '../ToolboxPage.vue'
import SvgIcon from '../components/SvgIcon.vue'

type ToolCategory = 'all' | 'file' | 'data' | 'agent' | 'design' | 'network'
type ToolView = 'cleanup' | 'json' | 'data-lab' | 'time' | 'stats' | 'radix' | 'bytes' | 'crypto' | 'diff' | 'convert' | 'color' | 'image-compress' | 'image-crop' | 'background-remove' | 'screen-color' | 'qrcode' | 'ip-check' | 'network-diagnosis' | 'ports' | 'volta' | 'assistant-prompt' | 'menu-sql'
const route = useRoute()
const router = useRouter()
const savedCategory = localStorage.getItem('localforge:default-category')
const initialCategory: ToolCategory = savedCategory === 'file' || savedCategory === 'data' || savedCategory === 'agent' || savedCategory === 'network' || savedCategory === 'design' ? savedCategory : 'all'
const categories: Array<{ id: ToolCategory; label: string }> = [{ id: 'all', label: '全部工具' }, { id: 'file', label: '文件工具' }, { id: 'data', label: '数据工具' }, { id: 'agent', label: '智能体' }, { id: 'design', label: '设计工具' }, { id: 'network', label: '网络工具' }]
const portalTools: Array<{ id: ToolView; category: Exclude<ToolCategory, 'all'>; title: string; description: string; state: string }> = [
  { id: 'cleanup', category: 'file', title: '批量清理目录', description: '递归扫描并清理 node_modules 或指定名称的目录。', state: '文件工具' },
  { id: 'json', category: 'data', title: 'JSON 格式化', description: '格式化、压缩、键排序与本地校验。', state: '数据工具' },
  { id: 'data-lab', category: 'data', title: '开发数据转换台', description: 'Base64、URL、时间戳与 JWT 的本地转换和解析。', state: '数据工具' },
  { id: 'time', category: 'data', title: '时间工作台', description: '时间戳与日期互转、时间差计算、日期加减偏移。', state: '数据工具' },
  { id: 'stats', category: 'data', title: '字数统计', description: '统计字符、汉字、英文词、数字、行数与 UTF-8 字节数。', state: '数据工具' },
  { id: 'radix', category: 'data', title: '进制转换', description: '在 2 到 36 进制之间转换任意精度整数。', state: '数据工具' },
  { id: 'bytes', category: 'data', title: '字节单位转换', description: '在 B、KB、MB、GB、TB 间快速换算。', state: '数据工具' },
  { id: 'crypto', category: 'data', title: '加解密工作台', description: 'MD5、SHA-256、AES 与国密 SM2、SM3、SM4。', state: '数据工具' },
  { id: 'diff', category: 'data', title: '文本差异对比', description: '逐行比较两段文本，快速查看新增、删除和未变内容。', state: '数据工具' },
  { id: 'convert', category: 'data', title: '配置格式转换', description: '在 JSON、YAML、TOML 与 XML 之间本地转换。', state: '数据工具' },
  { id: 'color', category: 'design', title: '颜色转换器', description: '在 HEX、RGB 与 HSL 之间转换，并一键复制颜色值。', state: '设计工具' },
  { id: 'image-compress', category: 'design', title: '本地图片压缩', description: '批量压缩图片、统一转换格式并导出至新文件夹。', state: '设计工具' },
  { id: 'image-crop', category: 'design', title: '图片裁剪', description: '按像素精确裁剪本地图片，并下载裁剪结果。', state: '设计工具' },
  { id: 'background-remove', category: 'design', title: '背景透明化', description: '根据四角颜色移除纯色或近似纯色背景。', state: '设计工具' },
  { id: 'screen-color', category: 'design', title: '屏幕取色', description: '从屏幕任意位置吸取颜色并复制 HEX 值。', state: '设计工具' },
  { id: 'qrcode', category: 'design', title: '二维码工具', description: '在本地生成二维码，并识别图片中的二维码内容。', state: '设计工具' },
  { id: 'ports', category: 'network', title: '端口与进程管理', description: '查看本机监听端口，并按需结束关联进程。', state: '网络工具' },
  { id: 'ip-check', category: 'network', title: 'IP 与代理检测', description: '检测当前出口公网 IP，确认代理或 VPN 是否实际生效。', state: '网络工具' },
  { id: 'network-diagnosis', category: 'network', title: '网络诊断', description: 'DNS 解析、TCP 端口及 HTTP/HTTPS 连通性检查。', state: '网络工具' },
  { id: 'volta', category: 'data', title: 'Volta Node 管理', description: '查看、安装默认 Node 版本，或为项目固定版本。', state: '数据工具' },
  { id: 'assistant-prompt', category: 'data', title: 'AI 提示词与配置', description: '编辑 Codex、Cursor、Claude Code 的全局提示词和配置文件。', state: '数据工具' },
  { id: 'menu-sql', category: 'agent', title: '菜单 SQL 生成器', description: '粘贴中文菜单树，AI 译出英文标识并生成 sys_menu 插入脚本。', state: '智能体' }
]
const activeCategory = computed<ToolCategory>(() => {
  const category = route.query.category
  return category === 'file' || category === 'data' || category === 'agent' || category === 'network' || category === 'design' || category === 'all' ? category : initialCategory
})
const portalTitle = computed(() => categories.find((category) => category.id === activeCategory.value)?.label ?? '全部工具')
const visiblePortalTools = computed(() => activeCategory.value === 'all' ? portalTools : portalTools.filter((tool) => tool.category === activeCategory.value))
const openTool = (tool: ToolView) => router.push({ name: tool })
</script>

<template><ToolboxPage>
  <header class="toolbox-heading"><p>LOCALFORGE / TOOL PORTAL</p><h2>{{ portalTitle }}</h2><span>选择一项工具开始工作；本地工具不上传内容，联网工具会明确说明用途。</span></header>
  <section class="portal-list" :aria-label="`${portalTitle}列表`">
    <button v-for="tool in visiblePortalTools" :key="tool.id" class="portal-item" type="button" @click="openTool(tool.id)">
      <i class="portal-icon" :class="`portal-icon-${tool.id}`"><SvgIcon :name="tool.id === 'cleanup' ? 'trash' : tool.id === 'menu-sql' ? 'menu-tree' : tool.id === 'time' ? 'clock' : tool.category === 'data' ? 'code' : tool.id === 'color' || tool.id === 'screen-color' ? 'palette' : tool.category === 'design' ? 'image' : tool.id === 'ports' ? 'monitor' : 'globe'" /></i>
      <span class="portal-copy"><em>{{ tool.state }}</em><strong>{{ tool.title }}</strong><small>{{ tool.description }}</small></span><b>›</b>
    </button>
    <p v-if="!visiblePortalTools.length" class="portal-empty">该分类暂时没有可用工具。</p>
  </section>
</ToolboxPage></template>
