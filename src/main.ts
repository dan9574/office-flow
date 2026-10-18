import { Extension, Prec, RangeSetBuilder } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	keymap,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import {
	App,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	getIcon,
	moment,
	normalizePath,
	setIcon,
} from 'obsidian';

const UNFINISHED_TASK_LINE = /^(\t?)- \[ \]/;
const EMPTY_TASK_LINE = /^(\t?- \[ \])\s*$/;
const PEN_NOTE_LINE = /^\s*🖊/;
const EMPTY_INSERTED_LINE = /^(?:\t?- \[ \] ?|\t?🖊 ?)$/;
const INSERTED_TOP_LEVEL_TASK_LINE = '- [ ] ';
const INSERTED_TASK_LINE = '\t- [ ] ';
const INSERTED_NOTE_LINE = '\t🖊';
const DEFAULT_CATEGORIES = ['Action', 'Research', 'Design', 'Code'] as const;
const CATEGORY_COUNT = 4;
const PINK_SIDEBAR_CLASS = 'office-flow-pink-sidebar';
const DEFAULT_ARCHIVE_FOLDER = 'archive/todo';
const DEFAULT_ARCHIVE_DATE_FORMAT = 'YYYY_MM_DD';
const DEFAULT_ARCHIVE_FILE_SUFFIX = 'temp_todo';
/** Keep in sync with the ring transition duration in styles.css. */
const ARCHIVE_HOLD_MS = 2000;
const ARCHIVE_ARM_TIMEOUT_MS = 5000;
const OFFICE_PROGRESS_FENCE_LINE = /^\s*(?:```+|~~~+)\s*office-progress\s*$/i;
const RESTORE_TARGET_LINE = /^restore\s*:\s*(.+)$/i;

interface OfficeFlowSettings {
	homeNote: string;
	enableTaskEditMode: boolean;
	enableCategoryPicker: boolean;
	enableInsertTaskHotkey: boolean;
	enableHomeButton: boolean;
	enableOfficeProgressBlocks: boolean;
	enablePinkSidebar: boolean;
	categories: string[];
	favoriteNote: string;
	archiveFolder: string;
	archiveDateFormat: string;
	archiveFileSuffix: string;
}

const DEFAULT_SETTINGS: OfficeFlowSettings = {
	homeNote: 'Home',
	enableTaskEditMode: true,
	enableCategoryPicker: true,
	enableInsertTaskHotkey: false,
	enableHomeButton: true,
	enableOfficeProgressBlocks: true,
	enablePinkSidebar: true,
	categories: [...DEFAULT_CATEGORIES],
	favoriteNote: '',
	archiveFolder: DEFAULT_ARCHIVE_FOLDER,
	archiveDateFormat: DEFAULT_ARCHIVE_DATE_FORMAT,
	archiveFileSuffix: DEFAULT_ARCHIVE_FILE_SUFFIX,
};

interface OfficeFlowViewActions {
	officeFlowHomeActionEl?: HTMLElement;
	officeFlowFavoriteActionEl?: HTMLElement;
}

export default class OfficeFlowPlugin extends Plugin {
	settings!: OfficeFlowSettings;
	private taskEditModeEnabled = false;
	private readonly editorExtensions: Extension[] = [];

	async onload() {
		await this.loadSettings();
		this.taskEditModeEnabled = this.settings.enableTaskEditMode;

		this.registerEditorExtension(this.editorExtensions);
		this.refreshTaskEditModeExtension();
		this.applyPinkSidebarSetting();
		this.addSettingTab(new OfficeFlowSettingTab(this.app, this));

		this.addCommand({
			id: 'test-notice',
			name: 'Test notice',
			callback: () => {
				new Notice('Office Flow is working.');
			},
		});

		this.addCommand({
			id: 'toggle-task-edit-mode',
			name: 'Toggle task edit mode',
			callback: () => {
				this.taskEditModeEnabled = !this.taskEditModeEnabled;
				this.settings.enableTaskEditMode = this.taskEditModeEnabled;
				void this.saveSettings();
				this.refreshTaskEditModeExtension();
				new Notice(
					`Office Flow task edit mode ${this.taskEditModeEnabled ? 'enabled' : 'disabled'}.`,
				);
			},
		});

		this.addCommand({
			id: 'insert-child-task',
			name: 'Insert child task',
			editorCallback: (editor: Editor) => {
				insertLineBelowCurrentTask(editor, INSERTED_TASK_LINE);
			},
		});

		this.addCommand({
			id: 'insert-pen-note',
			name: 'Insert pen note',
			editorCallback: (editor: Editor) => {
				insertLineBelowCurrentTask(editor, INSERTED_NOTE_LINE);
			},
		});

		// Opt-in: the setting gates the command so the hotkey stays inert until the user wants it.
		this.addCommand({
			id: 'insert-task-checkbox',
			name: 'Insert task checkbox',
			hotkeys: [{ modifiers: ['Alt'], key: 'Enter' }],
			editorCheckCallback: (checking: boolean, editor: Editor) => {
				if (!this.settings.enableInsertTaskHotkey) {
					return false;
				}

				if (!checking) {
					insertTaskCheckbox(editor);
				}

				return true;
			},
		});

		this.addCommand({
			id: 'open-home-note',
			name: 'Open Home note',
			callback: () => {
				void this.openHomeNote();
			},
		});

		this.addCommand({
			id: 'open-favorite-note',
			name: 'Open favorite note',
			callback: () => {
				void this.openFavoriteNote();
			},
		});

		this.registerMarkdownCodeBlockProcessor('office-progress', (source, el, ctx) => {
			if (!this.settings.enableOfficeProgressBlocks) {
				el.empty();
				return;
			}

			void renderOfficeProgressBlock(this, source, el, ctx.sourcePath);
		});

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.addHomeActionToActiveMarkdownView();
			}),
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.applyPinkSidebarSetting();
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			this.addHomeActionToActiveMarkdownView();
			this.applyPinkSidebarSetting();
		});
	}

	onunload() {
		this.removeHomeActions();
		document.body.removeClass(PINK_SIDEBAR_CLASS);
	}

	async loadSettings(): Promise<void> {
		const loaded: unknown = await this.loadData();
		const saved = loaded !== null && typeof loaded === 'object' ? (loaded as Partial<OfficeFlowSettings>) : {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		this.settings.homeNote = normalizeHomeNote(this.settings.homeNote);
		this.settings.categories = normalizeCategories(this.settings.categories);
		this.settings.favoriteNote = normalizeHomeNote(this.settings.favoriteNote ?? '');
		this.settings.archiveFolder = normalizeFolderPath(this.settings.archiveFolder);
		this.settings.archiveDateFormat = normalizeDateFormat(this.settings.archiveDateFormat);
		this.settings.archiveFileSuffix = normalizeFileSuffix(this.settings.archiveFileSuffix);
		// Dropped in 1.1.1: the single format string mangled literal text like "temp_todo".
		delete (this.settings as unknown as Record<string, unknown>)['archiveFileNameFormat'];
	}

	async saveSettings(): Promise<void> {
		this.settings.categories = normalizeCategories(this.settings.categories);
		await this.saveData(this.settings);
	}

	getTaskCategories(): string[] {
		return normalizeCategories(this.settings.categories);
	}

	setTaskEditModeEnabled(enabled: boolean): void {
		this.taskEditModeEnabled = enabled;
		this.settings.enableTaskEditMode = enabled;
		this.refreshTaskEditModeExtension();
	}

	applyHomeButtonSetting(): void {
		if (this.settings.enableHomeButton) {
			this.addHomeActionToActiveMarkdownView();
			return;
		}

		this.removeHomeActions();
	}

	/** The pink sidebar is plain CSS in styles.css, switched on by a body class. */
	applyPinkSidebarSetting(): void {
		document.body.toggleClass(PINK_SIDEBAR_CLASS, this.settings.enablePinkSidebar);
	}

	async openHomeNote(): Promise<void> {
		const homeNote = normalizeHomeNote(this.settings.homeNote);

		if (!homeNote) {
			new Notice('Set a Home note in Office Flow settings first.');
			return;
		}

		const homeFile = this.app.metadataCache.getFirstLinkpathDest(homeNote, '');

		if (!homeFile) {
			new Notice(`Home note not found: ${homeNote}`);
			return;
		}

		await this.app.workspace.openLinkText(homeNote, '', false);
	}

	async openFavoriteNote(): Promise<void> {
		const favoriteNote = normalizeHomeNote(this.settings.favoriteNote);

		if (!favoriteNote) {
			new Notice('Right-click the heart to set the current note as favorite.');
			return;
		}

		const favoriteFile = this.app.metadataCache.getFirstLinkpathDest(favoriteNote, '');

		if (!favoriteFile) {
			new Notice(`Favorite note not found: ${favoriteNote}`);
			return;
		}

		await this.app.workspace.openLinkText(favoriteNote, '', false);
	}

	async setFavoriteNote(file: TFile | null): Promise<void> {
		if (!file) {
			new Notice('Open a note first, then right-click the heart.');
			return;
		}

		this.settings.favoriteNote = file.path.replace(/\.md$/i, '');
		await this.saveSettings();
		new Notice(`Favorite note: ${this.settings.favoriteNote}`);
	}

	private addHomeActionToActiveMarkdownView(): void {
		if (!this.settings.enableHomeButton) {
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (!view) {
			return;
		}

		const viewWithActions = view as MarkdownView & OfficeFlowViewActions;

		if (
			viewWithActions.officeFlowHomeActionEl?.isConnected &&
			viewWithActions.officeFlowFavoriteActionEl?.isConnected
		) {
			return;
		}

		viewWithActions.officeFlowHomeActionEl?.remove();
		viewWithActions.officeFlowFavoriteActionEl?.remove();

		const homeEl = view.addAction('home', 'Open Home note', () => {
			void this.openHomeNote();
		});
		homeEl.addClass('office-flow-home-action');

		const favoriteEl = view.addAction(
			'heart',
			'Open favorite note (right-click: set current note as favorite)',
			() => {
				void this.openFavoriteNote();
			},
		);
		favoriteEl.addClass('office-flow-home-action', 'office-flow-favorite-action');
		favoriteEl.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.setFavoriteNote(view.file);
		});

		// Keep the heart immediately left of Home whatever order addAction uses.
		homeEl.insertAdjacentElement('beforebegin', favoriteEl);

		viewWithActions.officeFlowHomeActionEl = homeEl;
		viewWithActions.officeFlowFavoriteActionEl = favoriteEl;
	}

	private removeHomeActions(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;

			if (!(view instanceof MarkdownView)) {
				return;
			}

			const viewWithActions = view as MarkdownView & OfficeFlowViewActions;

			viewWithActions.officeFlowHomeActionEl?.remove();
			viewWithActions.officeFlowHomeActionEl = undefined;
			viewWithActions.officeFlowFavoriteActionEl?.remove();
			viewWithActions.officeFlowFavoriteActionEl = undefined;
		});
	}

	refreshTaskEditModeExtension(): void {
		this.editorExtensions.length = 0;

		if (this.taskEditModeEnabled) {
			this.editorExtensions.push(
				createTaskActionsExtension(this),
				createEmptyLineCleanupExtension(),
			);
		}

		this.app.workspace.updateOptions();
	}
}

class OfficeFlowSettingTab extends PluginSettingTab {
	plugin: OfficeFlowPlugin;

	constructor(app: App, plugin: OfficeFlowPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Task edit mode')
			.setDesc('Show task action buttons and enable task edit-mode helpers by default.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableTaskEditMode).onChange(async (value) => {
					this.plugin.setTaskEditModeEnabled(value);
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Category picker')
			.setDesc('Show category choices on empty tasks.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableCategoryPicker).onChange(async (value) => {
					this.plugin.settings.enableCategoryPicker = value;
					await this.plugin.saveSettings();
					this.plugin.refreshTaskEditModeExtension();
				}),
			);

		new Setting(containerEl)
			.setName('Insert task hotkey')
			.setDesc(
				'Enable the "Insert task checkbox" command: Alt+Enter turns an empty line into "- [ ] " or starts a new task below the current line. Change the key under Settings → Hotkeys.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableInsertTaskHotkey).onChange(async (value) => {
					this.plugin.settings.enableInsertTaskHotkey = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Home button')
			.setDesc('Show the Home action in Markdown view headers.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableHomeButton).onChange(async (value) => {
					this.plugin.settings.enableHomeButton = value;
					await this.plugin.saveSettings();
					this.plugin.applyHomeButtonSetting();
				}),
			);

		new Setting(containerEl)
			.setName('Office progress blocks')
			.setDesc('Render office-progress code blocks.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableOfficeProgressBlocks).onChange(async (value) => {
					this.plugin.settings.enableOfficeProgressBlocks = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Pink sidebar')
			.setDesc('Apply the soft pink sidebar and ribbon style.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enablePinkSidebar).onChange(async (value) => {
					this.plugin.settings.enablePinkSidebar = value;
					await this.plugin.saveSettings();
					this.plugin.applyPinkSidebarSetting();
				}),
			);

		new Setting(containerEl).setName('Home').setHeading();

		new Setting(containerEl)
			.setName('Home note')
			.setDesc('File name or path to open from the editor Home button, for example Home or folder/Home.')
			.addText((text) =>
				text
					.setPlaceholder('Home')
					.setValue(this.plugin.settings.homeNote)
					.onChange(async (value) => {
						this.plugin.settings.homeNote = normalizeHomeNote(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Favorite note')
			.setDesc(
				'Opened by the heart action next to Home. Right-clicking the heart sets the current note here.',
			)
			.addText((text) =>
				text
					.setPlaceholder('study/Everyday_Task')
					.setValue(this.plugin.settings.favoriteNote)
					.onChange(async (value) => {
						this.plugin.settings.favoriteNote = normalizeHomeNote(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('Archive').setHeading();

		new Setting(containerEl)
			.setName('Archive folder')
			.setDesc(
				'Folder that receives archived sections. Progress cards inside this folder show a restore button instead of an archive button.',
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_ARCHIVE_FOLDER)
					.setValue(this.plugin.settings.archiveFolder)
					.onChange(async (value) => {
						this.plugin.settings.archiveFolder = normalizeFolderPath(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Archive date format')
			.setDesc('Moment.js date format that starts the daily archive file name, for example YYYY_MM_DD.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_ARCHIVE_DATE_FORMAT)
					.setValue(this.plugin.settings.archiveDateFormat)
					.onChange(async (value) => {
						this.plugin.settings.archiveDateFormat = normalizeDateFormat(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Archive file name suffix')
			.setDesc(
				'Plain text added after the date with an underscore: temp_todo gives 2026_10_15_temp_todo.md. Leave empty for the date only.',
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_ARCHIVE_FILE_SUFFIX)
					.setValue(this.plugin.settings.archiveFileSuffix)
					.onChange(async (value) => {
						this.plugin.settings.archiveFileSuffix = normalizeFileSuffix(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('Task categories').setHeading();

		const categories = this.plugin.getTaskCategories();

		for (let index = 0; index < CATEGORY_COUNT; index++) {
			new Setting(containerEl)
				.setName(`Category ${index + 1}`)
				.setDesc('Used by the empty-task category picker.')
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_CATEGORIES[index] ?? '')
						.setValue(categories[index] ?? '')
						.onChange(async (value) => {
							this.plugin.settings.categories[index] = value.trim();
							await this.plugin.saveSettings();
							this.plugin.refreshTaskEditModeExtension();
						}),
				);
		}
	}
}

function normalizeHomeNote(value: string): string {
	return value.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]?.trim() ?? '';
}

function normalizeFolderPath(value: unknown): string {
	const trimmed = typeof value === 'string' ? value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
	return trimmed ? normalizePath(trimmed) : DEFAULT_ARCHIVE_FOLDER;
}

function normalizeDateFormat(value: unknown): string {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return trimmed || DEFAULT_ARCHIVE_DATE_FORMAT;
}

/** Literal text only: strip path separators and characters Windows rejects in file names. */
function normalizeFileSuffix(value: unknown): string {
	return typeof value === 'string' ? value.trim().replace(/[\\/:*?"<>|]/g, '') : '';
}

function normalizeCategories(value: unknown): string[] {
	const source = Array.isArray(value) ? value : [];

	return Array.from({ length: CATEGORY_COUNT }, (_, index) => {
		const defaultCategory = DEFAULT_CATEGORIES[index] ?? '';
		const category = String(source[index] ?? '').trim();
		return category || defaultCategory;
	});
}

function createTaskActionsExtension(plugin: OfficeFlowPlugin): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildTaskActionDecorations(view, plugin);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = buildTaskActionDecorations(update.view, plugin);
				}
			}
		},
		{
			decorations: (value) => value.decorations,
		},
	);
}

function createEmptyLineCleanupExtension(): Extension {
	return Prec.highest(
		keymap.of([
			{
				key: 'Enter',
				run: insertTaskAfterFollowingPenNotes,
			},
			{
				key: 'Backspace',
				run: deleteEmptyInsertedLine,
			},
		]),
	);
}

function insertTaskAfterFollowingPenNotes(view: EditorView): boolean {
	const selection = view.state.selection.main;

	if (!selection.empty) {
		return false;
	}

	const line = view.state.doc.lineAt(selection.head);
	const match = UNFINISHED_TASK_LINE.exec(line.text);

	if (!match) {
		return false;
	}

	const insertedLine = line.text.startsWith('\t') ? INSERTED_TASK_LINE : INSERTED_TOP_LEVEL_TASK_LINE;
	const insertAfterLine = getLastFollowingPenNoteLine(view, line);

	if (insertAfterLine.number === line.number) {
		return false;
	}

	const insertedText = `\n${insertedLine}`;
	const cursorPosition = insertAfterLine.to + insertedText.length;

	view.dispatch({
		changes: {
			from: insertAfterLine.to,
			insert: insertedText,
		},
		selection: {
			anchor: cursorPosition,
		},
	});

	return true;
}

function deleteEmptyInsertedLine(view: EditorView): boolean {
	const selection = view.state.selection.main;

	if (!selection.empty) {
		return false;
	}

	const line = view.state.doc.lineAt(selection.head);

	if (!EMPTY_INSERTED_LINE.test(line.text)) {
		return false;
	}

	const deleteFrom = line.from === 0 ? line.from : line.from - 1;
	const cursorPosition = Math.max(0, deleteFrom);

	view.dispatch({
		changes: {
			from: deleteFrom,
			to: line.to,
		},
		selection: {
			anchor: cursorPosition,
		},
	});

	return true;
}

function buildTaskActionDecorations(
	view: EditorView,
	plugin: OfficeFlowPlugin,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;
	const seenLines = new Set<number>();

	for (const { from, to } of view.visibleRanges) {
		let position = from;

		while (position <= to) {
			const line = doc.lineAt(position);

			if (!seenLines.has(line.number)) {
				seenLines.add(line.number);

				const match = UNFINISHED_TASK_LINE.exec(line.text);

				if (match) {
					const widgetPosition = line.from + match[0].length;
					builder.add(
						widgetPosition,
						widgetPosition,
						Decoration.widget({
							widget: new TaskActionWidget(
								line.number,
								line.text.startsWith('\t'),
								EMPTY_TASK_LINE.test(line.text),
								plugin.settings.enableCategoryPicker,
								plugin.getTaskCategories(),
							),
							side: 1,
						}),
					);
				}
			}

			if (line.to >= doc.length) {
				break;
			}

			position = line.to + 1;
		}
	}

	return builder.finish();
}

class TaskActionWidget extends WidgetType {
	constructor(
		private readonly lineNumber: number,
		private readonly isTabbedTask: boolean,
		private readonly isEmptyTask: boolean,
		private readonly showCategoryPicker: boolean,
		private readonly categories: string[],
	) {
		super();
	}

	eq(other: TaskActionWidget): boolean {
		return (
			other.lineNumber === this.lineNumber &&
			other.isTabbedTask === this.isTabbedTask &&
			other.isEmptyTask === this.isEmptyTask &&
			other.showCategoryPicker === this.showCategoryPicker &&
			other.categories.join(' ') === this.categories.join(' ')
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const wrapper = createSpan({
			cls: 'office-flow-task-actions',
			attr: { 'aria-label': 'Office Flow task actions' },
		});

		const addButton = createTaskActionButton('+', 'Insert child task', () => {
			insertLineBelowTask(view, this.lineNumber, INSERTED_TASK_LINE);
		});

		const noteButton = createTaskActionButton('✎', 'Insert pen note', () => {
			insertLineBelowTask(view, this.lineNumber, INSERTED_NOTE_LINE);
		});
		noteButton.addClass('office-flow-task-action-pen');

		wrapper.append(addButton, noteButton);

		if (this.isTabbedTask) {
			const outdentButton = createTaskActionButton('-', 'Insert top-level task', () => {
				insertLineBelowTask(view, this.lineNumber, INSERTED_TOP_LEVEL_TASK_LINE);
			});

			wrapper.append(outdentButton);
		}

		if (this.isEmptyTask && this.showCategoryPicker) {
			wrapper.append(createTaskCategoryPicker(view, this.lineNumber, this.categories));
		}

		return wrapper;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function createTaskCategoryPicker(
	view: EditorView,
	lineNumber: number,
	categories: string[],
): HTMLElement {
	const picker = createSpan({ cls: 'office-flow-task-category-picker' });

	const trigger = createTaskActionButton('', 'Choose task category', () => undefined);
	trigger.addClass('office-flow-task-category-trigger');
	trigger.setAttribute('aria-expanded', 'false');
	trigger.createSpan({ cls: 'office-flow-task-category-icon' });
	picker.append(trigger);

	const options = createSpan({
		cls: 'office-flow-task-category-options',
		attr: { 'aria-label': 'Task categories' },
	});

	for (const [index, category] of categories.entries()) {
		const option = createTaskActionButton(
			category,
			`Insert ${category} category`,
			() => {
				insertTaskCategory(view, lineNumber, category);
			},
		);
		option.addClass('office-flow-task-category-option');
		option.addClass(`office-flow-task-category-option-${index + 1}`);
		options.append(option);
	}

	picker.append(options);
	return picker;
}

function createTaskActionButton(
	text: string,
	label: string,
	onClick: () => void,
): HTMLButtonElement {
	const button = createEl('button', {
		cls: 'office-flow-task-action-button',
		text,
		attr: { type: 'button', 'aria-label': label },
	});

	button.addEventListener('mousedown', (event) => {
		event.preventDefault();
		event.stopPropagation();
	});

	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		onClick();
	});

	return button;
}

function insertLineBelowTask(
	view: EditorView,
	lineNumber: number,
	insertedLine: string,
): void {
	const line = view.state.doc.line(lineNumber);

	if (!UNFINISHED_TASK_LINE.test(line.text)) {
		return;
	}

	const insertAfterLine = shouldSkipFollowingPenNotes(insertedLine)
		? getLastFollowingPenNoteLine(view, line)
		: line;
	const insertedText = `\n${insertedLine}`;
	const cursorPosition = insertAfterLine.to + insertedText.length;

	view.dispatch({
		changes: {
			from: insertAfterLine.to,
			insert: insertedText,
		},
		selection: {
			anchor: cursorPosition,
		},
	});

	view.focus();
}

function shouldSkipFollowingPenNotes(insertedLine: string): boolean {
	return insertedLine === INSERTED_TASK_LINE || insertedLine === INSERTED_TOP_LEVEL_TASK_LINE;
}

function getLastFollowingPenNoteLine(
	view: EditorView,
	line: { number: number; to: number },
): { number: number; to: number } {
	const doc = view.state.doc;
	let lastLine = line;
	let nextLineNumber = line.number + 1;

	while (nextLineNumber <= doc.lines) {
		const nextLine = doc.line(nextLineNumber);

		if (!PEN_NOTE_LINE.test(nextLine.text)) {
			break;
		}

		lastLine = nextLine;
		nextLineNumber++;
	}

	return lastLine;
}

function insertTaskCategory(
	view: EditorView,
	lineNumber: number,
	category: string,
): void {
	const line = view.state.doc.line(lineNumber);
	const match = EMPTY_TASK_LINE.exec(line.text);
	const marker = match?.[1];

	if (!marker) {
		return;
	}

	const insertFrom = line.from + marker.length;
	const insertedText = ` ${category} `;

	view.dispatch({
		changes: {
			from: insertFrom,
			to: line.to,
			insert: insertedText,
		},
		selection: {
			anchor: insertFrom + insertedText.length,
		},
	});

	view.focus();
}

function insertLineBelowCurrentTask(editor: Editor, insertedLine: string): void {
	const cursor = editor.getCursor();
	const currentLine = editor.getLine(cursor.line);

	if (!UNFINISHED_TASK_LINE.test(currentLine)) {
		new Notice('Place the cursor on an unfinished task first.');
		return;
	}

	const insertLine = shouldSkipFollowingPenNotes(insertedLine)
		? getLastFollowingPenNoteEditorLine(editor, cursor.line)
		: cursor.line;
	const insertLineText = editor.getLine(insertLine);

	editor.replaceRange(`\n${insertedLine}`, {
		line: insertLine,
		ch: insertLineText.length,
	});

	editor.setCursor({
		line: insertLine + 1,
		ch: insertedLine.length,
	});
}

function getLastFollowingPenNoteEditorLine(editor: Editor, lineNumber: number): number {
	let lastLineNumber = lineNumber;
	let nextLineNumber = lineNumber + 1;

	while (nextLineNumber < editor.lineCount()) {
		const nextLine = editor.getLine(nextLineNumber);

		if (!PEN_NOTE_LINE.test(nextLine)) {
			break;
		}

		lastLineNumber = nextLineNumber;
		nextLineNumber++;
	}

	return lastLineNumber;
}

/**
 * "Insert task checkbox" command: an empty line becomes `- [ ] `; any other line gets a new
 * `- [ ] ` line below it (after a task's pen notes), keeping the current indent.
 */
function insertTaskCheckbox(editor: Editor): void {
	const cursor = editor.getCursor();
	const currentLine = editor.getLine(cursor.line);
	const indent = /^[\t ]*/.exec(currentLine)?.[0] ?? '';
	const taskLine = `${indent}${INSERTED_TOP_LEVEL_TASK_LINE}`;

	if (currentLine.trim() === '') {
		editor.replaceRange(
			taskLine,
			{ line: cursor.line, ch: 0 },
			{ line: cursor.line, ch: currentLine.length },
		);
		editor.setCursor({ line: cursor.line, ch: taskLine.length });
		return;
	}

	const insertLine = UNFINISHED_TASK_LINE.test(currentLine)
		? getLastFollowingPenNoteEditorLine(editor, cursor.line)
		: cursor.line;
	const insertLineText = editor.getLine(insertLine);

	editor.replaceRange(`\n${taskLine}`, { line: insertLine, ch: insertLineText.length });
	editor.setCursor({ line: insertLine + 1, ch: taskLine.length });
}

interface HeadingRange {
	name: string;
	level: number;
	startLine: number;
	endLineExclusive: number;
}

interface ParsedTaskLine {
	lineIndex: number;
	indentLevel: number;
	checked: boolean;
}

interface ProgressCounts {
	completed: number;
	total: number;
}

/** How a section name is compared with heading text. All modes ignore case. */
type SectionMatchMode = 'exact' | 'prefix' | 'contains';

interface ProgressTarget {
	noteName: string | null;
	noteDisplayName: string | null;
	/** The name to look for, without the colon markers that select prefix or contains matching. */
	sectionName: string;
	matchMode: SectionMatchMode;
	displayName: string;
}

interface ProgressCardData extends ProgressCounts {
	sectionName: string;
	targetSectionName: string;
	matchMode: SectionMatchMode;
	noteName: string | null;
	noteDisplayName: string | null;
	percent: number;
	found: boolean;
	sourceFound: boolean;
	hasContent: boolean;
}

interface SectionBody {
	/** Lines that stay in place: the office-progress code block(s) of the section. */
	kept: string[];
	/** Everything else under the heading, trimmed of surrounding blank lines. */
	content: string[];
}

interface ProgressBlockContext {
	plugin: OfficeFlowPlugin;
	source: string;
	containerEl: HTMLElement;
	sourcePath: string;
	restoreTarget: ProgressTarget | null;
}

type ProgressActionKind = 'archive' | 'restore';

interface ProgressAction {
	kind: ProgressActionKind;
	run: () => Promise<string>;
}

type ProgressBadgeState = 'percent' | 'armed' | 'holding' | 'busy';

class OfficeFlowActionError extends Error {}

async function renderOfficeProgressBlock(
	plugin: OfficeFlowPlugin,
	source: string,
	containerEl: HTMLElement,
	sourcePath: string,
): Promise<void> {
	const app = plugin.app;
	containerEl.empty();

	const targets = parseProgressTargets(source);

	if (targets.length === 0) {
		renderProgressMessage(containerEl, 'Add section names inside this office-progress block.');
		return;
	}

	const file = app.vault.getAbstractFileByPath(sourcePath);

	if (!(file instanceof TFile)) {
		renderProgressMessage(containerEl, 'Office Flow could not read this note.');
		return;
	}

	const currentMarkdown = await app.vault.cachedRead(file);
	const cards: ProgressCardData[] = [];

	for (const target of targets) {
		const markdown = await readProgressTargetMarkdown(
			app,
			target,
			sourcePath,
			currentMarkdown,
		);
		cards.push(calculateProgressCard(target, markdown, markdown !== null));
	}

	renderProgressCards(
		{ plugin, source, containerEl, sourcePath, restoreTarget: parseRestoreTarget(source) },
		cards,
	);
}

async function readProgressTargetMarkdown(
	app: App,
	target: ProgressTarget,
	sourcePath: string,
	currentMarkdown: string,
): Promise<string | null> {
	if (target.noteName === null) {
		return currentMarkdown;
	}

	const file = app.metadataCache.getFirstLinkpathDest(target.noteName, sourcePath);

	if (!file) {
		return null;
	}

	return app.vault.cachedRead(file);
}

function parseProgressTargets(source: string): ProgressTarget[] {
	const seen = new Set<string>();
	const targets: ProgressTarget[] = [];

	for (const line of source.split(/\r?\n/)) {
		if (RESTORE_TARGET_LINE.test(line.trim())) {
			continue;
		}

		const target = parseProgressTarget(line);

		if (!target) {
			continue;
		}

		const key = `${target.noteName ?? 'current'}::${target.matchMode}::${target.sectionName}`.toLowerCase();

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		targets.push(target);
	}

	return targets;
}

function parseRestoreTarget(source: string): ProgressTarget | null {
	for (const line of source.split(/\r?\n/)) {
		const match = RESTORE_TARGET_LINE.exec(line.trim());

		if (!match) {
			continue;
		}

		// Restore lines carry the real heading name, so a trailing colon is part of the name.
		const target = parseProgressTarget(match[1] ?? '', false);
		return target && target.noteName !== null ? target : null;
	}

	return null;
}

function parseProgressTarget(line: string, allowPrefixMarker = true): ProgressTarget | null {
	const trimmedLine = line.trim();

	if (!trimmedLine) {
		return null;
	}

	const wikiNoteMatch = /^\[\[([^\]]+)\]\]\s*:\s*(.+)$/.exec(trimmedLine);
	const singleNoteMatch = /^\[([^\]]+)\]\s*:\s*(.+)$/.exec(trimmedLine);
	const crossNoteMatch = wikiNoteMatch ?? singleNoteMatch;

	if (!crossNoteMatch) {
		const { sectionName, matchMode } = parseSectionPattern(trimmedLine, allowPrefixMarker);

		return {
			noteName: null,
			noteDisplayName: null,
			sectionName,
			matchMode,
			displayName: sectionName,
		};
	}

	const bracketTarget = wikiNoteMatch ? `[[${crossNoteMatch[1]?.trim() ?? ''}]]` : crossNoteMatch[1]?.trim();
	const rawSectionName = crossNoteMatch[2]?.trim();

	if (!bracketTarget || !rawSectionName) {
		return null;
	}

	const { noteName, noteDisplayName } = parseProgressNoteTarget(bracketTarget);

	if (!noteName) {
		return null;
	}

	const { sectionName, matchMode } = parseSectionPattern(rawSectionName, allowPrefixMarker);

	return {
		noteName,
		noteDisplayName,
		sectionName,
		matchMode,
		displayName: `${noteDisplayName} : ${sectionName}`,
	};
}

/**
 * `todo` matches the heading "todo" only; `todo:` matches every heading that starts with "todo";
 * `:todo:` matches every heading that contains "todo". Full-width colons (`：`) work the same way.
 */
function parseSectionPattern(
	raw: string,
	allowPrefixMarker: boolean,
): { sectionName: string; matchMode: SectionMatchMode } {
	const trimmed = raw.trim();

	if (allowPrefixMarker) {
		const containsName = /^[:：]\s*(.+?)\s*[:：]$/.exec(trimmed)?.[1]?.trim();

		if (containsName) {
			return { sectionName: containsName, matchMode: 'contains' };
		}

		const prefixName = /^(.+?)\s*[:：]$/.exec(trimmed)?.[1]?.trim();

		if (prefixName) {
			return { sectionName: prefixName, matchMode: 'prefix' };
		}
	}

	return { sectionName: trimmed, matchMode: 'exact' };
}

function parseProgressNoteTarget(target: string): {
	noteName: string;
	noteDisplayName: string;
} {
	const wikiMatch = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(target);

	if (!wikiMatch) {
		return {
			noteName: target.trim(),
			noteDisplayName: target.trim(),
		};
	}

	const noteName = wikiMatch[1]?.trim() ?? '';
	const alias = wikiMatch[2]?.trim();

	return {
		noteName,
		noteDisplayName: alias || noteName,
	};
}

function calculateProgressCard(
	target: ProgressTarget,
	markdown: string | null,
	sourceFound: boolean,
): ProgressCardData {
	if (markdown === null) {
		return {
			sectionName: target.displayName,
			targetSectionName: target.sectionName,
			matchMode: target.matchMode,
			noteName: target.noteName,
			noteDisplayName: target.noteDisplayName,
			completed: 0,
			total: 0,
			percent: 0,
			found: false,
			sourceFound,
			hasContent: false,
		};
	}

	const lines = markdown.split(/\r?\n/);
	const headings = findHeadings(lines);
	const ranges = findMatchingHeadingRanges(headings, target.sectionName, target.matchMode);
	const counts = countLeafTasksInRanges(lines, ranges);
	const percent = counts.total === 0 ? 0 : Math.round((counts.completed / counts.total) * 100);

	return {
		sectionName: target.displayName,
		targetSectionName: target.sectionName,
		matchMode: target.matchMode,
		noteName: target.noteName,
		noteDisplayName: target.noteDisplayName,
		completed: counts.completed,
		total: counts.total,
		percent,
		found: ranges.length > 0,
		sourceFound,
		hasContent: ranges.some((range) => splitSectionBody(lines, range).content.length > 0),
	};
}

function findHeadings(lines: string[]): HeadingRange[] {
	const headings: HeadingRange[] = [];
	let inFence = false;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? '';

		if (isFenceLine(line)) {
			inFence = !inFence;
			continue;
		}

		if (inFence) {
			continue;
		}

		const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);

		if (!match) {
			continue;
		}

		const marker = match[1];
		const name = match[2];

		if (!marker || !name) {
			continue;
		}

		headings.push({
			name: name.trim(),
			level: marker.length,
			startLine: index,
			endLineExclusive: lines.length,
		});
	}

	for (let index = 0; index < headings.length; index++) {
		const heading = headings[index];

		if (!heading) {
			continue;
		}

		for (let nextIndex = index + 1; nextIndex < headings.length; nextIndex++) {
			const nextHeading = headings[nextIndex];

			if (!nextHeading) {
				continue;
			}

			if (nextHeading.level <= heading.level) {
				heading.endLineExclusive = nextHeading.startLine;
				break;
			}
		}
	}

	return headings;
}

function findMatchingHeadingRanges(
	headings: HeadingRange[],
	sectionName: string,
	matchMode: SectionMatchMode,
): HeadingRange[] {
	const needle = sectionName.trim().toLowerCase();

	if (!needle) {
		return [];
	}

	return headings.filter((heading) => {
		const name = heading.name.toLowerCase();

		switch (matchMode) {
			case 'prefix':
				return name.startsWith(needle);
			case 'contains':
				return name.includes(needle);
			default:
				return name === needle;
		}
	});
}

function countLeafTasksInRanges(
	lines: string[],
	ranges: HeadingRange[],
): ProgressCounts {
	let completed = 0;
	let total = 0;

	for (const range of ranges) {
		const tasks = collectTasksInRange(lines, range);

		for (let index = 0; index < tasks.length; index++) {
			const task = tasks[index];

			if (!task) {
				continue;
			}

			if (task.indentLevel === 0 && hasChildTask(tasks, index)) {
				continue;
			}

			total++;

			if (task.checked) {
				completed++;
			}
		}
	}

	return { completed, total };
}

function collectTasksInRange(lines: string[], range: HeadingRange): ParsedTaskLine[] {
	const tasks: ParsedTaskLine[] = [];
	let inFence = false;

	for (let index = range.startLine + 1; index < range.endLineExclusive; index++) {
		const line = lines[index] ?? '';

		if (isFenceLine(line)) {
			inFence = !inFence;
			continue;
		}

		if (inFence) {
			continue;
		}

		const task = getTaskLineInfo(line, index);

		if (task) {
			tasks.push(task);
		}
	}

	return tasks;
}

function getTaskLineInfo(line: string, lineIndex: number): ParsedTaskLine | null {
	const match = /^(\t*)- \[([ xX])\]/.exec(line);

	if (!match) {
		return null;
	}

	const indent = match[1];
	const status = match[2];

	if (indent === undefined || status === undefined) {
		return null;
	}

	return {
		lineIndex,
		indentLevel: indent.length,
		checked: status.toLowerCase() === 'x',
	};
}

function hasChildTask(tasks: ParsedTaskLine[], taskIndex: number): boolean {
	const task = tasks[taskIndex];

	if (!task) {
		return false;
	}

	for (let index = taskIndex + 1; index < tasks.length; index++) {
		const nextTask = tasks[index];

		if (!nextTask) {
			continue;
		}

		if (nextTask.indentLevel <= task.indentLevel) {
			return false;
		}

		if (nextTask.indentLevel > task.indentLevel) {
			return true;
		}
	}

	return false;
}

function isFenceLine(line: string): boolean {
	return /^\s*(```+|~~~+)/.test(line);
}

