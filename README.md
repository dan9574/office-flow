# Office Flow

Office Flow is a small personal Obsidian plugin for faster task notes and a softer workspace.

## Features

- **Task edit mode**: inline buttons for quickly adding child tasks, pen notes, and top-level tasks.
- **Task categories**: category picker for empty tasks, with four configurable labels.
- **Home button**: a lightweight top-right action that opens your configured Home note.
- **Favorite button**: a heart next to Home. Click opens the favorite note; right-click sets the current note as the favorite.
- **Office progress blocks**: render progress cards from short `office-progress` code blocks.
- **Pink sidebar**: optional soft pink sidebar and ribbon styling.

## Progress block syntax

Current note section:

````md
```office-progress
Today's Tasks
```
````

Another note section:

````md
```office-progress
[[Home 7_21|Work]] : Today's Tasks
[Everyday_Task] : Today's Tasks
```
````

The progress counter counts leaf tasks: parent tasks with child tasks do not count as tasks themselves.

## Archive and restore

On a card for a section of the current note, the percent badge is also the archive control:

1. Click the percent: it turns into an archive icon (auto-reverts after 5 s).
2. Short-press the icon to go back to the percent.
3. Press and hold for 2 s: a ring fills, then everything under the heading (tasks, child tasks, pen notes, other blocks) moves to today's archive file. The heading and its `office-progress` block stay in place.

Archived sections land in `archive/todo/2026_10_15_temp_todo.md`: the folder, the date format (`YYYY_MM_DD`, Moment.js tokens) and the literal suffix (`temp_todo`) are settings. Each one is written as:

````md
## 15:32 临时任务
```office-progress
15:32 临时任务
restore: [[study/Everyday_Task]] : 临时任务
```
- [ ] test
````

Inside the archive folder the same badge becomes a restore control: hold it to move the block back under the original heading and remove it from the archive file. Notes inside the archive folder are never archived. Both actions require the heading to match exactly one heading in the note.

## Installation

1. Download the latest release package from the [Releases](https://github.com/dan9574/office-flow/releases/tag/v1_0_1) page.
2. Extract the downloaded `.zip` file.
3. Open **Settings** in Obsidian.
4. Navigate to **Community plugins** -> **Installed plugins**, and click the **Open plugins folder** icon (folder icon).
5. Extract the contents of the downloaded file directly into this opened plugins folder.
6. Restart Obsidian, go back to the **Community plugins** settings, and enable the plugin.

---

## 安装指南

1. 从 [Releases](https://github.com/dan9574/office-flow/releases/tag/v1_0_1) 页面下载最新的安装包。
2. 解压缩下载的安装包。
3. 打开 Obsidian **设置**。
4. 找到 **第三方插件** -> **已安装插件**，点击 **打开插件文件夹** 图标。
5. 将刚才下载的文件解压到这个打开的插件文件夹中。
6. 重启 Obsidian，返回 **第三方插件** 设置页面并启用该插件。
## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

During development, copy the built files into a test vault:

```text
manifest.json
main.js
styles.css
```
