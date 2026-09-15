# LocalForge

本地运行的开发者工具箱。当前包含：

- 文件清理：递归扫描并删除指定目录名（默认 `node_modules`）
- JSON：格式化、压缩、键排序与校验
- 系统监控：保留原有硬件监控悬浮窗与监控中心

```bash
pnpm install
sudo pnpm fix-sandbox
pnpm dev
```

Ubuntu/Linux 上 Electron 开发版需要 `chrome-sandbox` 有 `root:root` 和 `4755` 权限。每次重新安装 Electron 依赖后，重新运行 `sudo pnpm fix-sandbox`。
