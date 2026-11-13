# 页间 PageNest 技术报告

## 一、项目定位

页间是一个**本地优先的阅读工作台**。它把书籍导入、阅读、AI 问答和思维导图放在同一个界面里：阅读时不需要跳转到独立页面，问答与导图以侧边模块的形式挂在正文右侧；所有书籍、问答、导图和设置默认保存在本机 `data/` 目录。

技术目标有三个：

1. 多种文档格式统一转化为可阅读、可检索、可问答的文本与 HTML。
2. 在阅读上下文中提供低打扰的问答与导图能力。
3. 将“严格依据原文”和“允许模型知识”两种 AI 使用方式明确区分，避免回答来源混淆。

## 二、技术栈

| 层次 | 技术 |
| --- | --- |
| 前端 | React 19、Vite 6、Lucide 图标、marked、DOMPurify |
| 后端 | Node.js 18+、Express 4、Multer |
| 文档解析 | Cheerio、Mammoth、word-extractor、PDF.js、JSZip、iconv-lite |
| 内容安全 | sanitize-html、DOMPurify、SSRF/DNS 校验 |
| AI | OpenAI 兼容 Chat Completions 接口（DeepSeek / OpenAI / 自定义） |
| 存储 | 本地 JSON + 原始文件 + 图片资源，原子写入与进程内写锁 |
| 验证 | Node API 回归脚本、Playwright + Edge 浏览器验收 |

## 三、总体架构

```text
浏览器（React SPA）
  ├─ 书架 / 阅读器 / 问答 / 导图 / 设置
  ├─ 阅读器右侧 Dock：ReaderAskPanel + ReaderMapPanel
  └─ PDF.js Canvas + TextLayer
        │  /api/*
        ▼
Express 服务
  ├─ 导入与解析：server/parsers.js
  ├─ 检索与 AI：server/retrieval.js、server/ai.js
  ├─ 数据与锁：server/store.js
  └─ REST API：server/index.js
        │
        ▼
data/
  ├─ library.json / books/ / files/ / assets/
  ├─ maps.json / threads.json / settings.json
```

前端采用单页应用，使用 hash 路由组织页面；阅读器内部通过状态切换章节、PDF 页码、侧边 Dock，而不是每次跳转路由。后端只监听 `127.0.0.1`，默认端口 `4173`。

## 四、关键实现

### 1. 导入与解析

上传文件由 Multer 接收后，根据扩展名进入不同解析器：

- **TXT / Markdown**：自动检测 UTF-8、UTF-16、GB18030；按“第 X 章”、Markdown 标题等规则切章；过长的纯文本按段落安全分节。
- **DOCX**：Mammoth 转 HTML，同时从 `docProps/core.xml` 读取标题与作者；再按标题切章。
- **DOC**：word-extractor 提取纯文本，按章节规则切分。
- **PDF**：PDF.js 提取每页文本，按页保存；原 PDF 文件保留，阅读时由 PDF.js 渲染 Canvas 与可选中文字层。
- **HTML / 网页**：Cheerio 提取正文，清理导航、脚本、广告等节点；网页图片下载到本地 `assets/`。
- **EPUB**：JSZip 解包，读取 OPF/Spine，按章节抽取 XHTML，内嵌图片转 data URI。

解析结果统一经过 `finalizeContent()`：清洗 HTML、重新提取纯文本、统计字数、生成章节 ID。所有章节 HTML 都会经过 sanitize-html 白名单处理，前端阅读器再使用 DOMPurify 做一次渲染防护。

微信公众号文章通过 `mp.weixin.qq.com` 链接直接抓取；如果微信返回验证页或风控页，导入失败并引导用户使用「粘贴正文」导入。

### 2. 本地存储与并发

书籍元数据、正文、问答、导图和设置分开存储：

