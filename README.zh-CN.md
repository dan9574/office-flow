[English](README.md) | **简体中文**

# Office Flow

Office Flow 是一个小而实用的个人 Obsidian 插件，让任务笔记更快、工作区更柔和：行内任务按钮、漂亮的进度卡片、一个手势归档临时待办清单，以及两个标题栏快捷按钮。

![To_do 章节上方的进度卡片](docs/screenshots/progress-card.png)

## 功能

- **Shift+Enter 新建任务**：在任何位置按 Shift+Enter 插入一条任务；任务行上的 Enter 只换行。
- **任务编辑模式**：每条未完成任务后面有行内按钮，用来插入子任务、🖊 笔记和顶层任务；空任务上还有分类选择器。
- **进度卡片**：`office-progress` 代码块渲染成进度卡片，统计当前笔记或其他笔记的某个章节，任务变化时自动刷新。
- **归档与还原**：按住卡片上的百分比徽章，把章节下已完成的任务移到当天的归档文件；在归档文件里再按住即可还原。
- **Home 与收藏按钮**：标题栏两个按钮，分别打开 Home 笔记和收藏笔记。
- **粉色侧边栏**：可选的柔粉色侧边栏和功能区。

只用 Obsidian 原生 API、TypeScript 和 CSS，没有外部服务，没有额外依赖。

## Shift+Enter 新建任务

不用鼠标，在任何位置按 Shift+Enter 就能开一条任务：

- 空行上：直接输入 `- [ ] `；
- 任务行上：在下方新建下一条任务，插在该任务的 🖊 笔记之后，保持缩进；
- 其他行上：在下一行插入 `- [ ] `。

任务行上的普通 Enter 只换行，不再自动出现新的复选框，方便在任务下面写东西；空任务行上按 Enter 会去掉标记，和 Obsidian 一样。这两项行为都由设置里的 *Shift+Enter for new tasks* 控制，默认开启；关掉即可恢复 Obsidian 原本的 Enter。按键属于 `Insert task checkbox` 命令，可在 **设置 → 快捷键** 里修改。

## 任务编辑模式

编辑模式下，每条未完成任务（`- [ ]`）的复选框后面会出现小按钮：

![任务按钮与展开的分类选择器](docs/screenshots/task-edit-mode.png)

| 按钮 | 在任务下方插入 |
| --- | --- |
| `+` | 一条缩进的子任务（`	- [ ] `） |
| `✎` | 一条缩进的 🖊 笔记（`	🖊`） |
| `-`（仅子任务显示） | 一条新的顶层任务（`- [ ] `） |
| 分类选择器（仅空任务显示） | 四个分类标签之一，作为任务文字 |

🖊 笔记属于它上方的任务，所以新任务会插在任务的笔记行之后，按钮和在任务上按 Shift+Enter 都是如此。在空的插入行上按 Backspace 会把这一行删掉。

四个分类标签默认是 Action、Research、Design、Code，可在设置中修改。

命令：`Toggle task edit mode`、`Insert child task`、`Insert pen note`、`Insert task checkbox`。

## 进度卡片

在任意位置放一个 `office-progress` 代码块，每行写一个要统计的章节。

当前笔记的章节：

````md
```office-progress
To_do
```
````

其他笔记的章节，可加别名作为卡片标题：

````md
```office-progress
[[Home 7_21|Work]] : Today's Tasks
[Everyday_Task] : Today's Tasks
```
````

章节指标题文字与给定名称完全相同（不区分大小写）的标题，范围到下一个同级或更高级标题为止。名称末尾加一个冒号，则匹配所有以它开头的标题；名称两端各加一个冒号，则匹配所有包含它的标题：

````md
```office-progress
todo
todo:
:todo:
[[Home 7_21|Work]] : todo:
```
````

`todo` 只统计标题 `todo`；`todo:` 会把 `todo1`、`todo2`、`todo 今天` 合在一起统计；`:todo:` 还会算上 `🌸 todo 🔒` 和 `my todo`。全角冒号（`：`）同样有效，卡片上显示的名称不带冒号。1.3.0 之前，所有名称都按 `:todo:` 的方式匹配。

计数只算叶子任务：有子任务的任务是分组，不算任务。点击跨笔记卡片上的别名会打开那篇笔记。

卡片会自己保持最新：被统计的笔记一有变化，卡片稍后就会重画。笔记在编辑器里打开时立即更新，其他情况在 Obsidian 保存后更新。

## 归档与还原

临时待办清单最好能一个手势清空，又不会丢。对当前笔记章节的卡片来说，百分比徽章就是这个手势：

1. 点一下百分比，它变成归档图标（5 秒后或短按一下会变回去）。
2. 按住图标 2 秒，圆环填满后，标题下已完成的条目移到当天的归档文件：叶子任务全部打勾的顶层任务，连同它的子任务和 🖊 笔记。未完成的条目和其他文字留在原地，标题和它的 `office-progress` 块也留在原地。章节里的小节标题同样留下，归档块里会带一份小节标题的副本，放在从它下面搬走的条目上方，保持分组。

