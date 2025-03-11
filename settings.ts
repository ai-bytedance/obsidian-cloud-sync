import { App, PluginSettingTab, Setting } from 'obsidian';
import CloudSyncPlugin from './main';

// 扩展 HTMLElement 类型，添加 Obsidian 特有的方法
declare global {
  interface HTMLElement {
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: any): HTMLElementTagNameMap[K];
    addClass(className: string): this;
    setText(text: string): this;
    empty(): this;
  }
}

export interface BaiduDriveSettings {
  enabled: boolean;
  appKey: string;
  appSecret: string;
  redirectUri: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  syncFolder: string;
}

export interface AliDriveSettings {
  enabled: boolean;
  appKey: string;
  appSecret: string;
  redirectUri: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  syncFolder: string;
}

export interface CloudSyncSettings {
  syncOnStartup: boolean;
  syncInterval: number;
  encryptionKey: string;
  baiduDrive: BaiduDriveSettings;
  aliDrive: AliDriveSettings;
  excludeExtensions: string[];
  excludePatterns: string[];
}

export const DEFAULT_SETTINGS: CloudSyncSettings = {
  syncOnStartup: true,
  syncInterval: 30, // 分钟
  encryptionKey: '',
  baiduDrive: {
    enabled: false,
    appKey: '',
    appSecret: '',
    redirectUri: 'https://localhost:8080/callback',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    syncFolder: '/apps/cloud-sync/'
  },
  aliDrive: {
    enabled: false,
    appKey: '',
    appSecret: '',
    redirectUri: 'https://localhost:8080/callback',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    syncFolder: '/apps/cloud-sync/'
  },
  excludeExtensions: ['mp3', 'mp4', 'mov', 'avi', 'mkv', 'zip', 'rar', '7z', 'tar', 'gz'],
  excludePatterns: ['\\.obsidian', '\\.git', '\\.DS_Store']
};

export class CloudSyncSettingTab extends PluginSettingTab {
  plugin: CloudSyncPlugin;

