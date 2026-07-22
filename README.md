# Office Flow

Office Flow is a small personal Obsidian plugin for faster task notes and a softer workspace.

## Features

- **Task edit mode**: inline buttons for quickly adding child tasks, pen notes, and top-level tasks.
- **Task categories**: category picker for empty tasks, with four configurable labels.
- **Home button**: a lightweight top-right action that opens your configured Home note.
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
