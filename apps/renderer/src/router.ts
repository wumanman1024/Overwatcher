import { createMemoryHistory, createRouter } from 'vue-router'
import ToolboxPage from './ToolboxPage.vue'

export const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'portal', component: ToolboxPage },
    { path: '/cleanup', name: 'cleanup', component: ToolboxPage },
    { path: '/json', name: 'json', component: ToolboxPage },
    { path: '/data-lab', name: 'data-lab', component: ToolboxPage },
    { path: '/color', name: 'color', component: ToolboxPage },
    { path: '/image', name: 'image', component: ToolboxPage },
    { path: '/ports', name: 'ports', component: ToolboxPage },
    { path: '/ip-check', name: 'ip-check', component: ToolboxPage },
    { path: '/network-diagnosis', name: 'network-diagnosis', component: ToolboxPage }
  ]
})
