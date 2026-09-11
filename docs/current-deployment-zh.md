# 当前部署架构与实施记录

本文记录 2026-09-11 在杭州实际部署的 Kindle AI 额度中控台，包括当前运行架构、数据边界、Kindle 兼容方案、自动发布流程，以及本次从原始项目到可用系统的排障过程。

## 1. 当前结果

- 源码仓库：<https://github.com/yangrudan/kindle-ai-quota-dashboard>
- 公共仪表盘：<https://yangrudan.github.io/kindle-ai-quota-dashboard/>
- 数据源：GitHub Copilot、OpenAI Codex、Xiaomi MiMo、DeepSeek、杭州天气
- 电脑侧每 10 分钟采集并推送一次 GitHub Pages
- Kindle 侧每 3 分钟检查一次新的 `data.js`
- Kindle 固件：`5.16.2.1.1`，Linux `armv7l`，旧 Mesquite/WebKit 533 浏览器栈
- Kindle 入口：KUAL → WebLaunch/Mesquite 全屏应用 → GitHub Pages

## 2. 总体架构

```text
┌────────────────────────────── 常开电脑 ──────────────────────────────┐
│                                                                     │
│  Copilot 本机缓存 ─┐                                                │
│  Codex app-server ─┼─> Node.js 采集器 ─> state/data.{json,js}       │
│  MiMo 本地余额快照 ─┤                      │                         │
│  DeepSeek API ─────┤                      ▼                         │
│  Open-Meteo ───────┘                静态站点构建 dist/              │
│                                             │                       │
│  cron（每 10 分钟）─────────────────────────┴─> git push gh-pages   │
└─────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                         GitHub Pages 公共静态站点
                   index.html + runtime.js + data.js
                                              │
                          每 3 分钟 JSONP 式脚本拉取
                                              ▼
┌────────────────────────────── Kindle ───────────────────────────────┐
│  KUAL → root 启动脚本 → Mesquite WAF → 全屏 iframe → 仪表盘页面     │
│                    ├─ preventScreenSaver=1                          │
│                    └─ 退出监视器恢复 preventScreenSaver=0           │
└─────────────────────────────────────────────────────────────────────┘
```

核心原则是“采集与展示分离”：账号凭证只存在于电脑，Kindle 和 GitHub Pages 只接触已经裁剪、脱敏的额度快照。

## 3. 电脑侧采集

### GitHub Copilot

采集器读取本机 Copilot CLI 缓存：

```text
~/.cache/copilot/copilot-user-cache.json
```

它只提取 `premium_interactions` 的月度 AIC 总额、剩余量、剩余百分比和重置时间。配置必须显式设置 `allowLocalCacheRead: true`，防止项目默认读取本机缓存。

### OpenAI Codex

采集器启动本机：

```text
codex app-server --listen stdio://
```

然后通过 `account/rateLimits/read` 读取 5 小时和周额度窗口。页面显示的是剩余百分比；使用 Codex 本身会消耗额度，因此数值在工作期间下降属于正常现象。

### Xiaomi MiMo

MiMo 的普通 API Key 可以调用模型，但不能查询充值账户余额。当前方案曾使用隔离的临时 Chrome 配置登录 MiMo 控制台，通过已登录会话读取 `/api/v1/balance`，只把余额和币种写入本地忽略文件：

```text
config/mimo-balance.json
```

临时浏览器配置、Cookie、控制台响应和辅助脚本在取值后已经清理。当前 cron 只会重新读取这个本地余额文件，不会自动登录 MiMo 控制台，因此 MiMo 余额只有在该文件被重新采集后才会变化。

### DeepSeek

DeepSeek 使用只读余额接口：

```text
GET https://api.deepseek.com/user/balance
```

API Key 通过环境变量 `DEEPSEEK_API_KEY` 传入。密钥存放在仓库外的：

```text
/path/to/kindle/.kindle-dashboard.env
```

文件权限为 `600`。曾经出现该文件被创建为空文件、导致页面沿用旧余额的问题；现已修复并验证环境变量能被 cron 子进程导出。采集失败时，页面保留最后一次成功值并标记“旧值”，不会用演示数字冒充实时余额。

### 杭州天气

`scripts/collect-weather.cjs` 使用 Open-Meteo，坐标为杭州，时区固定为 `Asia/Shanghai`。天气先写入 `config/weather.json`，再由总采集器合并进公开快照。

## 4. 快照、失败隔离与前端刷新

`src/collect.cjs` 并行运行四个 AI 数据采集器，生成：

```text
state/data.json
state/data.js
```

`data.json` 便于检查和其他客户端消费；`data.js` 使用 `window.DASH_DATA = ...`，用于绕过旧 Kindle WebKit 对 `fetch`、CORS 和现代 Promise 支持不足的问题。

任一数据源失败不会阻塞其他来源。已启用的来源失败时会保留上一次成功数据，并附加：

- `stale: true`
- `lastAttemptAt`
- 脱敏后的 `error`