function renderProgressCards(context: ProgressBlockContext, cards: ProgressCardData[]): void {
	const { plugin, containerEl, sourcePath } = context;
	const app = plugin.app;
	const wrapper = containerEl.createDiv({ cls: 'office-flow-progress' });

	for (const card of cards) {
		const cardEl = wrapper.createDiv({
			cls: `office-flow-progress-card${card.total === 0 ? ' office-flow-progress-card-empty' : ''}`,
		});
		const headerEl = cardEl.createDiv({ cls: 'office-flow-progress-card-header' });
		const titleEl = headerEl.createDiv({ cls: 'office-flow-progress-title' });
		renderProgressTitle(app, titleEl, card, sourcePath);
		renderProgressBadge(context, headerEl, card, resolveProgressAction(context, card));

		const metaText = !card.sourceFound
			? 'Note not found'
			: card.found
				? `${card.completed} / ${card.total} leaf tasks complete`
				: 'No matching section found';
		cardEl.createDiv({ cls: 'office-flow-progress-meta', text: metaText });

		const trackEl = cardEl.createDiv({ cls: 'office-flow-progress-track' });
		trackEl.setAttribute('role', 'progressbar');
		trackEl.setAttribute('aria-label', `${card.sectionName}: ${card.completed} of ${card.total} leaf tasks complete`);
		trackEl.setAttribute('aria-valuemin', '0');
		trackEl.setAttribute('aria-valuemax', '100');
		trackEl.setAttribute('aria-valuenow', String(card.percent));

		const fillEl = trackEl.createDiv({ cls: 'office-flow-progress-fill' });
		fillEl.setCssProps({ '--office-flow-progress': `${card.percent}%` });
	}
}

