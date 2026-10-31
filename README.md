**English** | [简体中文](README.zh-CN.md)

# Office Flow

Office Flow is a small personal Obsidian plugin for faster task notes and a softer workspace: inline task buttons, pretty progress cards, one-gesture archiving of temporary to-do lists, and two header shortcuts.

![Progress card above a To_do section](docs/screenshots/progress-card.png)

## Features

- **Shift+Enter for new tasks**: Shift+Enter inserts a task wherever you are; plain Enter on a task only breaks the line.
- **Task edit mode**: inline buttons after every unfinished task for child tasks, pen notes and top-level tasks, plus a category picker for empty tasks.
- **Progress cards**: `office-progress` code blocks render a progress card for a section of the current note or of another note, and keep it up to date as the tasks change.
- **Archive and restore**: hold a card's percent badge to move the section's completed tasks into today's archive file, and hold again there to bring them back.
- **Home and favorite buttons**: two header actions that open your Home note and a favorite note.
- **Pink sidebar**: optional soft pink sidebars and ribbons.

Plain Obsidian API, TypeScript and CSS. No external services, no extra libraries.

## Shift+Enter for new tasks

Shift+Enter starts a task wherever you are, without the mouse:

- on an empty line it types `- [ ] `;
- on a task it adds the next task below, after the task's pen notes, with the same indent;
- on any other line it adds a `- [ ] ` line below.

Plain Enter on a task line just breaks the line, so you can write under a task without getting another checkbox; on an empty task line it removes the marker, as Obsidian does. Both behaviours belong to the *Shift+Enter for new tasks* setting, which is on by default; switch it off to get Obsidian's usual Enter back. The key is the `Insert task checkbox` command's hotkey and can be changed under **Settings → Hotkeys**.

## Task edit mode

In editing mode every unfinished task (`- [ ]`) gets small buttons right after the checkbox:

![Task action buttons with the category picker open](docs/screenshots/task-edit-mode.png)

| Button | Inserts below the task |
| --- | --- |
| `+` | an indented child task (`	- [ ] `) |
| `✎` | an indented pen note (`	🖊`) |
| `-` (child tasks only) | a new top-level task (`- [ ] `) |
| category picker (empty tasks only) | one of four labels as the task text |

Pen notes belong to the task above them, so new tasks are inserted after a task's pen notes, both from the buttons and with Shift+Enter on the task. Backspace on an empty inserted line removes that line again.

The four category labels default to Action, Research, Design and Code and can be changed in settings.

Commands: `Toggle task edit mode`, `Insert child task`, `Insert pen note`, `Insert task checkbox`.

## Progress cards

Put an `office-progress` code block anywhere and list the sections to track, one per line.

A section of the current note:

````md
```office-progress
To_do
```
````

A section of another note, optionally with an alias that becomes the card title:

````md
```office-progress
[[Home 7_21|Work]] : Today's Tasks
[Everyday_Task] : Today's Tasks
```
````

A section is a heading whose text equals the given name (ignoring case), up to the next heading of the same or a higher level. End the name with a colon to match every heading that starts with it, or wrap it in colons to match every heading that contains it:

````md
```office-progress
todo
todo:
:todo:
[[Home 7_21|Work]] : todo:
```
````

`todo` counts only the `todo` heading; `todo:` counts `todo1`, `todo2` and `todo today` together; `:todo:` also counts `🌸 todo 🔒` and `my todo`. Full-width colons (`：`) work too, and the card shows the name without them. Before 1.3.0 every name behaved like `:todo:`.

The counter counts leaf tasks: a task that has child tasks is a group, not a task. Clicking the alias on a cross-note card opens that note.

Cards keep themselves up to date: when a tracked note changes, the card repaints a moment later, right away for notes open in an editor and as soon as Obsidian saves for the rest.

## Archive and restore

A temporary to-do list is most useful when it can be cleared in one gesture but is still kept somewhere. On a card for a section of the current note, the percent badge is that gesture:

1. Click the percent. It turns into an archive icon (it reverts after 5 s, or on a short press).
2. Press and hold the icon for 2 s. A ring fills up, then the completed items under the heading move to today's archive file: every top-level task whose leaf tasks are all checked, together with its child tasks and pen notes. Unfinished items and other text stay, and so do the heading and its `office-progress` block. Sub-headings inside the section stay too; a copy of each goes along with the items moved from under it, so the archive keeps the grouping.