Kindle 页面默认每 3 分钟请求一次 `data.js`，请求带时间戳参数以绕过缓存。有效快照还会写入浏览器本地缓存；网络临时失败时最多使用 30 分钟内的有效缓存，并明确显示“缓存”“延迟”或“离线”。

页面的 03:00–08:00 省电逻辑只暂停 Kindle 侧轮询；电脑 cron 目前仍按 10 分钟运行。

## 5. 构建与 GitHub Pages 发布

电脑上的发布入口是：

```text
/path/to/kindle/publish-kindle-dashboard.sh
```

执行顺序：

1. `npm run weather`
2. `npm run collect`
3. `npm run build`
4. 把 `dist/` 复制到独立 Pages 工作区
5. 提交并推送 `gh-pages` 分支

Pages 工作区为：

```text
/path/to/kindle/kindle-ai-pages-deploy
```

当前用户 crontab：

```cron
*/10 * * * * . /path/to/kindle/.kindle-dashboard.env && /path/to/kindle/publish-kindle-dashboard.sh >> /path/to/kindle/kindle-dashboard-publish.log 2>&1
```

发布日志：

```text
/path/to/kindle/kindle-dashboard-publish.log
```

这种方式的优点是电脑与 Kindle 不需要处于同一个局域网；缺点是公开页面的额度和余额任何知道 URL 的人都能看到，并且 `gh-pages` 会产生频繁的数据快照提交。

## 6. Kindle 侧兼容架构

### 为什么没有使用原项目的 Chromium 启动器

原项目脚本尝试运行：

```text
/usr/bin/chromium/bin/kindle_browser
```

设备诊断日志确认该文件不存在。固件 `5.16.2.1.1` 仍使用 Mesquite/WebKit；Kindle 普遍切换到 Chromium 是之后的固件线。因此这不是越狱失败，也不是设备难处理，而是启动器选错了浏览器代际。

### 当前启动链路

```text
KUAL
  └─ /mnt/us/extensions/WebLaunch/bin/start.sh（root）
       ├─ 补齐 appreg.db 中的 WAF 注册项
       ├─ 设置 preventScreenSaver=1
       ├─ 启动 com.PaulFreund.WebLaunch
       └─ 后台监视应用退出，恢复 preventScreenSaver=0
              │
              ▼
       /usr/bin/mesquite
              │
              ▼
       本地 WAF 页面中的全屏 iframe
              │
              ▼
       GitHub Pages 仪表盘
```

WAF 注册项包含 `application` 接口、`lipcId`、`command` 和 `supportedOrientation`。实际命令使用：

```text
/usr/bin/mesquite -l com.PaulFreund.WebLaunch \
  -c file:///mnt/us/extensions/WebLaunch/bin/
```

旧 WebLaunch 原先使用 Amazon WRS 网页代理并调用 `kindle.chrome.createContentWindow()`；在本机上分别表现为白屏和远程内容无法加载。当前已关闭 WRS，并改为本地 WAF 内的全屏远程 `iframe`。这保留了独立应用、常亮和无系统浏览器地址栏的体验。

### Kindle 专用前端兼容

Mesquite 大致相当于 WebKit 533，不支持 CSS 自定义属性、CSS Grid、现代 Flexbox 等功能。为此页面增加了只对 Kindle UA 生效的兼容层：

- 使用固定黑白色值，替代 `var(--...)`
- 用 `table-cell` 实现时间/天气两列
- 用 `inline-block` 实现四张卡片 2×2
- 使用设备的 1072px 逻辑宽度逐项放大字号、间距和卡片尺寸
- 固定使用杭州 UTC+8，避免旧 WebKit 把本地时间显示为 UTC
- Kindle 模式隐藏页面内电池字段，使用设备顶部的系统电量

### 退出与防休眠

旧 WebLaunch 的 Pillow 电源键事件在 KPP 上没有生效，短按电源键只会进入锁屏。因此当前方案增加了：

- `preventScreenSaver=1` 的 root 级启动设置
- 应用退出后的后台恢复监视器
- KPP 原生 `KPP_CLOSE` 顶栏动作
- 页面“主页”按钮，调用 `window.kindle.appmgr.start("com.lab126.booklet.home")`
- KUAL 菜单的 `exitmenu: true`，避免关闭面板后回到 KUAL

如果设备异常保持常亮，可通过 SSH/KTerm/KUAL 恢复：

```sh
lipc-set-prop com.lab126.powerd preventScreenSaver 0
```

## 7. 本次实施与排障记录

本次工作不是单纯复制原项目，而是完成了一次针对真实设备、真实账号和旧固件的适配：