- `library.json`：书架元数据与阅读进度。
- `books/<id>.json`：章节 HTML、纯文本、PDF 页文本等。
- `files/`：原始 PDF、Word、EPUB 等文件。
- `maps.json`：所有思维导图；每张图包含 `scopeType`、`chapterIndex`、`concept` 等范围信息。
- `threads.json`：问答会话与消息来源。
- `settings.json`：AI 配置，API Key 只保存在本机。

写入采用“临时文件 + rename”的原子替换，并使用按资源的进程内互斥锁串行化书架、问答、导图等读改写操作。临时文件名包含随机 UUID，避免并发上传时同名覆盖。这样解决了本地多请求同时写入时的丢数据与残留临时文件问题。

### 3. 阅读器与侧边模块

阅读器由三部分组成：

- **左侧目录**：章节或 PDF 页面/大纲。
- **中间正文**：HTML 文章或 PDF Canvas + TextLayer。
- **右侧 Dock**：按需挂载问答或导图模块。

Dock 有两种布局：

- 宽屏（>1360px）作为阅读区右侧的固定栏，正文自动缩窄。
- 窄屏作为覆盖式抽屉，移动端占满屏幕宽度。

顶栏提供问答、导图入口；选中文字右键选择「就这段内容提问」时，阅读器直接打开问答 Dock，并把选中文本填入输入框。阅读进度、章节、PDF 页码仍由阅读器状态统一管理。

PDF 阅读使用 PDF.js 渲染 Canvas，并根据文本项坐标生成绝对定位的透明文字层，实现选中、右键与搜索高亮。页码通过页面可见面积判断当前页，并用 ResizeObserver/可见性观察控制页面渲染，避免长文档一次性占用过多内存。

### 4. 问答双模式

服务端 `POST /api/ask` 接收 `qaMode`、`scope`、`chapterIndex` 等参数。

- **严格素材模式（strict）**
  - 检索范围限定为当前章节/页或整本书。
  - System Prompt 明确禁止使用模型自身知识，禁止编造事实与引文。
  - 检索不到素材时，要求模型直接说明“素材中没有足够信息”。
  - 没有配置 AI 时退回本地检索，只返回原文段落。
  - 适合解读原文、文本问答、出题。

- **自由拓展模式（free）**
  - 素材作为参考，允许调用模型原生知识。
  - 提示模型区分“来自原文”和“补充背景”，前者用 `[1]` 引用，后者标注“补充背景”。
  - 未配置 AI 时直接拒绝，并提示先配置模型。

检索层会把书库切成约 900 字的块，使用中文二元/三元组、英文词和停用词过滤做相关性评分；章节范围问答即使问题是“这一节讲了什么”这类泛问题，也会把本章原文加入上下文，避免检索不到关键词时无法回答。每个回答返回来源卡片（书名、章节/页码、片段），点击可跳回原文位置。

### 5. 思维导图

#### 数据模型

导图是递归树：

```json
{
  "text": "根节点",
  "note": "备注",
  "children": [{ "text": "分支", "children": [] }]
}
```

每张图额外保存：

- `bookId` / `bookTitle`
- `scopeType`：`book | chapter | concept`
- `chapterIndex`：章节范围
- `concept`：概念名称
- `revisionCount` / `lastInstruction`：AI 指令修改记录

因此同一本书可以保存任意多张导图，并分别按章节、概念或整本书组织。

#### 生成

- **本地提取**：按章节标题、小标题、句子关键词与位置权重提取结构，离线可用。
- **AI 提炼**：向模型发送限定范围内的原文，要求只输出指定 JSON；失败时自动回退本地提取。
- **AI 指令修改**：`POST /api/maps/:id/revise` 把当前导图 JSON、修改指令和原文参考发给模型，要求保留未要求变更的结构，返回完整 JSON。服务端校验、限制节点数与深度后保存，并递增 `revisionCount`。

#### 前端编辑器

完整画布使用 SVG 连接线 + 绝对定位 HTML 节点：

