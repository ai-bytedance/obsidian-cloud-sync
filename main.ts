import { Plugin, Notice, TFile, TAbstractFile } from 'obsidian';
import { DEFAULT_SETTINGS, CloudSyncSettings, CloudSyncSettingTab } from './settings';
import { BaiduDriveService } from './services/baidu-drive';
import { AliDriveService } from './services/ali-drive';
import { JianguoyunDriveService } from './services/jianguoyun-drive';
import { GoogleDriveService } from './services/google-drive';
import { OneDriveService } from './services/onedrive';
import { ICloudDriveService } from './services/icloud-drive';
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
  jianguoyunDrive: JianguoyunDriveService;
  googleDrive: GoogleDriveService;
  oneDrive: OneDriveService;
  iCloudDrive: ICloudDriveService;
  encryption: EncryptionService;
  sync: SyncService;
  statusBarItem: HTMLElement;
  syncIntervalId: number;

  async onload() {
    console.log('加载云盘同步插件');

    // 加载设置
    await this.loadSettings();

    // 初始化加密服务
    this.encryption = new EncryptionService(this.settings.encryptionKey);

    // 初始化云盘服务
    this.baiduDrive = new BaiduDriveService(this.settings.baiduDrive);
    this.aliDrive = new AliDriveService(this.settings.aliDrive);
    this.jianguoyunDrive = new JianguoyunDriveService(this.settings.jianguoyunDrive);
    this.googleDrive = new GoogleDriveService(this.settings.googleDrive);
    this.oneDrive = new OneDriveService(this.settings.oneDrive);
    this.iCloudDrive = new ICloudDriveService(this.settings.iCloudDrive);

    // 初始化同步服务
    this.sync = new SyncService(this);

    // 添加设置选项卡
    this.addSettingTab(new CloudSyncSettingTab(this.app, this));

    // 添加状态栏 - 使用类型断言修复类型错误
    this.statusBarItem = this.addStatusBarItem() as HTMLElement;
    this.updateStatusBarText('云盘同步: 就绪');

    // 注册命令
    this.addCommand({
      id: 'sync-now',
      name: '立即同步',
      callback: async () => {
        await this.sync.syncAll();
      }
    });

    // 监听文件变化 - 修复参数顺序
    this.registerEvent(
      this.app.vault.on('create', (file: TAbstractFile) => {
        if (file instanceof TFile) {
          this.sync.queueFileForSync(file.path, 'create');
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('modify', (file: TAbstractFile) => {
        if (file instanceof TFile) {
          this.sync.queueFileForSync(file.path, 'modify');
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file: TAbstractFile) => {
        this.sync.queueFileForSync(file.path, 'delete');
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        this.sync.queueFileForSync(file.path, 'rename', oldPath);
      })
    );

    // 设置同步间隔
    this.setupSyncInterval();

    // 启动时同步
    if (this.settings.syncOnStartup) {
      setTimeout(async () => {
        await this.sync.syncAll();
      }, 5000); // 延迟 5 秒，等待 Obsidian 完全加载
    }
  }

  onunload() {
    console.log('卸载云盘同步插件');
    
    // 清除同步间隔
    if (this.syncIntervalId) {
      window.clearInterval(this.syncIntervalId);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  setupSyncInterval() {
    // 清除现有的同步间隔
    if (this.syncIntervalId) {
      window.clearInterval(this.syncIntervalId);
    }

    // 设置新的同步间隔
    if (this.settings.syncInterval > 0) {
      this.syncIntervalId = window.setInterval(async () => {
        await this.sync.syncAll();
      }, this.settings.syncInterval * 60 * 1000);
    }
  }

  updateStatusBarText(text: string) {
    if (this.statusBarItem) {
      this.statusBarItem.setText(text);
    }
  }

  // 检查文件是否应该同步
  shouldSyncFile(file: TFile): boolean {
    // 检查文件扩展名
    const excludeExtensions = this.settings.excludeExtensions.split(',').map(ext => ext.trim());
    for (const ext of excludeExtensions) {
      if (ext && file.path.endsWith(ext)) {
        return false;
      }
    }

    // 检查文件路径
    const excludePaths = this.settings.excludePaths.split(',').map(p => p.trim());
    for (const excludePath of excludePaths) {
      if (excludePath && file.path.startsWith(excludePath)) {
        return false;
      }
    }

    return true;
  }
} 