1. Fork 并通过 SSH 推送到用户仓库，保留上游 remote。
2. 把原生数据目标改为 Copilot、Codex、MiMo、DeepSeek 四张卡片。
3. 新增 Copilot 本机缓存采集器、Codex app-server 采集器、MiMo 本地余额快照和 DeepSeek 余额采集器。
4. 增加杭州 Open-Meteo 天气采集与 UTC+8 时间显示。
5. 增加单源失败隔离、最后成功值兜底、公开快照结构校验和敏感信息检查。
6. 建立 GitHub Pages 独立发布工作区和每 10 分钟 cron。
7. 使用隔离浏览器会话定位 MiMo 控制台余额接口；完成后删除临时会话和响应。
8. 排查 KPM `failed to install`：系统日志显示 KPM 在该设备上发生 `undefined instruction`，因此改用 KUAL 扩展路径。
9. 排查 KUAL “No Extension found”：补齐 `config.xml` 和 `menu.json`。
10. 排查 KUAL 点击闪退：加入 `debug.log`，确认菜单动作必须使用 `./start.sh`。
11. 排查浏览器两秒退出：确认固件没有 Chromium 二进制，转向 Mesquite/WebLaunch。
12. 补齐新版 `appreg.db` 所需的 `lipcId`、方向、接口和 `file://` 命令格式。
13. 排查 WebLaunch 白屏：关闭失效 WRS，并以全屏 iframe 替代 `createContentWindow()`。
14. 根据多次真机照片修复旧 WebKit 的变量、Grid/Flex、视口、字号、卡片布局和电池显示。
15. 排查 DeepSeek 旧余额：发现密钥环境文件为空，修复后恢复实时余额。
16. 将防休眠与退出从失效的 Pillow 回调改为 root/LIPC 与 KPP 原生动作。

所有公开推送均经过测试；当前 Node.js 测试集为 8 项，并包含公开数据结构、凭证脱敏、缓存回退和旧浏览器 JavaScript 语法检查。

## 8. 安全与隐私边界

不会进入 Git 或 GitHub Pages 的内容：

- DeepSeek API Key
- MiMo API Key、Cookie 和登录会话
- Codex/OpenAI 登录令牌
- Copilot 账号缓存原文
- Kindle 序列号、MAC 和公司网络信息

会公开的内容：

- 各额度窗口的使用/剩余比例
- Copilot 剩余 AIC 数量
- MiMo 与 DeepSeek 账户余额
- 杭州天气和快照更新时间

由于真实 API Key 曾通过对话提供，建议在系统稳定后轮换 MiMo 和 DeepSeek Key，再更新本机私有配置。

## 9. 运维检查

检查定时任务：

```sh
crontab -l
```

检查最近发布：

```sh
tail -100 /path/to/kindle/kindle-dashboard-publish.log
```

手动发布：

```sh
. /path/to/kindle/.kindle-dashboard.env
/path/to/kindle/publish-kindle-dashboard.sh
```

运行项目检查：

```sh
npm run check
```

公开页面显示“旧值”时，应查看对应来源的 `error` 和 `lastAttemptAt`，不要只看顶层任务输出中的 `source:ok`；保留旧值后来源仍可能总体为 `ok`。

## 10. 已知限制与后续建议

1. MiMo 当前是本地余额快照，不会像 DeepSeek 一样每 10 分钟真实查询。若需要自动更新，应实现安全的控制台会话刷新，并处理登录过期。
2. Pages 每 10 分钟产生一次提交，长期会形成较大的 `gh-pages` 历史；可以改为可覆盖的对象存储或单独数据服务。
3. Kindle 上的 WebLaunch 兼容改动目前主要部署在设备文件中，应进一步整理成仓库内可重复安装的 legacy Mesquite 包。
4. KPM 在此固件/设备组合上会因非法指令崩溃，当前不要依赖 `.kpkg` 更新仪表盘。
5. 设备端防休眠和主页动作已经写入，但不同 KPP 小版本的窗口切换仍应以真机持续运行结果为准。

## 11. 恢复与停用

停止电脑自动发布时，从 crontab 删除包含 `publish-kindle-dashboard.sh` 的一行。停用 Kindle 入口时，可通过 USB 把：

```text
/mnt/us/extensions/WebLaunch/config.xml
```

改名为 `config.xml.disabled`，这样无需删除文件即可让 KUAL 停止加载入口：

```sh
mv /mnt/us/extensions/WebLaunch/config.xml /mnt/us/extensions/WebLaunch/config.xml.disabled
```

重新启用时把文件名改回：

```sh
mv /mnt/us/extensions/WebLaunch/config.xml.disabled /mnt/us/extensions/WebLaunch/config.xml
```

如果仪表盘异常退出后设备仍保持常亮，执行上一节的 `lipc-set-prop` 命令即可恢复系统休眠策略。

## 12. 结论

当前系统已经从原项目的通用 Chromium/KPM 假设，演变为适合这台旧 WebKit Kindle 的“电脑采集并发布、Kindle 只负责全屏展示”架构。它已经覆盖四类额度、杭州天气、失败兜底、自动发布和旧浏览器兼容；后续工作的重点是自动刷新 MiMo 余额，以及把设备端 WebLaunch 改动整理成可重复安装包。
