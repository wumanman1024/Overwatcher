import { createApp } from 'vue'
import App from './App.vue'
import StatusBar from './StatusBar.vue'
import './styles.css'

createApp(new URLSearchParams(location.search).get('surface') === 'status' ? StatusBar : App).mount('#app')