- 自动树形布局：根据文本测量节点宽高，递归计算子树高度，再分配横纵坐标。
- 平移/缩放、适应画布、节点双击编辑、Tab 添加子节点、Enter 添加同级、Delete 删除、备注、撤销/重做。
- 导出 PNG、SVG、Markdown、JSON。

阅读器侧栏使用同一套布局与 SVG 生成逻辑，只做紧凑预览和 AI 指令修改入口；“编辑”按钮仍可打开完整画布。

### 6. 安全与边界

- **XSS**：导入阶段 sanitize-html 白名单，阅读器渲染前 DOMPurify；HTML 原文件通过附件形式下载，避免被浏览器当作页面执行。
- **SSRF**：网页导入与图片下载会校验协议、域名、IPv4/IPv6 私网地址、DNS 解析结果，并逐跳检查重定向；DNS 结果带短 TTL 缓存。
- **文件访问**：书籍原始文件按扩展名决定 inline/attachment；PDF 允许内联，HTML 强制 `text/plain` 附件。
- **错误处理**：损坏 DOCX/PDF 返回可读的 4xx 错误；500 不向前端泄露内部堆栈。
- **AI Key**：只保存在本机设置文件中；设置接口只返回掩码预览，不返回明文。

## 五、验证情况

- `npm run build` 通过，产物在 `dist/`。
- 后端回归脚本覆盖：网页导入、HTML/EPUB 清洗、SSRF 拦截、损坏文件、并发上传、并发问答等 21 项。
- 浏览器验收覆盖：书架、TXT/PDF 阅读、右键菜单、书内搜索、问答、导图手动编辑、移动端布局，控制台错误为 0。
- 新增侧边模块专项验证：严格问答返回来源、自由模式回答、右键自动带入问题、章节/概念导图生成、AI 指令修改导图、390px 移动端无横向溢出。
- 后期功能验证：笔记创建/编辑/AI 分类/Word 下载、概念树 UI 新建与编辑、联网搜索开关/4 条来源/5 分钟缓存、翻页模式字号重排与页内搜索跳转。浏览器测试 console/pageerror 为 0。

## 六、后续功能扩展

在初版基础上，阅读器增加了六块能力：

1. **读书笔记**：`notes.json` 按书保存笔记；AI 按主题分类、生成标题与摘要；`server/docx.js` 用 JSZip 直接生成 OOXML `.docx`，每本书可独立导出，并在笔记变更后自动同步到 `data/notes-word/`。
2. **概念树**：新增 `concepts.json` 与概念编辑页。选定多本书与主题后，先做跨书 RAG 检索，再把检索片段作为唯一引文来源交给 AI，输出“概念—定义—关系—refs”树；`refs` 回填为原书引文，前端支持增删节点、修改定义与关系。
3. **联网搜索问答**：`server/search.js` 实现开关式搜索分支。顺序固定为本书 RAG → Query 优化（AI 或启发式）→ 5 分钟缓存 → 百度/必应结果 → 去重/广告过滤/相关性排序 → 4 条结果 → 单条 250 字、整块 1000 字截断。Prompt 顺序固定为【本书素材】→【联网搜索补充资料】→用户问题；无结果时移除搜索区块。严格模式仅允许“书本 + 明确标注的网络来源”，禁止模型记忆；自由模式允许模型知识并区分【原文】【网络来源】（模型知识）。
4. **翻页阅读**：`PagedReader` 使用 CSS multi-column 分页，字号/行距/版心变化自动重排；页码进度接入原有保存机制，左右方向键翻页，首末页可跨章节。
5. **深色界面与显示控制**：新增 `theme-dark.css`、`display.css`、`DisplayControls`。全局 90/100/110/120 字号通过根容器 zoom 与主题层实现；护眼模式写入 `data-eye`；阅读器目录支持桌面折叠、移动端抽屉，并用 localStorage 记忆状态。
6. **问答侧栏双模式**：`Reader` 的问答侧栏支持临时打开与「常驻」固定，`--dock-width` 由中间分隔条拖动调整并持久化；`qa-type.css` 统一放大问答侧栏与独立问答页的正文、来源和输入框字号。