function renderProgressTitle(
	app: App,
	containerEl: HTMLElement,
	card: ProgressCardData,
	sourcePath: string,
): void {
	if (!card.noteName || !card.noteDisplayName) {
		containerEl.setText(card.sectionName);
		return;
	}

	const noteLink = containerEl.createEl('button', {
		cls: 'office-flow-progress-note-link',
		text: card.noteDisplayName,
	});
	noteLink.type = 'button';
	noteLink.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		void app.workspace.openLinkText(card.noteName ?? '', sourcePath, false);
	});

	containerEl.createSpan({ text: ` : ${card.targetSectionName}` });
}

function renderProgressMessage(containerEl: HTMLElement, message: string): void {
	containerEl.createDiv({
		cls: 'office-flow-progress-empty-message',
		text: message,
	});
}

// ---------- Archive / restore ----------

function resolveProgressAction(
	context: ProgressBlockContext,
	card: ProgressCardData,
): ProgressAction | null {
	if (card.noteName !== null || !card.found || !card.hasContent) {
		return null;
	}

	const { plugin, sourcePath, restoreTarget } = context;

	if (isPathInFolder(sourcePath, plugin.settings.archiveFolder)) {
		if (!restoreTarget) {
			return null;
		}

		return {
			kind: 'restore',
			run: () => restoreSection(plugin, sourcePath, card.targetSectionName, card.matchMode, restoreTarget),
		};
	}

	return {
		kind: 'archive',
		run: () => archiveSection(plugin, sourcePath, card.targetSectionName, card.matchMode),
	};
}