只有章节里有可移走的内容时，徽章才会变成归档控件。在设置里关掉 *Archive completed tasks only*，就会像以前的版本一样把标题下的全部内容（任务、子任务、🖊 笔记、其他块）都移走。

归档内容写入 `archive/todo/2026_10_16_temp_todo.md`。归档块保留来源标题的级别：`# To_do` 归档成 `# 15:32 To_do`，小节仍嵌在它下面；只有文件里已经有更浅的块时才会跟着变浅，保证块与块之间不会互相嵌套。每个块自带一张卡片，并记住来源：

````md
# 15:32 To_do
```office-progress
15:32 To_do
restore: [[study/Everyday_Task]] : To_do
```
- [ ] Music_hw
````

在归档文件夹里，徽章变成蓝色，操作反过来：按住它把块移回原来的标题下，并从归档文件删除。来源笔记里还有同名小节时，条目回到那个小节的开头、排在未完成的条目前面；来源里已经没有的小节整段追加到章节末尾。归档文件夹内的笔记永远不会被归档。

两种操作都要求标题在笔记中唯一匹配，否则弹出提示且不写入任何内容。归档文件先写入、再删除源内容，所以中途失败不会丢任务。

## Home 与收藏按钮

每个 Markdown 视图右上角有两个按钮：

- **Home** 打开设置里的 *Home note*（默认 `Home`）。
- **爱心** 打开设置里的 *Favorite note*。在爱心上点右键，把当前笔记设为收藏。

命令：`Open Home note`、`Open favorite note`。

## 粉色侧边栏

把左右侧边栏和功能区变成柔粉色。只是一个开关。

## 设置

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| Shift+Enter for new tasks | 开 | Shift+Enter 插入任务（`Insert task checkbox` 命令）；任务行上的 Enter 只换行。 |
| Task edit mode | 开 | 显示行内任务按钮和 Backspace 辅助。 |
| Category picker | 开 | 在空任务上显示分类标签。 |
| Home button | 开 | 在视图标题栏显示 Home 和爱心按钮。 |
| Office progress blocks | 开 | 渲染 `office-progress` 代码块。 |
| Pink sidebar | 开 | 应用粉色侧边栏样式。 |
| Home note | `Home` | Home 按钮打开的笔记。 |
| Favorite note | 空 | 爱心按钮打开的笔记。 |
| Archive completed tasks only | 开 | 按住徽章只移动任务全部完成的条目；关掉则移动标题下的全部内容。 |
| Archive folder | `archive/todo` | 归档内容的去处。文件夹内的卡片显示还原控件。 |
| Archive date format | `YYYY_MM_DD` | 归档文件名开头的日期格式（Moment.js）。 |
| Archive file name suffix | `temp_todo` | 日期后用下划线连接的纯文字。 |
| Category 1 到 4 | Action、Research、Design、Code | 分类选择器提供的标签。 |

## 安装

打开 **设置** → **第三方插件** → **浏览**，搜索 **Office Flow** 并安装。之后的新版本会出现在 **第三方插件** → **检查更新** 里。

也可以手动安装：

1. 从最新的 [Release](https://github.com/dan9574/office-flow/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css` 三个文件。
2. 打开 Obsidian **设置** → **第三方插件** → **已安装插件**，点击 **打开插件文件夹** 图标。
3. 在这个插件文件夹里新建一个名为 `office-flow` 的文件夹，把三个文件放进去。
4. 重启 Obsidian，回到 **第三方插件** 设置页并启用 **Office Flow**。

任务按钮需要 Obsidian 的编辑模式（实时预览或源码模式）。进度卡片在阅读模式下也能渲染，也能在其他渲染 Markdown 的插件里显示，例如 Always-on-Top Tasks。

## 反馈与联系

有任何想法、建议或 bug，欢迎写信给作者：danielnaibuluo@gmail.com，也可以在 GitHub 提 issue。我会回复，好的想法可能会变成新功能。

## 开发

```bash
npm install
npm run build
```

`npm run build` 会做类型检查并把 `src/main.ts` 打包成 `main.js`。要试运行改动，把 `manifest.json`、`main.js`、`styles.css` 复制到 `<库>/.obsidian/plugins/office-flow/` 后重载 Obsidian。`npm run dev` 会在每次保存时重新构建。

发布时，先在 `manifest.json`、`package.json` 和 `versions.json` 中更新版本号，在 `main` 上提交，然后推送一个以版本号命名的标签（例如 `1.2.3`）。发布工作流会构建插件，为 `main.js`、`manifest.json`、`styles.css` 生成构建来源证明（attestation），并只用这三个文件发布 GitHub release；如果你先手动创建了 release，工作流会把文件附加到那个 release 上。