  constructor(app: App, plugin: CloudSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '云盘同步设置' });

    // 添加醒目的提示，如果没有启用任何云盘
    if (!this.plugin.settings.baiduDrive.enabled && !this.plugin.settings.aliDrive.enabled) {
      // 创建警告容器
      const warningDiv = containerEl.createEl('div');
      warningDiv.addClass('cloud-sync-warning');
      warningDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
      warningDiv.style.padding = '10px';
      warningDiv.style.borderRadius = '5px';
      warningDiv.style.marginBottom = '15px';
      
      // 创建警告标题
      const warningTitle = warningDiv.createEl('h3');
      warningTitle.setText('⚠️ 警告：未启用任何云盘');
      warningTitle.addClass('cloud-sync-warning-title');
      warningTitle.style.color = 'red';
      
      // 创建警告文本
      const warningText = warningDiv.createEl('p');
      warningText.setText('请在下方配置并启用至少一个云盘，否则同步功能将无法使用。');
    }

    // 基本设置
    containerEl.createEl('h3', { text: '基本设置' });
    
    new Setting(containerEl)
      .setName('启动时同步')
      .setDesc('Obsidian 启动时自动同步所有文件')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.syncOnStartup = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('同步间隔（分钟）')
      .setDesc('设置为 0 禁用自动同步')
      .addText(text => text
        .setPlaceholder('30')
        .setValue(String(this.plugin.settings.syncInterval))
        .onChange(async (value) => {
          const interval = parseInt(value) || 0;
          this.plugin.settings.syncInterval = interval;
          await this.plugin.saveSettings();
          this.plugin.syncService.resetSyncInterval();
        }));
    
    new Setting(containerEl)
      .setName('加密密钥')
      .setDesc('用于 AES 加密您的文件内容，请妥善保管，丢失将无法恢复已加密文件')
      .addText(text => text
        .setPlaceholder('输入加密密钥')
        .setValue(this.plugin.settings.encryptionKey)
        .onChange(async (value) => {
          this.plugin.settings.encryptionKey = value;
          this.plugin.encryption.updateKey(value);
          await this.plugin.saveSettings();
        }));
    
    // 排除设置
    containerEl.createEl('h3', { text: '排除设置' });
    
    new Setting(containerEl)
      .setName('排除文件扩展名')
      .setDesc('不同步指定扩展名的文件（逗号分隔）')
      .addText(text => text
        .setPlaceholder('jpg,jpeg,png,gif')
        .setValue(this.plugin.settings.excludeExtensions.join(','))
        .onChange(async (value) => {
          this.plugin.settings.excludeExtensions = value.split(',').map(ext => ext.trim()).filter(ext => ext);
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('排除文件路径')
      .setDesc('不同步匹配正则表达式的文件路径（每行一个）')
      .addTextArea(textarea => textarea
        .setPlaceholder('\\.obsidian')
        .setValue(this.plugin.settings.excludePatterns.join('\n'))
        .onChange(async (value) => {
          this.plugin.settings.excludePatterns = value.split('\n').map(pattern => pattern.trim()).filter(pattern => pattern);
          await this.plugin.saveSettings();
        }));
    
    // 百度网盘设置
    containerEl.createEl('h3', { text: '百度网盘设置' });
    
    new Setting(containerEl)
      .setName('启用百度网盘')
      .setDesc('使用百度网盘同步文件')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.baiduDrive.enabled)
        .onChange(async (value) => {
          this.plugin.settings.baiduDrive.enabled = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('App Key')
      .setDesc('百度网盘开放平台应用的 App Key')
      .addText(text => text
        .setPlaceholder('输入 App Key')
        .setValue(this.plugin.settings.baiduDrive.appKey)
        .onChange(async (value) => {
          this.plugin.settings.baiduDrive.appKey = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('App Secret')
      .setDesc('百度网盘开放平台应用的 App Secret')
      .addText(text => text
        .setPlaceholder('输入 App Secret')
        .setValue(this.plugin.settings.baiduDrive.appSecret)
        .onChange(async (value) => {
          this.plugin.settings.baiduDrive.appSecret = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('同步文件夹')
      .setDesc('百度网盘中的同步文件夹路径')
      .addText(text => text
        .setPlaceholder('/apps/cloud-sync/')
        .setValue(this.plugin.settings.baiduDrive.syncFolder)
        .onChange(async (value) => {
          // 确保路径以 / 开头和结尾
          let path = value;
          if (!path.startsWith('/')) path = '/' + path;
          if (!path.endsWith('/')) path = path + '/';
          
          this.plugin.settings.baiduDrive.syncFolder = path;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('授权百度网盘')
      .setDesc('点击按钮授权访问百度网盘')
      .addButton(button => button
        .setButtonText('授权')
        .onClick(() => {
          this.plugin.baiduDrive.authorize();
        }));

    // 阿里云盘设置
    containerEl.createEl('h3', { text: '阿里云盘设置' });
    
    new Setting(containerEl)
      .setName('启用阿里云盘')
      .setDesc('使用阿里云盘同步文件')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.aliDrive.enabled)
        .onChange(async (value) => {
          this.plugin.settings.aliDrive.enabled = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('App Key')
      .setDesc('阿里云盘开放平台应用的 App Key')
      .addText(text => text
        .setPlaceholder('输入 App Key')
        .setValue(this.plugin.settings.aliDrive.appKey)
        .onChange(async (value) => {
          this.plugin.settings.aliDrive.appKey = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('App Secret')
      .setDesc('阿里云盘开放平台应用的 App Secret')
      .addText(text => text
        .setPlaceholder('输入 App Secret')
        .setValue(this.plugin.settings.aliDrive.appSecret)
        .onChange(async (value) => {
          this.plugin.settings.aliDrive.appSecret = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('同步文件夹')
      .setDesc('阿里云盘中的同步文件夹路径')
      .addText(text => text
        .setPlaceholder('/apps/cloud-sync/')
        .setValue(this.plugin.settings.aliDrive.syncFolder)
        .onChange(async (value) => {
          // 确保路径以 / 开头和结尾
          let path = value;
          if (!path.startsWith('/')) path = '/' + path;
          if (!path.endsWith('/')) path = path + '/';
          
          this.plugin.settings.aliDrive.syncFolder = path;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('授权阿里云盘')
      .setDesc('点击按钮授权访问阿里云盘')
      .addButton(button => button
        .setButtonText('授权')
        .onClick(() => {
          this.plugin.aliDrive.authorize();
        }));
  }
} 