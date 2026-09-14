# 硬件监控

```bash
pnpm install
sudo pnpm fix-sandbox
pnpm dev
```

Ubuntu/Linux 上 Electron 开发版需要 `chrome-sandbox` 有 `root:root` 和 `4755` 权限。每次重新安装 Electron 依赖后，重新运行 `sudo pnpm fix-sandbox`。
