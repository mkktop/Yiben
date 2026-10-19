# 雨读 Yudu 115 验证环境限制

> 本机出口为海外 AWS IP，115 网盘部分接口被软封杀——115 功能只能验证到二维码渲染，扫码/列目录/下载需中国网络实机验证

Yiben 开发机（win32）出口 IP 是海外 AWS 网段，且无代理环境变量（系统级出口）。115 网盘对此环境的软封锁实测（2026-09-12）：

- 可达：`qrcodeapi.115.com/api/1.0/web/1.0/token/`（取码）、`api/1.0/mac/1.0/qrcode?uid=`（官方 PNG 二维码）
- 被封：`qrcodeapi.115.com/get/status/` GET 静默超时（POST 能通但 key invalid）、`webapi.115.com/files` GET 405 HTML 拦截页（**改 POST 表单即正常**，这是接口变更是网络无关的）、`passportapi` 换 cookie 返回「老乡验证失败」

**Why:** 115 功能的无头验证上限就是「二维码面板渲染 + 错误路径走通」（假会话经 settings 表明文 enc 注入可验恢复/报错/Toast 全链路）；列目录、下载、完整扫码登录必须用户在中国网络环境实测。

**How to apply:** 给 雨读 Yudu 加 115 相关功能时，无头验证按此口径设计断言；不要把海外网络下的超时/405 当成代码 bug 反复排查。天翼 cloud189 无此限制（海外可达），优先用它验证云端共用管线（scan/ensure/cache 的 provider 泛化层）。
