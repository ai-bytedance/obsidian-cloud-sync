// 创建一个临时的类型声明文件，确保 TypeScript 能够识别 Obsidian API
declare module 'obsidian' {
  export class Plugin {
    app: App;
    manifest: PluginManifest;
    
    constructor(app: App, manifest: PluginManifest);
    
    onload(): void;
    onunload(): void;
    
    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement;
    addStatusBarItem(): HTMLElement;
    addCommand(command: Command): void;
    addSettingTab(tab: PluginSettingTab): void;
    registerEvent(event: any): void;
    loadData(): Promise<any>;
    saveData(data: any): Promise<void>;
  }
  
  export class PluginSettingTab {
    app: App;
    plugin: Plugin;
    containerEl: HTMLElement;
    
    constructor(app: App, plugin: Plugin);
    
    display(): void;
    hide(): void;
  }
  
  export class App {
    vault: Vault;
  }
  
  export class Vault {
    on(name: string, callback: (file: TAbstractFile, oldPath?: string) => any): EventRef;
    getFiles(): TFile[];
    readBinary(file: TFile): Promise<ArrayBuffer>;
  }
  
  export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    minAppVersion: string;
    description: string;
    author: string;
    authorUrl: string;
    isDesktopOnly: boolean;
  }
  
  export interface Command {
    id: string;
    name: string;
    callback?: () => any;
    checkCallback?: (checking: boolean) => boolean | void;
    hotkeys?: Hotkey[];
  }
  
  export interface Hotkey {
    modifiers: string[];
    key: string;
  }
  
  export interface TAbstractFile {
    path: string;
    name: string;
    vault: Vault;
  }
  
  export class TFile implements TAbstractFile {
    path: string;
    name: string;
    vault: Vault;
    stat: any;
    extension: string;
    basename: string;
  }
  
  export class TFolder implements TAbstractFile {
    path: string;
    name: string;
    vault: Vault;
    children: TAbstractFile[];
  }
  
  export interface EventRef {}
  
  export class Setting {
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(desc: string): this;
    addText(cb: (text: TextComponent) => any): this;
    addTextArea(cb: (text: TextAreaComponent) => any): this;
    addToggle(cb: (toggle: ToggleComponent) => any): this;
    addButton(cb: (button: ButtonComponent) => any): this;
    addSlider(cb: (slider: SliderComponent) => any): this;
  }
  
  export class TextComponent {
    setValue(value: string): this;
    getValue(): string;
    onChange(callback: (value: string) => any): this;
    setPlaceholder(placeholder: string): this;
  }
  
  export class TextAreaComponent {
    setValue(value: string): this;
    getValue(): string;
    onChange(callback: (value: string) => any): this;
    setPlaceholder(placeholder: string): this;
  }
  
  export class ToggleComponent {
    setValue(value: boolean): this;
    getValue(): boolean;
    onChange(callback: (value: boolean) => any): this;
  }
  
  export class ButtonComponent {
    setButtonText(text: string): this;
    onClick(callback: () => any): this;
  }
  
  export class SliderComponent {
    setValue(value: number): this;
    getValue(): number;
    onChange(callback: (value: number) => any): this;
    setLimits(min: number, max: number, step: number): this;
    setDynamicTooltip(): this;
  }
  
  export class Notice {
    constructor(message: string, timeout?: number);
  }
  
  export interface RequestUrlParam {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    contentType?: string;
    body?: string | ArrayBuffer | FormData;
  }
  
  export interface RequestUrlResponse {
    status: number;
    headers: Record<string, string>;
    arrayBuffer: ArrayBuffer;
    json: any;
    text: string;
  }
  
  export function requestUrl(params: RequestUrlParam): Promise<RequestUrlResponse>;
  
  // 扩展 HTMLElement 接口，添加 Obsidian 特有的方法
  interface HTMLElement {
    empty(): void;
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>, text?: string): HTMLElementTagNameMap[K];
    createEl(tag: string, attrs?: Record<string, string>, text?: string): HTMLElement;
    textContent: string;
  }
} 