## 七、已知限制

- 扫描版 PDF 没有文字层，只能阅读页面图像，无法直接选中文字或做文本检索。
- 微信文章抓取受微信风控影响，失败时需要“粘贴正文”导入。
- 旧版 `.doc` 仅提取纯文本，复杂排版会损失。
- AI 问答/导图/笔记整理/概念树需要自备兼容接口的 API Key；严格模式在无 AI 时只能用本地检索。
- 联网搜索依赖公开搜索结果页，可能受网络、地区或反爬策略影响；无有效结果时自动只使用本书素材。
- 当前是单机本地应用，没有多用户权限系统；AI 调用会把命中的原文片段发送到用户配置的模型服务。

## 八、主要文件索引

- 前端入口：[src/App.jsx](src/App.jsx)、[src/pages/Reader.jsx](src/pages/Reader.jsx)
- 侧边问答：[src/reader/ReaderAskPanel.jsx](src/reader/ReaderAskPanel.jsx)
- 侧边导图：[src/reader/ReaderMapPanel.jsx](src/reader/ReaderMapPanel.jsx)
- 侧边笔记：[src/reader/ReaderNotesPanel.jsx](src/reader/ReaderNotesPanel.jsx)
- 翻页阅读：[src/reader/PagedReader.jsx](src/reader/PagedReader.jsx)
- 概念树：[src/pages/Concepts.jsx](src/pages/Concepts.jsx)、[src/pages/ConceptEditor.jsx](src/pages/ConceptEditor.jsx)
- PDF 渲染：[src/reader/PdfViewer.jsx](src/reader/PdfViewer.jsx)
- 后端 API：[server/index.js](server/index.js)
- 文档解析：[server/parsers.js](server/parsers.js)
- 检索与 AI：[server/retrieval.js](server/retrieval.js)、[server/ai.js](server/ai.js)
- 联网搜索：[server/search.js](server/search.js)
- 笔记与 Word：[server/notes.js](server/notes.js)、[server/docx.js](server/docx.js)
- 概念树：[server/concepts.js](server/concepts.js)
- 存储与锁：[server/store.js](server/store.js)

## 九、首次初始化与便携 Node

目标设备不要求预装 Node。首次双击 `初始化.cmd`，由 `bootstrap/bootstrap.ps1` 完成：

1. 检测 Windows 架构（x64 / ARM64）与项目目录写权限。
2. 读取 `data/settings.json`，将 `ai.apiKey` 置为空字符串；保留 provider、baseUrl、model、ui 等其他设置，并以无 BOM UTF-8 写回。
3. 检查 `runtime/node-v24.22.2-win-<arch>/node.exe` 是否可用；可用则直接启动。
4. 否则优先使用 `bootstrap/payload/` 内的离线 Node zip；缺失时才从 nodejs.org 下载，npmmirror 兜底。
5. 用 `bootstrap/checksums.json` 中的 SHA256 校验压缩包。
6. 解压到 `runtime/.staging-*`，验证 `node.exe -v` 通过后再移动到 `runtime/node-v24.22.2-win-<arch>/`。
7. 写入 `runtime/installed.json` 和 `runtime/bootstrap.log`。
8. 生成项目内 `打开页间.lnk` 与桌面 `页间 PageNest.lnk`，目标指向项目内 Node，参数为 `launcher.js`。
9. 启动 `launcher.js`，由它启动 `server/index.js` 并打开 `http://127.0.0.1:4173`。

整个安装只写项目 `runtime/` 目录，不写注册表、不修改 PATH、不需要管理员权限。除清空 `ai.apiKey` 外，不会修改 `data/` 中的书籍、笔记或问答数据。
