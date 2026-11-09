# FILM LOG · 观影档案

一个纯静态的观影日历与观影记录站：按日期浏览每一场放映、看完片与观影名单，按人查看观影史、共同观影关系与勋章，按片查看场次、评分与简介。

零依赖、零后端，`index.html` + `app.js` + `styles.css` 即可运行，数据直接内嵌在 `app.js` 中。

## 数据快照

- 影片 **126** 部（id 30–158，含 11 部已建档、待排片）
- 放映 **116** 场（其中 19 场为空场）
- 累计人次 **697**，唯一观影者 **126** 人
- 时间范围：**2025-08-08 — 2026-09-30**

数据来源：观影群的公开接龙记录与《观影完成记录汇总》表。每场放映的日期、片名、参与人员均经人工核对后写入，昵称按 `ALIASES` 归一（同人异写合并）。

## 目录

```
index.html      页面入口与缓存兜底逻辑
app.js          应用逻辑 + 内嵌数据（seed()）
styles.css      基础样式
enhance.css     视觉增强层样式
enhance.js      视觉增强层动效与插画
assets/         插画（webp）
build.json      当前构建号
check.js        数据基线检查脚本（Node，维护用）
_headers        Cloudflare Pages 缓存策略（GitHub Pages 会忽略）
```

## 本地预览

```bash
python -m http.server 8080
# 打开 http://localhost:8080
```

直接双击 `index.html` 也能看，但个别浏览器对 `file://` 的 `fetch` 有限制，推荐用本地静态服务器。

## 更新数据

1. 修改 `app.js` 中 `seed()` 里的影片与 `watches`（每场：`date` + `people`）。
2. 需要合并的同人异写，加到 `ALIASES`。
3. 更新构建号（四处需一致）：
   - `app.js` 末尾 `window.__FILMLOG_BUILD__`
   - `index.html` 中 `__EXPECTED_BUILD__` 与 4 个 `?v=` 参数
   - `build.json`
4. 校验：

```bash
node --check app.js
node check.js          # 输出影片数 / 场次 / 人次 / 唯一观影者等基线
```

5. 提交推送，GitHub Pages 自动重新发布。

## 部署

GitHub Pages：`main` 分支根目录，无需构建步骤。

线上地址：https://diozhang1009-afk.github.io/film-log/

## 已知限制

- `localStorage` 仅作为本机覆盖层，不会同步给其他访客；权威数据始终是 `app.js` 的 `seed()`。
- 站内「管理员入口」为早期原型遗留，只写本机 `localStorage`，已关闭入口提示，不影响只读浏览。
- 微信内置浏览器对部分静态托管域名有拦截，若打不开请在系统浏览器中访问。
- 搜索页插画依赖 `assets/`，部署时需整目录上传。
