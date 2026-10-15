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
今日任务
```
````

Another note section:

````md
```office-progress
[[Home 7_21|工作]] : 今日任务
[Everyday_Task] : 今日任务
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

## Install manually

1. Build or download these files:

```text
manifest.json
main.js
styles.css
```

2. Put them into your vault plugin folder:

```text
<YourVault>/.obsidian/plugins/office-flow/
```

3. Enable **Office Flow** in Obsidian's Community plugins settings.

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