The badge offers archiving only while the section has something to move. Turn off *Archive completed tasks only* in the settings to move everything under the heading instead (tasks, child tasks, pen notes, other blocks), as earlier versions did.

Archived sections land in `archive/todo/2026_10_16_temp_todo.md`. A block keeps the level of its source heading, so a `# To_do` section becomes `# 15:32 To_do` with its sub-sections still nested under it; it only goes shallower when the file already holds a shallower block, so blocks never nest inside each other. Each block carries its own card and remembers where it came from:

````md
# 15:32 To_do
```office-progress
15:32 To_do
restore: [[study/Everyday_Task]] : To_do
```
- [ ] Music_hw
````

Inside the archive folder the badge is blue and works the other way round: hold it to move the block back under its original heading and remove it from the archive file. Items go back to the top of the sub-heading they came from when the note still has it, ahead of the unfinished ones; a sub-section the note no longer has is appended at the end of the section. Notes inside the archive folder are never archived.

Both actions need the heading to match exactly one heading in the note; otherwise you get a notice and nothing is written. The archive file is written before the source is trimmed, so a failed step never loses tasks.

## Home and favorite buttons

Two actions appear at the top right of every Markdown view:

- **Home** opens the note set as *Home note* (default `Home`).
- **Heart** opens the note set as *Favorite note*. Right-click the heart to make the current note the favorite.

Commands: `Open Home note`, `Open favorite note`.

## Pink sidebar

Turns the left and right sidebars and ribbons a soft pink. Just a toggle.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Shift+Enter for new tasks | on | Shift+Enter inserts a task (the `Insert task checkbox` command); Enter on a task line only breaks the line. |
| Task edit mode | on | Show the inline task buttons and the Backspace helper. |
| Category picker | on | Show the category labels on empty tasks. |
| Home button | on | Show the Home and heart actions in view headers. |
| Office progress blocks | on | Render `office-progress` code blocks. |
| Pink sidebar | on | Apply the pink sidebar style. |
| Home note | `Home` | Note opened by the Home action. |
| Favorite note | empty | Note opened by the heart action. |
| Archive completed tasks only | on | Holding the badge moves only the items whose tasks are all done. Off moves everything under the heading. |
| Archive folder | `archive/todo` | Where archived sections go. Cards inside it show the restore control. |
| Archive date format | `YYYY_MM_DD` | Moment.js format for the start of the archive file name. |
| Archive file name suffix | `temp_todo` | Literal text added after the date with an underscore. |
| Category 1 to 4 | Action, Research, Design, Code | Labels offered by the category picker. |

## Installation

Open **Settings** → **Community plugins** → **Browse**, search for **Office Flow** and install it. Later versions show up under **Community plugins** → **Check for updates**.

To install by hand instead:

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [release](https://github.com/dan9574/office-flow/releases/latest).
2. In Obsidian open **Settings** → **Community plugins** → **Installed plugins** and click the **Open plugins folder** icon.
3. Create a folder named `office-flow` inside that plugins folder and put the three files in it.
4. Restart Obsidian, go back to **Community plugins** and enable **Office Flow**.

The task buttons need Obsidian's editing mode (Live Preview or source). Progress cards also render in reading mode and inside other plugins that render Markdown, such as Always-on-Top Tasks.

## Feedback

Ideas, suggestions or a bug? Write to the author at danielnaibuluo@gmail.com, or open an issue on GitHub. I reply, and good ideas may turn into new features.

## Development

```bash
npm install
npm run build
```

`npm run build` type-checks and bundles `src/main.ts` into `main.js`. To try a change, copy `manifest.json`, `main.js` and `styles.css` into `<vault>/.obsidian/plugins/office-flow/` and reload Obsidian. `npm run dev` rebuilds on every save.

To release, bump the version in `manifest.json`, `package.json` and `versions.json`, commit on `main`, and push a tag named after the version (for example `1.2.3`). The release workflow builds the plugin, attests `main.js`, `manifest.json` and `styles.css`, and publishes them as the only release assets; if you create the release by hand first, it attaches the files to that release instead.