function isPathInFolder(path: string, folder: string): boolean {
	if (!folder) {
		return false;
	}

	return path.toLowerCase().startsWith(`${folder.toLowerCase()}/`);
}

function resolveActionIcon(kind: ProgressActionKind): string {
	if (kind === 'archive') {
		return 'archive';
	}

	return getIcon('archive-restore') ? 'archive-restore' : 'undo-2';
}

/**
 * The percent badge doubles as the archive / restore control:
 * percent --click--> armed (icon) --short press--> percent
 *                    armed --hold 2s (ring fills)--> busy --> action runs --> card re-renders
 */
function renderProgressBadge(
	context: ProgressBlockContext,
	headerEl: HTMLElement,
	card: ProgressCardData,
	action: ProgressAction | null,
): void {
	const percentText = `${card.percent}%`;

	if (!action) {
		headerEl.createDiv({ cls: 'office-flow-progress-percent', text: percentText });
		return;
	}

	const actionLabel = action.kind === 'archive' ? 'Archive section' : 'Restore section';
	const badge = headerEl.createEl('button', {
		cls: `office-flow-progress-percent office-flow-progress-badge office-flow-progress-badge-${action.kind}`,
		attr: {
			'aria-label': `${actionLabel}: click, then hold for ${ARCHIVE_HOLD_MS / 1000}s`,
			title: `${actionLabel}: click, then hold for ${ARCHIVE_HOLD_MS / 1000}s`,
		},
	});
	badge.type = 'button';

	const ring = badge.createSvg('svg', {
		cls: 'office-flow-progress-ring',
		attr: { viewBox: '0 0 36 36', 'aria-hidden': 'true' },
	});
	ring.createSvg('circle', {
		cls: 'office-flow-progress-ring-track',
		attr: { cx: '18', cy: '18', r: '15.5' },
	});
	ring.createSvg('circle', {
		cls: 'office-flow-progress-ring-fill',
		attr: { cx: '18', cy: '18', r: '15.5' },
	});
	badge.createSpan({ cls: 'office-flow-progress-badge-label', text: percentText });
	const iconEl = badge.createSpan({ cls: 'office-flow-progress-badge-icon' });
	setIcon(iconEl, resolveActionIcon(action.kind));

	let state: ProgressBadgeState = 'percent';
	let pressedState: ProgressBadgeState | null = null;
	let holdTimer: number | null = null;
	let armTimer: number | null = null;

	const clearTimers = () => {
		if (holdTimer !== null) {
			window.clearTimeout(holdTimer);
			holdTimer = null;
		}

		if (armTimer !== null) {
			window.clearTimeout(armTimer);
			armTimer = null;
		}
	};

	const setState = (next: ProgressBadgeState) => {
		state = next;
		badge.toggleClass('is-armed', next === 'armed' || next === 'holding');
		badge.toggleClass('is-holding', next === 'holding');
		badge.toggleClass('is-busy', next === 'busy');
	};

	const disarm = () => {
		clearTimers();
		setState('percent');
	};

	const arm = () => {
		clearTimers();
		setState('armed');
		armTimer = window.setTimeout(disarm, ARCHIVE_ARM_TIMEOUT_MS);
	};

	const execute = async () => {
		clearTimers();
		setState('busy');

		try {
			const message = await action.run();
			new Notice(message);
			await renderOfficeProgressBlock(
				context.plugin,
				context.source,
				context.containerEl,
				context.sourcePath,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Office Flow: ${message}`);
			console.error('Office Flow archive/restore failed', error);
			setState('percent');
		}
	};

	const startHold = () => {
		clearTimers();
		setState('holding');
		holdTimer = window.setTimeout(() => {
			holdTimer = null;
			void execute();
		}, ARCHIVE_HOLD_MS);
	};

	const capturePointer = (event: PointerEvent) => {
		try {
			badge.setPointerCapture(event.pointerId);
		} catch {
			// The pointer may already be gone; capture is only a convenience.
		}
	};

	const releasePointer = (event: PointerEvent) => {
		try {
			if (badge.hasPointerCapture(event.pointerId)) {
				badge.releasePointerCapture(event.pointerId);
			}
		} catch {
			// Ignore stale pointer ids.
		}
	};

	badge.addEventListener('pointerdown', (event) => {
		if (event.button !== 0 || state === 'busy') {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		pressedState = state;
		capturePointer(event);

		if (state === 'armed') {
			startHold();
		}
	});

	const release = (event: PointerEvent) => {
		event.stopPropagation();
		releasePointer(event);

		const pressed = pressedState;
		pressedState = null;

		if (state === 'holding') {
			// Released before the hold completed: back to the plain percent.
			disarm();
			return;
		}

		if (state === 'percent' && pressed === 'percent') {
			arm();
		}
	};

	badge.addEventListener('pointerup', release);
	badge.addEventListener('pointercancel', release);
	badge.addEventListener('mousedown', (event) => {
		event.preventDefault();
		event.stopPropagation();
	});
	badge.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
	});
	badge.addEventListener('contextmenu', (event) => {
		event.preventDefault();
	});
}

async function archiveSection(
	plugin: OfficeFlowPlugin,
	sourcePath: string,
	sectionName: string,
	matchMode: SectionMatchMode,
): Promise<string> {
	const app = plugin.app;
	const sourceFile = getMarkdownFile(app, sourcePath);
	const sourceLines = splitLines(await app.vault.read(sourceFile));
	const range = findUniqueHeadingRange(sourceLines, sectionName, matchMode);
	const body = splitSectionBody(sourceLines, range);

	if (body.content.length === 0) {
		throw new OfficeFlowActionError(`Nothing to archive under "${range.name}".`);
	}

	const folder = plugin.settings.archiveFolder || DEFAULT_ARCHIVE_FOLDER;
	const stamp = moment();
	const fileName = buildArchiveFileName(plugin.settings, stamp);
	const targetPath = normalizePath(`${folder}/${fileName}.md`);
	const targetFile = await getOrCreateMarkdownFile(app, targetPath);
	const sourceLink = sourceFile.path.replace(/\.md$/i, '');
	const headingName = range.name;

	await app.vault.process(targetFile, (content) => {
		const lines = splitLines(content);
		const archiveHeading = pickArchiveHeadingName(lines, headingName, stamp);
		const block = [
			`## ${archiveHeading}`,
			'```office-progress',
			archiveHeading,
			`restore: [[${sourceLink}]] : ${headingName}`,
			'```',
			...body.content,
		];
		return joinLines(appendBlock(lines, block));
	});

	await app.vault.process(sourceFile, (content) => {
		const lines = splitLines(content);
		const currentRange = findUniqueHeadingRange(lines, sectionName, matchMode);
		const currentBody = splitSectionBody(lines, currentRange);
		return joinLines([
			...lines.slice(0, currentRange.startLine + 1),
			...currentBody.kept,
			...ensureLeadingBlankLine(lines.slice(currentRange.endLineExclusive)),
		]);
	});

	return `Archived ${describeTaskCount(body.content)} from "${headingName}" to ${targetPath}.`;
}

