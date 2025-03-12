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

// 百度网盘设置
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

// 阿里云盘设置
export interface AliDriveSettings {
  enabled: boolean;
  appKey: string;
  appSecret: string;
  accessToken: string;
  refreshToken: string;
  syncFolder: string;
}

// 坚果云设置
export interface JianguoyunDriveSettings {
  enabled: boolean;
  username: string;
  password: string;
  syncFolder: string;
}

// Google Drive设置
export interface GoogleDriveSettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  syncFolder: string;
}

// OneDrive 设置
export interface OneDriveSettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  syncFolder: string;
}

// iCloud 设置
export interface ICloudDriveSettings {
  enabled: boolean;
  apiToken: string;
  keyId: string;
  container: string;
  environment: string;
  syncFolder: string;
}

// 插件设置
export interface CloudSyncSettings {
  encryptionKey: string;
  syncOnStartup: boolean;
  syncInterval: number;
  excludeExtensions: string;
  excludePaths: string;
  baiduDrive: BaiduDriveSettings;
  aliDrive: AliDriveSettings;
  jianguoyunDrive: JianguoyunDriveSettings;
  googleDrive: GoogleDriveSettings;
  oneDrive: OneDriveSettings;
  iCloudDrive: ICloudDriveSettings;
}

// 默认设置
export const DEFAULT_SETTINGS: CloudSyncSettings = {
  encryptionKey: '',
  syncOnStartup: true,
  syncInterval: 5,
  excludeExtensions: '.DS_Store,Thumbs.db',
  excludePaths: '.git/,.obsidian/',
  baiduDrive: {
    enabled: false,
    appKey: '',
    appSecret: '',
    redirectUri: 'https://obsidian.md/callback',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    syncFolder: '/obsidian/'
  },
  aliDrive: {
    enabled: false,
    appKey: '',
    appSecret: '',
    accessToken: '',
    refreshToken: '',
    syncFolder: '/obsidian/'
  },
  jianguoyunDrive: {
    enabled: false,
    username: '',
    password: '',
    syncFolder: '/obsidian/'
  },
  googleDrive: {
    enabled: false,
    clientId: '',
    clientSecret: '',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    syncFolder: '/obsidian/'
  },
  oneDrive: {
    enabled: false,
    clientId: '',
    clientSecret: '',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    syncFolder: '/obsidian/'
  },
  iCloudDrive: {
    enabled: false,
    apiToken: '',
    keyId: '',
    container: 'com.obsidian.cloudsync',
    environment: 'production',
    syncFolder: '/obsidian/'
  }
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

    // 通用设置
    containerEl.createEl('h3', { text: '通用设置' });

    // 加密密钥
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

    // 启动时同步
    new Setting(containerEl)
      .setName('启动时同步')
      .setDesc('Obsidian 启动时自动同步')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.syncOnStartup = value;
          await this.plugin.saveSettings();
        }));

    // 同步间隔
    new Setting(containerEl)
      .setName('同步间隔（分钟）')
      .setDesc('自动同步的时间间隔，设为 0 禁用自动同步')
      .addText(text => text
        .setPlaceholder('5')
        .setValue(String(this.plugin.settings.syncInterval))
        .onChange(async (value) => {
          const interval = parseInt(value);
          if (!isNaN(interval) && interval >= 0) {
            this.plugin.settings.syncInterval = interval;
            await this.plugin.saveSettings();
            this.plugin.setupSyncInterval();
          }
        }));

    // 排除文件扩展名
    new Setting(containerEl)
      .setName('排除文件扩展名')
      .setDesc('不同步的文件扩展名，用逗号分隔')
      .addText(text => text
        .setPlaceholder('.DS_Store,Thumbs.db')
        .setValue(this.plugin.settings.excludeExtensions)
        .onChange(async (value) => {
          this.plugin.settings.excludeExtensions = value;
          await this.plugin.saveSettings();
        }));

    // 排除路径
    new Setting(containerEl)
      .setName('排除路径')
      .setDesc('不同步的路径，用逗号分隔')
      .addText(text => text
        .setPlaceholder('.git/,.obsidian/')
        .setValue(this.plugin.settings.excludePaths)
        .onChange(async (value) => {
          this.plugin.settings.excludePaths = value;
          await this.plugin.saveSettings();
        }));

    // 百度网盘设置
    containerEl.createEl('h3', { text: '百度网盘设置' });

    // 启用百度网盘
    new Setting(containerEl)
      .setName('启用百度网盘')
      .setDesc('开启/关闭百度网盘同步')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.baiduDrive.enabled)
        .onChange(async (value) => {
          this.plugin.settings.baiduDrive.enabled = value;
          await this.plugin.saveSettings();
        }));

    // App Key
    new Setting(containerEl)
      .setName('App Key')
      .setDesc('百度网盘应用的 App Key')
      .addText(text => text
        .setPlaceholder('输入 App Key')
        .setValue(this.plugin.settings.baiduDrive.appKey)
        .onChange(async (value) => {
          this.plugin.settings.baiduDrive.appKey = value;
          await this.plugin.saveSettings();
        }));

    // App Secret
    new Setting(containerEl)
      .setName('App Secret')
      .setDesc('百度网盘应用的 App Secret')
      .addText(text => text
        .setPlaceholder('输入 App Secret')
        .setValue(this.plugin.settings.baiduDrive.appSecret)
        .onChange(async (value) => {
          this.plugin.settings.baiduDrive.appSecret = value;
          await this.plugin.saveSettings();
        }));

    // 同步文件夹
    new Setting(containerEl)
      .setName('同步文件夹')
      .setDesc('百度网盘中的同步目录路径')
      .addText(text => text
        .setPlaceholder('/obsidian/')
        .setValue(this.plugin.settings.baiduDrive.syncFolder)
        .onChange(async (value) => {
          // 确保路径以 / 开头和结尾
          if (!value.startsWith('/')) value = '/' + value;
          if (!value.endsWith('/')) value = value + '/';
          
          this.plugin.settings.baiduDrive.syncFolder = value;
          await this.plugin.saveSettings();
        }));

    // 授权按钮
    new Setting(containerEl)
      .setName('百度网盘授权')
      .setDesc('点击授权访问百度网盘')
      .addButton(button => button
        .setButtonText('授权')
        .onClick(async () => {
          await this.plugin.baiduDrive.authorize();
        }));

    // 阿里云盘设置
    containerEl.createEl('h3', { text: '阿里云盘设置' });

    // 启用阿里云盘
    new Setting(containerEl)
      .setName('启用阿里云盘')
      .setDesc('开启/关闭阿里云盘同步')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.aliDrive.enabled)
        .onChange(async (value) => {
          this.plugin.settings.aliDrive.enabled = value;
          await this.plugin.saveSettings();
        }));

    // App Key
    new Setting(containerEl)
      .setName('App Key')
      .setDesc('阿里云盘应用的 App Key')
      .addText(text => text
        .setPlaceholder('输入 App Key')
        .setValue(this.plugin.settings.aliDrive.appKey)
        .onChange(async (value) => {
          this.plugin.settings.aliDrive.appKey = value;
          await this.plugin.saveSettings();
        }));

    // App Secret
    new Setting(containerEl)
      .setName('App Secret')
      .setDesc('阿里云盘应用的 App Secret')
      .addText(text => text
        .setPlaceholder('输入 App Secret')
        .setValue(this.plugin.settings.aliDrive.appSecret)
        .onChange(async (value) => {
          this.plugin.settings.aliDrive.appSecret = value;
          await this.plugin.saveSettings();
        }));

    // 同步文件夹
    new Setting(containerEl)
      .setName('同步文件夹')
      .setDesc('阿里云盘中的同步目录路径')
      .addText(text => text
        .setPlaceholder('/obsidian/')
        .setValue(this.plugin.settings.aliDrive.syncFolder)
        .onChange(async (value) => {
          // 确保路径以 / 开头和结尾
          if (!value.startsWith('/')) value = '/' + value;
          if (!value.endsWith('/')) value = value + '/';
          
          this.plugin.settings.aliDrive.syncFolder = value;
          await this.plugin.saveSettings();
        }));

    // 授权按钮
    new Setting(containerEl)
      .setName('阿里云盘授权')
      .setDesc('点击授权访问阿里云盘')
      .addButton(button => button
        .setButtonText('授权')
        .onClick(async () => {
          await this.plugin.aliDrive.authorize();
        }));

    // 坚果云设置
    containerEl.createEl('h3', { text: '坚果云设置' });

    // 启用坚果云
    new Setting(containerEl)
      .setName('启用坚果云')
      .setDesc('开启/关闭坚果云同步')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.jianguoyunDrive.enabled)
        .onChange(async (value) => {
          this.plugin.settings.jianguoyunDrive.enabled = value;
          await this.plugin.saveSettings();
        }));

    // 用户名
    new Setting(containerEl)
      .setName('用户名')
      .setDesc('坚果云账号用户名')
      .addText(text => text
        .setPlaceholder('输入用户名')
        .setValue(this.plugin.settings.jianguoyunDrive.username)
        .onChange(async (value) => {
          this.plugin.settings.jianguoyunDrive.username = value;
          await this.plugin.saveSettings();
        }));

    // 密码
    new Setting(containerEl)
      .setName('密码')
      .setDesc('坚果云账号密码')
      .addText(text => text
        .setPlaceholder('输入密码')
        .setValue(this.plugin.settings.jianguoyunDrive.password)
        .onChange(async (value) => {
          this.plugin.settings.jianguoyunDrive.password = value;
          await this.plugin.saveSettings();
        }));

    // 同步文件夹
    new Setting(containerEl)
      .setName('同步文件夹')
      .setDesc('坚果云中的同步目录路径')
      .addText(text => text
        .setPlaceholder('/obsidian/')
        .setValue(this.plugin.settings.jianguoyunDrive.syncFolder)
        .onChange(async (value) => {
          // 确保路径以 / 开头和结尾
          if (!value.startsWith('/')) value = '/' + value;
          if (!value.endsWith('/')) value = value + '/';
          
          this.plugin.settings.jianguoyunDrive.syncFolder = value;
          await this.plugin.saveSettings();
        }));

    // 授权按钮
    new Setting(containerEl)
      .setName('坚果云授权')
      .setDesc('点击验证坚果云账号')
      .addButton(button => button
        .setButtonText('验证')
        .onClick(async () => {
          await this.plugin.jianguoyunDrive.authorize();
        }));

    // Google Drive设置
    containerEl.createEl('h3', { text: 'Google Drive设置' });

    // 启用Google Drive
    new Setting(containerEl)
      .setName('启用Google Drive')
      .setDesc('开启/关闭Google Drive同步')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.googleDrive.enabled)
        .onChange(async (value) => {
          this.plugin.settings.googleDrive.enabled = value;
          await this.plugin.saveSettings();
        }));

    // 客户端 ID
    new Setting(containerEl)
      .setName('客户端 ID')
      .setDesc('Google Drive应用的客户端 ID')
      .addText(text => text
        .setPlaceholder('输入客户端 ID')
        .setValue(this.plugin.settings.googleDrive.clientId)
        .onChange(async (value) => {
          this.plugin.settings.googleDrive.clientId = value;
          await this.plugin.saveSettings();
        }));

    // 客户端密钥
    new Setting(containerEl)
      .setName('客户端密钥')
      .setDesc('Google Drive应用的客户端密钥')
      .addText(text => text
        .setPlaceholder('输入客户端密钥')
        .setValue(this.plugin.settings.googleDrive.clientSecret)
        .onChange(async (value) => {
          this.plugin.settings.googleDrive.clientSecret = value;
          await this.plugin.saveSettings();
        }));

    // 同步文件夹
    new Setting(containerEl)
      .setName('同步文件夹')
      .setDesc('Google Drive中的同步目录路径')
      .addText(text => text
        .setPlaceholder('/obsidian/')
        .setValue(this.plugin.settings.googleDrive.syncFolder)
        .onChange(async (value) => {
          // 确保路径以 / 开头和结尾
          if (!value.startsWith('/')) value = '/' + value;
          if (!value.endsWith('/')) value = value + '/';
          
          this.plugin.settings.googleDrive.syncFolder = value;
          await this.plugin.saveSettings();
        }));

    // 授权按钮
    new Setting(containerEl)
      .setName('Google Drive授权')
      .setDesc('点击授权访问Google Drive')
      .addButton(button => button
        .setButtonText('授权')
        .onClick(async () => {
          await this.plugin.googleDrive.authorize();
        }));

    // OneDrive 设置
    containerEl.createEl('h3', { text: 'OneDrive 设置' });

    // 启用 OneDrive
    new Setting(containerEl)
      .setName('启用 OneDrive')
      .setDesc('开启/关闭 OneDrive 同步')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.oneDrive.enabled)
        .onChange(async (value) => {
          this.plugin.settings.oneDrive.enabled = value;
          await this.plugin.saveSettings();
        }));

    // 客户端 ID
    new Setting(containerEl)
      .setName('客户端 ID')
      .setDesc('OneDrive 应用的客户端 ID')
      .addText(text => text
        .setPlaceholder('输入客户端 ID')
        .setValue(this.plugin.settings.oneDrive.clientId)
        .onChange(async (value) => {
          this.plugin.settings.oneDrive.clientId = value;
          await this.plugin.saveSettings();
        }));

    // 客户端密钥
    new Setting(containerEl)
      .setName('客户端密钥')
      .setDesc('OneDrive 应用的客户端密钥')
      .addText(text => text
        .setPlaceholder('输入客户端密钥')
        .setValue(this.plugin.settings.oneDrive.clientSecret)
        .onChange(async (value) => {
          this.plugin.settings.oneDrive.clientSecret = value;
          await this.plugin.saveSettings();
        }));

    // 同步文件夹
    new Setting(containerEl)
      .setName('同步文件夹')
      .setDesc('OneDrive 中的同步目录路径')
      .addText(text => text
        .setPlaceholder('/obsidian/')
        .setValue(this.plugin.settings.oneDrive.syncFolder)
        .onChange(async (value) => {
          // 确保路径以 / 开头和结尾
          if (!value.startsWith('/')) value = '/' + value;
          if (!value.endsWith('/')) value = value + '/';
          
          this.plugin.settings.oneDrive.syncFolder = value;
          await this.plugin.saveSettings();
        }));

    // 授权按钮
    new Setting(containerEl)
      .setName('OneDrive 授权')
      .setDesc('点击授权访问 OneDrive')
      .addButton(button => button
        .setButtonText('授权')
        .onClick(async () => {
          await this.plugin.oneDrive.authorize();
        }));

    // iCloud 设置
    containerEl.createEl('h3', { text: 'iCloud 设置' });

    // 启用 iCloud
    new Setting(containerEl)
      .setName('启用 iCloud')
      .setDesc('开启/关闭 iCloud 同步')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.iCloudDrive.enabled)
        .onChange(async (value) => {
          this.plugin.settings.iCloudDrive.enabled = value;
          await this.plugin.saveSettings();
        }));

    // API Token
    new Setting(containerEl)
      .setName('API Token')
      .setDesc('iCloud API Token')
      .addText(text => text
        .setPlaceholder('输入 API Token')
        .setValue(this.plugin.settings.iCloudDrive.apiToken)
        .onChange(async (value) => {
          this.plugin.settings.iCloudDrive.apiToken = value;
          await this.plugin.saveSettings();
        }));

    // Key ID
    new Setting(containerEl)
      .setName('Key ID')
      .setDesc('iCloud Key ID')
      .addText(text => text
        .setPlaceholder('输入 Key ID')
        .setValue(this.plugin.settings.iCloudDrive.keyId)
        .onChange(async (value) => {
          this.plugin.settings.iCloudDrive.keyId = value;
          await this.plugin.saveSettings();
        }));

    // 同步文件夹
    new Setting(containerEl)
      .setName('同步文件夹')
      .setDesc('iCloud 中的同步目录路径')
      .addText(text => text
        .setPlaceholder('/obsidian/')
        .setValue(this.plugin.settings.iCloudDrive.syncFolder)
        .onChange(async (value) => {
          // 确保路径以 / 开头和结尾
          if (!value.startsWith('/')) value = '/' + value;
          if (!value.endsWith('/')) value = value + '/';
          
          this.plugin.settings.iCloudDrive.syncFolder = value;
          await this.plugin.saveSettings();
        }));

    // 授权按钮
    new Setting(containerEl)
      .setName('iCloud 授权')
      .setDesc('点击验证 iCloud 账号')
      .addButton(button => button
        .setButtonText('验证')
        .onClick(async () => {
          await this.plugin.iCloudDrive.authorize();
        }));

    // 同步按钮
    containerEl.createEl('h3', { text: '手动同步' });
    
    new Setting(containerEl)
      .setName('立即同步')
      .setDesc('手动触发同步')
      .addButton(button => button
        .setButtonText('同步')
        .onClick(async () => {
          await this.plugin.sync.syncAll();
        }));
  }
} 