# XAvatarWall

一个 Chrome / Edge / Chromium 浏览器扩展：输入你的 X（Twitter）用户名，自动采集粉丝头像，并生成一张「粉丝纪念头像墙」图片（JPG）。

> 无需 X API、无需 Python、无需手动导出 JSON、无需手动下载头像。

## 功能

- 使用浏览器已登录的 X 账号，打开 `https://x.com/<用户名>/followers` 自动采集粉丝
- 自动滚动加载、去重、断点续采（页面刷新后继续）
- 后台下载头像到本地缓存（IndexedDB），规避 `pbs.twimg.com` 跨域问题
- 自动排版头像墙：`cols = ceil(sqrt(n))`、`rows = ceil(n / cols)`
- 支持三种排序：X 显示顺序 / 老粉优先 / 新粉优先
- 自定义头像大小与背景颜色，输出 95% 质量 JPEG

## 安装

### Chrome / Edge

1. 打开浏览器扩展管理页：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
2. 打开右上角「开发者模式 / Developer mode」。
3. 点击「加载已解压的扩展程序 / Load unpacked」。
4. 选择本目录（`XAvatarWall/`）。

### 狐猴浏览器（或其他 Chromium 内核浏览器）

在扩展管理页中同样选择「加载已解压的扩展程序」，选择本目录即可。

## 使用

1. 点击工具栏中的 XAvatarWall 图标，打开控制面板。
2. 输入 X 用户名（可带 `@`，例如 `qiujiudev`）。
3. 选择生成数量、头像大小、排序方式与背景颜色。
4. 点击「开始制作」。
5. 扩展会自动打开粉丝页并开始采集，完成后自动下载头像并生成图片。
6. 生成页面会显示预览并自动尝试下载 `XAvatarWall.jpg`；若被浏览器拦截，点击「保存 JPG」。

## 个性化设置（插件首页 + 实时预览）

点击扩展图标打开首页，展开「个性化设置」即可修改：

- 顶部标题：默认「XX fo谢谢大家，感谢大家！」，XX 会自动替换为图片中的头像数量
- 图片下方文字：可留空
- 背景风格：经典纯色 / 渐变（从上到下、从左到右、左上到右下、中间向四周）/ 深色
- 背景颜色：自由选择；选择渐变风格时会出现渐变起始色与结束色
- 头像形状：圆角（默认）/ 方形 / 圆形
- 标题颜色：默认蓝色（#2563eb）
- 我的头像展示：采集完成后扩展会自动打开你的主页并保存你的头像，
  默认「我最大（左上角）」，也可以「居中放大」或「不显示」
- 网格间距：自动（默认）/ 紧凑 / 宽松

所有修改会实时保存在本地，生成图片时自动生效。

## 版本与更新检测

- 扩展主页右上角显示当前版本与内部版本号。
- 打开扩展时会自动检测最新版本：默认读取 GitHub 仓库的 `manifest.json`。
- 如果你有自己的阿里云服务器，可以修改 `background.js` 顶部的
  `UPDATE_URL`，指向一个包含 `{"version": "1.1.0"}` 的 JSON 文件，
  并在 `manifest.json` 的 `host_permissions` 中加入你的服务器域名。
- 发现新版本时，扩展主页右上角会显示「发现新版本 vX」提示。

## 注意事项

- 请先确保浏览器已经登录 X，否则无法读取粉丝列表。
- 采集数量较多时（例如数千人）需要一定时间，请保持粉丝页标签页处于打开状态。
- 若后台任务意外中断，可重新打开扩展面板点击「打开生成页面」手动继续生成。

## 项目结构

```text
XAvatarWall/
├── manifest.json      扩展清单（Manifest V3）
├── popup.html         控制面板
├── popup.js           控制面板逻辑
├── style.css          控制面板样式
├── background.js      后台调度（通信 / 下载 / 打开生成页）
├── collector.js       内容脚本（采集粉丝 + 自动滚动）
├── downloader.js      头像下载（fetch -> Blob -> 缓存，含重试）
├── db.js              IndexedDB 头像缓存
├── generator.html     图片生成页
├── generator.js       头像墙绘制与 JPG 输出
├── assets/icon.png    扩展图标
└── README.md
```

## 数据流

```text
popup ──START──> background ──打开 followers 页──> collector
                                                    │ 采集 + 自动滚动
                                                    ▼
                                         chrome.storage.local (fansData / progress / config)
                                                    │ COLLECT_DONE
                                                    ▼
                                  background ──> downloader ──> IndexedDB (avatar Blob)
                                                    │
                                                    ▼
                                           generator.html ──> XAvatarWall.jpg
```

## 权限说明

- `storage`：保存粉丝数据、任务配置与进度。
- `tabs`：打开粉丝页与生成页。
- 主机权限 `*.x.com`、`*.twitter.com`：采集粉丝页。
- 主机权限 `*.twimg.com`：后台下载头像图片。

## 路线图（后续可选）

- 自定义模板与更多排版
- 把用户自己的头像加入标题栏
- 更多文字 / 水印选项
- 采集进度更细粒度展示
- 打包发布到 Chrome 网上应用店与 GitHub