async function restoreSection(
	plugin: OfficeFlowPlugin,
	archivePath: string,
	sectionName: string,
	matchMode: SectionMatchMode,
	target: ProgressTarget,
): Promise<string> {
	const app = plugin.app;
	const archiveFile = getMarkdownFile(app, archivePath);
	const archiveLines = splitLines(await app.vault.read(archiveFile));
	const range = findUniqueHeadingRange(archiveLines, sectionName, matchMode);
	const body = splitSectionBody(archiveLines, range);

	if (body.content.length === 0) {
		throw new OfficeFlowActionError(`Nothing to restore under "${range.name}".`);
	}

	const noteName = target.noteName ?? '';
	const sourceFile = app.metadataCache.getFirstLinkpathDest(noteName, archivePath);

	if (!sourceFile) {
		throw new OfficeFlowActionError(`Note "${noteName}" was not found.`);
	}

	await app.vault.process(sourceFile, (content) => {
		const lines = splitLines(content);
		const sourceRange = findUniqueHeadingRange(lines, target.sectionName, target.matchMode);
		return joinLines(insertAtSectionEnd(lines, sourceRange, body.content));
	});

	await app.vault.process(archiveFile, (content) => {
		const lines = splitLines(content);
		const currentRange = findUniqueHeadingRange(lines, sectionName, matchMode);
		return joinLines(removeLineRange(lines, currentRange.startLine, currentRange.endLineExclusive));
	});

	return `Restored ${describeTaskCount(body.content)} to ${sourceFile.path} under "${target.sectionName}".`;
}

