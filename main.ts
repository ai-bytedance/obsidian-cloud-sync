import { Plugin, Notice, TFile, TAbstractFile } from 'obsidian';
import { DEFAULT_SETTINGS, CloudSyncSettings, CloudSyncSettingTab } from './settings';
import { BaiduDriveService } from './services/baidu-drive';
import { AliDriveService } from './services/ali-drive';
import { EncryptionService } from './services/encryption';
import { SyncService } from './services/sync';

// 扩展 HTMLElement 类型，添加 Obsidian 特有的方法
declare global {
  interface HTMLElement {
    empty(): void;
    createSpan(options?: any): HTMLSpanElement;
  }
}

export default class CloudSyncPlugin extends Plugin {
  settings: CloudSyncSettings;
  baiduDrive: BaiduDriveService;
  aliDrive: AliDriveService;
  encryption: EncryptionService;
  syncService: SyncService;
  statusBarItem: HTMLElement;
  syncIntervalId: number;

  async onload() {
    await this.loadSettings();

    // 添加设置选项卡
    this.addSettingTab(new CloudSyncSettingTab(this.app, this));

    // 初始化加密服务
    this.encryption = new EncryptionService(this.settings.encryptionKey);

    // 初始化云盘服务
    this.baiduDrive = new BaiduDriveService(this.settings.baiduDrive);
    this.aliDrive = new AliDriveService(this.settings.aliDrive);

    // 添加状态栏 - 使用类型断言彻底修复类型错误
    this.statusBarItem = this.addStatusBarItem() as HTMLElement;
    
    // 使用 DOM API 更新状态栏文本
    this.updateStatusBarText('云盘同步: 准备就绪');

    // 初始化同步服务
    this.syncService = new SyncService(this);

    // 添加命令
    this.addCommand({
      id: 'sync-now',
      name: '立即同步',
      callback: () => {
        this.syncService.syncAll();
      }
    });

    // 启动时同步
    if (this.settings.syncOnStartup) {
      // 检查是否有云盘被启用
      if (this.settings.baiduDrive.enabled || this.settings.aliDrive.enabled) {
        // 延迟几秒再开始同步，避免在 Obsidian 启动时占用资源
        setTimeout(() => {
          this.syncService.syncAll();
        }, 5000);
      } else {
        // 只显示一次提示，引导用户配置云盘
        new Notice('云盘同步插件已加载，但未启用任何云盘。请在设置中配置云盘。', 10000);
      }
    }

    // 设置定时同步
    if (this.settings.syncInterval > 0) {
      this.syncIntervalId = window.setInterval(() => {
        // 检查是否有云盘被启用
        if (this.settings.baiduDrive.enabled || this.settings.aliDrive.enabled) {
          this.syncService.syncAll();
        }
      }, this.settings.syncInterval * 60 * 1000);
    }

    // 监听文件变化
    this.registerEvent(
      this.app.vault.on('create', (file) => this.handleFileChange('create', file))
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => this.handleFileChange('modify', file))
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => this.handleFileChange('delete', file))
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => this.handleFileRename(file, oldPath || ''))
    );

    // 减少启动时的通知，只在调试模式下显示
    console.log('云同步插件已加载');
  }

  // 更新状态栏文本的方法 - 使用标准 DOM API
  updateStatusBarText(text: string) {
    // 清空状态栏
    while (this.statusBarItem.firstChild) {
      this.statusBarItem.removeChild(this.statusBarItem.firstChild);
    }
    
    // 创建文本元素
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    this.statusBarItem.appendChild(textSpan);
  }

  onunload() {
    // 清除定时器
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
    }
    
    // 减少卸载时的通知，只在调试模式下显示
    console.log('云同步插件已卸载');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async handleFileChange(action: 'create' | 'modify' | 'delete', file: TAbstractFile) {
    if (!(file instanceof TFile)) {
      return;
    }
    
    if (action === 'delete' || this.shouldSyncFile(file)) {
      this.syncService.queueFileForSync(action, file);
    }
  }

  async handleFileRename(file: TAbstractFile, oldPath: string) {
    if (!(file instanceof TFile)) {
      return;
    }
    
    if (this.shouldSyncFile(file)) {
      this.syncService.queueFileForRename(file, oldPath);
    }
  }

  shouldSyncFile(file: TFile): boolean {
    // 检查文件扩展名 - 修复类型错误
    // 确保 settings 中有 excludeExtensions 属性
    if (this.settings.excludeExtensions && this.settings.excludeExtensions.includes(file.extension)) {
      return false;
    }
    
    // 检查排除规则
    if (this.settings.excludePatterns) {
      for (const pattern of this.settings.excludePatterns) {
        try {
          const regex = new RegExp(pattern);
          if (regex.test(file.path)) {
            return false;
          }
        } catch (e) {
          console.error(`无效的正则表达式: ${pattern}`, e);
        }
      }
    }
    
    return true;
  }
} 