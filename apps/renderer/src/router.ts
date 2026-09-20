import { createMemoryHistory, createRouter } from 'vue-router'
import PortalTool from './tools/PortalTool.vue'
import CleanupTool from './tools/CleanupTool.vue'
import JsonTool from './tools/JsonTool.vue'
import DataLabTool from './tools/DataLabTool.vue'
import StatsTool from './tools/StatsTool.vue'
import RadixTool from './tools/RadixTool.vue'
import BytesTool from './tools/BytesTool.vue'
import CryptoTool from './tools/CryptoTool.vue'
import DiffTool from './tools/DiffTool.vue'
import ConvertTool from './tools/ConvertTool.vue'
import ColorTool from './tools/ColorTool.vue'
import ImageTool from './tools/ImageTool.vue'
import ImageCropTool from './tools/ImageCropTool.vue'
import BackgroundRemoveTool from './tools/BackgroundRemoveTool.vue'
import ScreenColorTool from './tools/ScreenColorTool.vue'
import QrcodeTool from './tools/QrcodeTool.vue'
import PortsTool from './tools/PortsTool.vue'
import IpCheckTool from './tools/IpCheckTool.vue'
import NetworkDiagnosisTool from './tools/NetworkDiagnosisTool.vue'
import VoltaTool from './tools/VoltaTool.vue'
import NvmTool from './tools/NvmTool.vue'
import AssistantPromptTool from './tools/AssistantPromptTool.vue'
import MenuSqlTool from './tools/MenuSqlTool.vue'

export const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'portal', component: PortalTool },
    { path: '/cleanup', name: 'cleanup', component: CleanupTool },
    { path: '/json', name: 'json', component: JsonTool },
    { path: '/data-lab', name: 'data-lab', component: DataLabTool },
    { path: '/stats', name: 'stats', component: StatsTool },
    { path: '/radix', name: 'radix', component: RadixTool },
    { path: '/bytes', name: 'bytes', component: BytesTool },
    { path: '/crypto', name: 'crypto', component: CryptoTool },
    { path: '/diff', name: 'diff', component: DiffTool },
    { path: '/convert', name: 'convert', component: ConvertTool },
    { path: '/color', name: 'color', component: ColorTool },
    { path: '/image', name: 'image-compress', component: ImageTool },
    { path: '/image-crop', name: 'image-crop', component: ImageCropTool },
    { path: '/background-remove', name: 'background-remove', component: BackgroundRemoveTool },
    { path: '/screen-color', name: 'screen-color', component: ScreenColorTool },
    { path: '/qrcode', name: 'qrcode', component: QrcodeTool },
    { path: '/ports', name: 'ports', component: PortsTool },
    { path: '/ip-check', name: 'ip-check', component: IpCheckTool },
    { path: '/network-diagnosis', name: 'network-diagnosis', component: NetworkDiagnosisTool },
    { path: '/volta', name: 'volta', component: VoltaTool },
    { path: '/nvm', name: 'nvm', component: NvmTool },
    { path: '/assistant-prompt', name: 'assistant-prompt', component: AssistantPromptTool },
    { path: '/menu-sql', name: 'menu-sql', component: MenuSqlTool }
  ]
})