function getMarkdownFile(app: App, path: string): TFile {
	const file = app.vault.getAbstractFileByPath(path);

	if (!(file instanceof TFile)) {
		throw new OfficeFlowActionError(`Note "${path}" was not found.`);
	}

	return file;
}

async function getOrCreateMarkdownFile(app: App, path: string): Promise<TFile> {
	const existing = app.vault.getAbstractFileByPath(path);

	if (existing instanceof TFile) {
		return existing;
	}

	if (existing) {
		throw new OfficeFlowActionError(`"${path}" exists but is not a file.`);
	}

	const slash = path.lastIndexOf('/');
	await ensureFolder(app, slash === -1 ? '' : path.slice(0, slash));

	return app.vault.create(path, '');
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
	if (!folderPath) {
		return;
	}

	let current = '';

	for (const segment of folderPath.split('/')) {
		if (!segment) {
			continue;
		}

		current = current ? `${current}/${segment}` : segment;
		const existing = app.vault.getAbstractFileByPath(current);

		if (existing instanceof TFolder) {
			continue;
		}

		if (existing) {
			throw new OfficeFlowActionError(`"${current}" exists but is not a folder.`);
		}

		await app.vault.createFolder(current);
	}
}

/** Exact heading name wins; a prefix or contains pattern then falls back to the card's own matches. Must be unique. */
function findUniqueHeadingRange(
	lines: string[],
	sectionName: string,
	matchMode: SectionMatchMode,
): HeadingRange {
	const headings = findHeadings(lines);
	const exact = findMatchingHeadingRanges(headings, sectionName, 'exact');
	const matches = exact.length > 0 ? exact : findMatchingHeadingRanges(headings, sectionName, matchMode);
	const [match] = matches;

	if (!match) {
		throw new OfficeFlowActionError(`Heading "${sectionName}" was not found.`);
	}

	if (matches.length > 1) {
		throw new OfficeFlowActionError(
			`Heading "${sectionName}" matches ${matches.length} headings. Make it unique first.`,
		);
	}

	return match;
}

