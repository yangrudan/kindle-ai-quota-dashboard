# 故障排查

## 页面只有假数据

`npm run demo` 只用于演示。复制 `config.example.json` 为 `config.json`，显式开启需要的采集器，再运行 `npm run collect`。

## 页面显示“旧值”

说明这次采集失败，但程序保留了上一次成功结果。查看终端里的简短错误，先单独修复对应 CLI 的登录状态。

## GitHub Copilot 显示未授权读取

采集器默认不读取本机 Copilot 缓存。确认理解风险后设置：

```json
{
  "enabled": true,
  "allowLocalCacheRead": true
}
```

缓存中只会提取额度字段，账号信息不会写入公开快照。Xiaomi MiMo 的普通 API Key 不能查询充值余额；未配置控制台余额数据时会保持“获取失败”，不会展示演示值。

## Kindle 在同一 Wi‑Fi 能开，换 Wi‑Fi 后打不开

你使用的是局域网地址。要跨网络更新，需要一个 Kindle 能从公网访问的静态页面；使用公共托管前先阅读隐私文档。

## Kindle 退出后没有恢复主界面

通过 SSH 或 KTerm 执行安装后生成的“退出 AI 额度中控台”脚本，或手动启动 `lab126_gui`/framework。若设备型号或固件尚未验证，停止继续测试并提交设备信息，但不要附带序列号、MAC 或家庭网络数据。
