# WebDAV 挂载身份与凭据编辑不变量（v0.4.0）

## 连接身份

`webdavMountIdentity(mountUrl, username) = sha256(mountUrl + "\\0" + username)`，
libraries.path = `webdav://${identity}`。三条推论：

- **换密码不改身份**——身份只看地址 + 用户名，NAS 换密码后 `updateWebDav` 原地更新即可，series/进度不动。
- **挂子目录是独立连接**——浏览阶段选中子目录挂载时 identity 按**子目录完整 URL**（`resourceUrl(base, rootId)` 的 href 形态，非 ASCII 已百分号编码）计算，与挂根目录互不冲突；「已挂载」标记的匹配必须用同一函数，手拼字符串必踩编码坑。
- **updateWebDav 必须同步 path**——地址/用户名变化时身份变了，`updateLibraryPath` 跟着改，否则同一新连接再添加会因 path 不同而重复建库（addLibrary 的 `ON CONFLICT(path)` 幂等去重靠它）。

## 挂载前浏览不走库 id

`webdavProbe` / `webdavBrowseByCreds` 按连接表单凭据直接请求（配置未落库），
与 `webdavList(libraryId)`（读 settings 里的已存配置）是两条入口，共享 `davFetch`。
PROPFIND 一律 `redirect: 'error'` + 30 秒超时：目录被重定向到别处时宁可报错也不静默串台。

## 无头验证注意

`npx electron .` 加载的是 `out/` 产物——改完渲染层必须先 `pnpm build` 再冒烟，
否则 DOM 断言的是旧代码（v0.4.0 发布当天踩过：新 UI 全没上，旧文案还在）。