function splitSectionBody(lines: string[], range: HeadingRange): SectionBody {
	const kept: string[] = [];
	const content: string[] = [];
	let fence: 'progress' | 'other' | null = null;

	for (let index = range.startLine + 1; index < range.endLineExclusive; index++) {
		const line = lines[index] ?? '';

		if (fence === null) {
			if (isFenceLine(line)) {
				fence = OFFICE_PROGRESS_FENCE_LINE.test(line) ? 'progress' : 'other';
				(fence === 'progress' ? kept : content).push(line);
				continue;
			}

			content.push(line);
			continue;
		}

		(fence === 'progress' ? kept : content).push(line);

		if (isFenceLine(line)) {
			fence = null;
		}
	}

	return { kept, content: trimBlankLines(content) };
}

/** Only the date part goes through moment; the suffix is literal text. */
function buildArchiveFileName(settings: OfficeFlowSettings, stamp: moment.Moment): string {
	const datePart = stamp.format(settings.archiveDateFormat || DEFAULT_ARCHIVE_DATE_FORMAT);
	const suffix = normalizeFileSuffix(settings.archiveFileSuffix);
	return suffix ? `${datePart}_${suffix}` : datePart;
}

function pickArchiveHeadingName(
	lines: string[],
	sectionName: string,
	stamp: moment.Moment,
): string {
	const existing = findHeadings(lines).map((heading) => heading.name.toLowerCase());

	for (const format of ['HH:mm', 'HH:mm:ss', 'HH:mm:ss.SSS']) {
		const name = `${stamp.format(format)} ${sectionName}`;
		const lower = name.toLowerCase();

		if (!existing.some((heading) => heading.includes(lower))) {
			return name;
		}
	}

	return `${stamp.format('HH:mm:ss.SSS')} ${sectionName} ${Date.now()}`;
}

