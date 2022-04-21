// noinspection TypeScriptUMDGlobal

import {App, EventRef, MarkdownView, Plugin, PluginSettingTab, Setting} from 'obsidian';
import {exec} from "child_process";
import {promisify} from "util";

declare const CodeMirror: any

interface VimIMSwitchSettings {
    defaultIM: string;
    enable: boolean;
    obtainIMCmd: string;
    switchIMCmd: string;
}

const DEFAULT_SETTINGS: VimIMSwitchSettings = {
    defaultIM: '',
    enable: false,
    obtainIMCmd: '/path/to/IMCmd',
    switchIMCmd: '/path/to/IMCmd {im}',
}

const pexec = promisify(exec);

interface ExecOut {
    stdout: string,
    stderr: string
}

class IMStatusManager {
    // insert to normal, set insertIm to current system IM, set system IM to defaultIm
    // normal to insert, set system IM to insertIm
    setting: VimIMSwitchSettings;
    insertModeLastIM: string;

    constructor(setting: VimIMSwitchSettings) {
        this.setting = setting;
        // check
    }

    switchIM(im: string): Promise<ExecOut> {
        return pexec(this.setting.switchIMCmd.replace("{im}", im));
    }

    public normalToInsert(): Promise<ExecOut> {
        if (this.insertModeLastIM) {
            return this.switchIM(this.insertModeLastIM);
        }
        return new Promise<ExecOut>(resolve => resolve({stdout: '', stderr: ''}));
    }

    public insertToNormal(): Promise<ExecOut> {
        return pexec(this.setting.obtainIMCmd).then(out => {
            this.insertModeLastIM = out.stdout.trim();
            if (this.setting.defaultIM) {
                return this.switchIM(this.setting.defaultIM);
            } else {
                return new Promise<ExecOut>(resolve => {
                    resolve({stdout: '', stderr: 'default IM is null'});
                });
            }
        })
    }
}

export default class VimIMSwitchPlugin extends Plugin {
    static once: boolean = true;
    settings: VimIMSwitchSettings;
    private editors: Set<CodeMirror.Editor> = new Set<CodeMirror.Editor>();
    private codeMirrorVimObject: any = null;
    private manager: IMStatusManager;
    private editorMode: 'cm5' | 'cm6' = null;
    private initialized: boolean = false;
    private eventRef: EventRef;

    async onload() {
        console.log('loading plugin VimIMSwitchPlugin.');

        await this.loadSettings();

        this.addSettingTab(new IMSwitchSettingTab(this.app, this));

        this.initialize();
        console.log(this)

        this.viewBind({});
        if (this.editorMode === 'cm5') {
            this.registerCodeMirror(cm => cm.on('vim-mode-change', this.onVimModeChange));
        } else {
            this.eventRef = this.app.workspace.on('file-open', this.viewBind);
            this.registerEvent(this.eventRef);
        }
    }

    viewBind = (_: any) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            const cmEditor = this.getCodeMirror(view);
            if (cmEditor) {
                this.editors.add(cmEditor);
                cmEditor.on('vim-mode-change', this.onVimModeChange);
            }
        }
    }

    onVimModeChange = async (cm: any) => {
        // console.log("触发了")
        if (cm.mode == "normal" || cm.mode == "visual") {
            if (this.settings.enable) {
                this.normalizeOutput(await this.manager.insertToNormal());
            }
        } else if (cm.mode == "insert" || cm.mode == "replace") {
            if (this.settings.enable) {
                this.normalizeOutput(await this.manager.normalToInsert());
            }
        }
    }

    normalizeOutput(execOut: ExecOut): void {
        if (execOut.stdout) {
            console.log(execOut.stdout);
        }
        if (execOut.stderr) {
            console.error(execOut.stderr);
        }
    }

    onunload() {
        if (this.editorMode === 'cm5') {
            this.app.workspace.iterateCodeMirrors((cm: CodeMirror.Editor) => {
                cm.off("vim-mode-change", this.onVimModeChange);
            });
        } else {
            this.editors.forEach(cm => {
                cm.off("vim-mode-change", this.onVimModeChange);
            })
        }
        console.log('unloading plugin VimIMSwitchPlugin.');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private initialize() {
        if (this.initialized)
            return;

        this.manager = new IMStatusManager(this.settings);

        // refer: Vimrc and https://publish.obsidian.md/hub/04+-+Guides%2C+Workflows%2C+%26+Courses/Guides/How+to+update+your+plugins+and+CSS+for+live+preview
        // prefer using config to judge whether to use cm6 or cm5
        if ((this.app.vault as any).config?.legacyEditor && (this.app.vault as any)?.config) {
            this.codeMirrorVimObject = CodeMirror.Vim;
            this.editorMode = 'cm5';
            console.log('using CodeMirror 5 mode');
        } else {
            this.codeMirrorVimObject = (window as any).CodeMirrorAdapter?.Vim;
            this.editorMode = 'cm6';
            console.log('using CodeMirror 6 mode');
        }

        this.initialized = true;
    }

    private getCodeMirror(view: MarkdownView): CodeMirror.Editor {
        // For CM6 this actually returns an instance of the object named CodeMirror from cm_adapter of codemirror_vim
        if (this.editorMode == 'cm6') {
            // noinspection JSDeprecatedSymbols
            return (view as any).sourceMode?.cmEditor?.cm?.cm;
        } else
            // noinspection JSDeprecatedSymbols
            return (view as any).sourceMode?.cmEditor;
    }
}

class IMSwitchSettingTab extends PluginSettingTab {
    plugin: VimIMSwitchPlugin;

    constructor(app: App, plugin: VimIMSwitchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let {containerEl} = this;

        containerEl.empty();

        containerEl.createEl('h2', {text: 'Settings for Vim IM Switch plugin.'});

        new Setting(containerEl)
            .setName('Enable')
            .setDesc('Boolean denoting whether autoSwitchInputMethod is on/off.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enable)
                .onChange(async value => {
                    this.plugin.settings.enable = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Default IM')
            .setDesc('The default input method to switch to when entering normal mode.')
            .addText(text => text
                .setValue(this.plugin.settings.defaultIM)
                .setPlaceholder(DEFAULT_SETTINGS.defaultIM)
                .onChange(async value => {
                    this.plugin.settings.defaultIM = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Obtain IM CMD')
            .setDesc('The full path to command to retrieve the current input method key.')
            .addText(text => text
                .setValue(this.plugin.settings.obtainIMCmd)
                .setPlaceholder(DEFAULT_SETTINGS.obtainIMCmd)
                .onChange(async value => {
                    this.plugin.settings.obtainIMCmd = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Switch IM CMD')
            .setDesc('The full path to command to switch input method, with {im} a placeholder for input method key.')
            .addText(text => text
                .setValue(this.plugin.settings.switchIMCmd)
                .setPlaceholder(DEFAULT_SETTINGS.switchIMCmd)
                .onChange(async value => {
                    this.plugin.settings.switchIMCmd = value;
                    await this.plugin.saveSettings();
                }));
    }
}
