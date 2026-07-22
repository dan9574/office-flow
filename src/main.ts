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
} from 'obsidian';

const UNFINISHED_TASK_LINE = /^(\t?)- \[ \]/;
const EMPTY_TASK_LINE = /^(\t?- \[ \])\s*$/;
const PEN_NOTE_LINE = /^\s*🖊/;
const EMPTY_INSERTED_LINE = /^(?:\t?- \[ \] ?|\t?🖊 ?)$/;
const INSERTED_TOP_LEVEL_TASK_LINE = '- [ ] ';
const INSERTED_TASK_LINE = '\t- [ ] ';
const INSERTED_NOTE_LINE = '\t🖊';
const DEFAULT_CATEGORIES = ['操作', '研究', '设计', '代码'] as const;
const CATEGORY_COUNT = 4;
const PINK_SIDEBAR_STYLE_ID = 'office-flow-pink-sidebar-style';

interface OfficeFlowSettings {
	homeNote: string;
	enableTaskEditMode: boolean;
	enableCategoryPicker: boolean;
	enableHomeButton: boolean;
	enableOfficeProgressBlocks: boolean;
	enablePinkSidebar: boolean;
	categories: string[];
}

const DEFAULT_SETTINGS: OfficeFlowSettings = {
	homeNote: 'Home',
	enableTaskEditMode: true,
	enableCategoryPicker: true,
	enableHomeButton: true,
	enableOfficeProgressBlocks: true,
	enablePinkSidebar: true,
	categories: [...DEFAULT_CATEGORIES],
};

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

		this.addCommand({
			id: 'open-home-note',
			name: 'Open Home note',
			callback: () => {
				void this.openHomeNote();
			},
		});

		this.registerMarkdownCodeBlockProcessor('office-progress', (source, el, ctx) => {
			if (!this.settings.enableOfficeProgressBlocks) {
				el.empty();
				return;
			}

			void renderOfficeProgressBlock(this.app, source, el, ctx.sourcePath);
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
		this.removePinkSidebarStyle();
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<OfficeFlowSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		this.settings.homeNote = normalizeHomeNote(this.settings.homeNote);
		this.settings.categories = normalizeCategories(this.settings.categories);
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

	applyPinkSidebarSetting(): void {
		if (this.settings.enablePinkSidebar) {
			this.injectPinkSidebarStyle();
			return;
		}

		this.removePinkSidebarStyle();
	}

	private injectPinkSidebarStyle(): void {
		document.getElementById(PINK_SIDEBAR_STYLE_ID)?.remove();

		const pink = '#ffe6f2';
		const pinkAlt = '#ffd6ec';
		const divider = '#f9cbe0';
		const css = `
			.workspace-split.mod-left-split,
			.workspace-sidebar-container.mod-left,
			.is-left .workspace-tabs { background: ${pink} !important; }

			.workspace-ribbon.mod-left { background: ${pinkAlt} !important; }

			.workspace-split.mod-right-split,
			.workspace-sidebar-container.mod-right,
			.is-right .workspace-tabs { background: ${pink} !important; }

			.workspace-ribbon.mod-right { background: ${pinkAlt} !important; }

			.workspace-split.mod-horizontal .workspace-leaf:nth-child(1) .workspace-leaf-content { background: ${pink} !important; }
			.workspace-split.mod-horizontal .workspace-leaf:nth-child(3) .workspace-leaf-content { background: ${pink} !important; }

			.workspace-leaf-resize-handle { background: ${divider} !important; }

			.workspace-split.mod-left-split .view-content,
			.workspace-split.mod-right-split .view-content { background: ${pink} !important; }
		`;

		const styleEl = document.createElement('style');
		styleEl.id = PINK_SIDEBAR_STYLE_ID;
		styleEl.textContent = css;
		document.head.appendChild(styleEl);
	}

	private removePinkSidebarStyle(): void {
		document.getElementById(PINK_SIDEBAR_STYLE_ID)?.remove();
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

	private addHomeActionToActiveMarkdownView(): void {
		if (!this.settings.enableHomeButton) {
			return;
		}

		const leaf = this.app.workspace.activeLeaf;
		const view = leaf?.view;

		if (!(view instanceof MarkdownView)) {
			return;
		}

		const viewWithHomeAction = view as MarkdownView & {
			officeFlowHomeActionEl?: HTMLElement;
		};

		if (viewWithHomeAction.officeFlowHomeActionEl?.isConnected) {
			return;
		}

		const actionEl = view.addAction('home', 'Open Home note', () => {
			void this.openHomeNote();
		});
		actionEl.addClass('office-flow-home-action');
		viewWithHomeAction.officeFlowHomeActionEl = actionEl;
	}

	private removeHomeActions(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;

			if (!(view instanceof MarkdownView)) {
				return;
			}

			const viewWithHomeAction = view as MarkdownView & {
				officeFlowHomeActionEl?: HTMLElement;
			};

			viewWithHomeAction.officeFlowHomeActionEl?.remove();
			viewWithHomeAction.officeFlowHomeActionEl = undefined;
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

		new Setting(containerEl).setName('Features').setHeading();

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
		const wrapper = document.createElement('span');
		wrapper.className = 'office-flow-task-actions';
		wrapper.setAttribute('aria-label', 'Office Flow task actions');

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
	const picker = document.createElement('span');
	picker.className = 'office-flow-task-category-picker';

	const trigger = createTaskActionButton('', 'Choose task category', () => undefined);
	trigger.addClass('office-flow-task-category-trigger');
	trigger.setAttribute('aria-expanded', 'false');
	trigger.createSpan({ cls: 'office-flow-task-category-icon' });
	picker.append(trigger);

	const options = document.createElement('span');
	options.className = 'office-flow-task-category-options';
	options.setAttribute('aria-label', 'Task categories');

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
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'office-flow-task-action-button';
	button.textContent = text;
	button.setAttribute('aria-label', label);

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

interface ProgressTarget {
	noteName: string | null;
	noteDisplayName: string | null;
	sectionName: string;
	displayName: string;
}

interface ProgressCardData extends ProgressCounts {
	sectionName: string;
	targetSectionName: string;
	noteName: string | null;
	noteDisplayName: string | null;
	percent: number;
	found: boolean;
	sourceFound: boolean;
}

async function renderOfficeProgressBlock(
	app: App,
	source: string,
	containerEl: HTMLElement,
	sourcePath: string,
): Promise<void> {
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

	renderProgressCards(app, containerEl, cards, sourcePath);
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
		const target = parseProgressTarget(line);

		if (!target) {
			continue;
		}

		const key = `${target.noteName ?? 'current'}::${target.sectionName}`.toLowerCase();

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		targets.push(target);
	}

	return targets;
}

function parseProgressTarget(line: string): ProgressTarget | null {
	const trimmedLine = line.trim();

	if (!trimmedLine) {
		return null;
	}

	const wikiNoteMatch = /^\[\[([^\]]+)\]\]\s*:\s*(.+)$/.exec(trimmedLine);
	const singleNoteMatch = /^\[([^\]]+)\]\s*:\s*(.+)$/.exec(trimmedLine);
	const crossNoteMatch = wikiNoteMatch ?? singleNoteMatch;

	if (!crossNoteMatch) {
		return {
			noteName: null,
			noteDisplayName: null,
			sectionName: trimmedLine,
			displayName: trimmedLine,
		};
	}

	const bracketTarget = wikiNoteMatch ? `[[${crossNoteMatch[1]?.trim() ?? ''}]]` : crossNoteMatch[1]?.trim();
	const sectionName = crossNoteMatch[2]?.trim();

	if (!bracketTarget || !sectionName) {
		return null;
	}

	const { noteName, noteDisplayName } = parseProgressNoteTarget(bracketTarget);

	if (!noteName) {
		return null;
	}

	return {
		noteName,
		noteDisplayName,
		sectionName,
		displayName: `${noteDisplayName} : ${sectionName}`,
	};
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
			noteName: target.noteName,
			noteDisplayName: target.noteDisplayName,
			completed: 0,
			total: 0,
			percent: 0,
			found: false,
			sourceFound,
		};
	}

	const lines = markdown.split(/\r?\n/);
	const headings = findHeadings(lines);
	const ranges = findMatchingHeadingRanges(headings, target.sectionName);
	const counts = countLeafTasksInRanges(lines, ranges);
	const percent = counts.total === 0 ? 0 : Math.round((counts.completed / counts.total) * 100);

	return {
		sectionName: target.displayName,
		targetSectionName: target.sectionName,
		noteName: target.noteName,
		noteDisplayName: target.noteDisplayName,
		completed: counts.completed,
		total: counts.total,
		percent,
		found: ranges.length > 0,
		sourceFound,
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
): HeadingRange[] {
	const needle = sectionName.toLowerCase();
	return headings.filter((heading) => heading.name.toLowerCase().includes(needle));
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

function renderProgressCards(
	app: App,
	containerEl: HTMLElement,
	cards: ProgressCardData[],
	sourcePath: string,
): void {
	const wrapper = containerEl.createDiv({ cls: 'office-flow-progress' });

	for (const card of cards) {
		const cardEl = wrapper.createDiv({
			cls: `office-flow-progress-card${card.total === 0 ? ' office-flow-progress-card-empty' : ''}`,
		});
		const headerEl = cardEl.createDiv({ cls: 'office-flow-progress-card-header' });
		const titleEl = headerEl.createDiv({ cls: 'office-flow-progress-title' });
		renderProgressTitle(app, titleEl, card, sourcePath);
		headerEl.createDiv({ cls: 'office-flow-progress-percent', text: `${card.percent}%` });

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
		fillEl.style.width = `${card.percent}%`;
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