function appendBlock(lines: string[], block: string[]): string[] {
	const existing = trimTrailingBlankLines(lines);
	return existing.length > 0 ? [...existing, '', ...block, ''] : [...block, ''];
}

function insertAtSectionEnd(lines: string[], range: HeadingRange, content: string[]): string[] {
	let insertAt = range.startLine + 1;

	for (let index = range.endLineExclusive - 1; index > range.startLine; index--) {
		if ((lines[index] ?? '').trim() !== '') {
			insertAt = index + 1;
			break;
		}
	}

	return [
		...lines.slice(0, insertAt),
		...content,
		...ensureLeadingBlankLine(lines.slice(insertAt)),
	];
}

function removeLineRange(lines: string[], start: number, endExclusive: number): string[] {
	const before = trimTrailingBlankLines(lines.slice(0, start));
	const after = trimLeadingBlankLines(lines.slice(endExclusive));
	const merged = before.length > 0 && after.length > 0 ? [...before, '', ...after] : [...before, ...after];
	const trimmed = trimTrailingBlankLines(merged);
	return trimmed.length > 0 ? [...trimmed, ''] : [];
}

function ensureLeadingBlankLine(lines: string[]): string[] {
	const [first] = lines;
	return first !== undefined && first.trim() !== '' ? ['', ...lines] : lines;
}

function trimBlankLines(lines: string[]): string[] {
	return trimTrailingBlankLines(trimLeadingBlankLines(lines));
}

function trimLeadingBlankLines(lines: string[]): string[] {
	let start = 0;

	while (start < lines.length && (lines[start] ?? '').trim() === '') {
		start++;
	}

	return lines.slice(start);
}

function trimTrailingBlankLines(lines: string[]): string[] {
	let end = lines.length;

	while (end > 0 && (lines[end - 1] ?? '').trim() === '') {
		end--;
	}

	return lines.slice(0, end);
}

function describeTaskCount(lines: string[]): string {
	const count = lines.filter((line, index) => getTaskLineInfo(line, index) !== null).length;
	return `${count} task${count === 1 ? '' : 's'}`;
}

function splitLines(content: string): string[] {
	return content.split(/\r?\n/);
}

function joinLines(lines: string[]): string {
	return lines.join('\n');
}
