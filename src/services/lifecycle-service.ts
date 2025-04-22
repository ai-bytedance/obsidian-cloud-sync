import { App } from 'obsidian';
import { CloudSyncSettingTab } from '@components/settings-tab';
import { NotificationManager } from '@services/notification/notification-manager';
import { PluginSettings, DEFAULT_SETTINGS, StorageProviderType } from '@models/plugin-settings';
import { SyncEngine } from '@src/core/sync-engine';
import { VaultFileManager } from '@src/core/vault-file-manager';
import { FileEventHandler } from '@src/core/file-event-handler';
import { AutoSyncManager } from '@src/core/auto-sync-manager';
import { ProviderManager } from '@src/core/provider-manager';
import { CacheManager } from '@src/core/cache-manager';
import { SyncManager } from '@src/core/sync-manager';
import { SettingsManager } from '@src/core/settings-manager';
import { AESCryptoService } from '@services/crypto/aes-crypto-service';
import { PluginService } from '@services/plugin-service';
import CloudSyncPlugin from '@main';

/**
 * 生命周期服务类
 * 负责管理插件的生命周期，包括初始化和清理
 */
export class LifecycleService {
  // 组件引用
  private notificationManager: NotificationManager;
  private settingsManager: SettingsManager;
  private providerManager: ProviderManager;
  private syncEngine: SyncEngine;
  private vaultFileManager: VaultFileManager;
  private fileEventHandler: FileEventHandler;
  private autoSyncManager: AutoSyncManager;
  private cacheManager: CacheManager;
  private syncManager: SyncManager;
  private pluginService: PluginService;
  private settingTab: CloudSyncSettingTab;
  
  /**
   * 构造函数
   * @param plugin 插件实例
   */
  constructor(private plugin: CloudSyncPlugin) {}
  
  /**
   * 初始化插件
   * 整合所有初始化步骤
   */
  async initialize(): Promise<void> {
    console.log('开始初始化 Cloud Sync 插件');
    
    // 初始化服务
    this.initializeServices();
    
    // 初始化设置
    await this.initializeSettings();
    
    // 初始化核心组件
    this.initializeComponents();
    
    // 注册UI元素和命令
    this.registerUIElements();
    
    // 设置事件监听器
    this.registerEventListeners();
    
    console.log('Cloud Sync 插件初始化完成');
  }
  
  /**
   * 清理插件资源
   */
  cleanup(): void {
    console.log('卸载 Cloud Sync 插件');
    this.autoSyncManager.stopAutoSync();
    this.providerManager.disconnectAllProviders();
  }
  
  /**
   * 初始化服务
   */
  private initializeServices(): void {
    // 初始化通知管理器
    this.notificationManager = new NotificationManager();
    this.plugin.notificationManager = this.notificationManager;
    
    // 初始化设置管理器
    this.settingsManager = new SettingsManager(this.plugin, this.notificationManager);
    this.plugin.settingsManager = this.settingsManager;
  }
  
  /**
   * 初始化设置
   */
  private async initializeSettings(): Promise<void> {
    // 初始化默认设置
    this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
    
    // 加载设置
    this.plugin.settings = await this.settingsManager.loadSettings();
    
    // 验证和修复设置
    let needSave = this.settingsManager.validateAndFixSettings();
    if (needSave) {
      try {
        await this.plugin.saveSettings(this.plugin.settings);
        console.log('已在插件加载时修复设置问题');
      } catch (error) {
        console.error('保存修复后的设置失败:', error);
      }
    }
  }
  
  /**
   * 初始化组件
   */
  private initializeComponents(): void {
    // 初始化提供商管理器
    this.providerManager = new ProviderManager(
      this.plugin.app, 
      this.plugin.settings, 
      this.notificationManager, 
      this.plugin
    );
    this.plugin.providerManager = this.providerManager;
    this.plugin.storageProviders = this.providerManager.getProviders();
    
    // 初始化提供商
    this.providerManager.initializeProviders();
    
    // 初始化加密服务
    this.plugin.cryptoService = new AESCryptoService();
    
    // 初始化其他组件
    this.vaultFileManager = new VaultFileManager(this.plugin);
    this.plugin.vaultFileManager = this.vaultFileManager;
    
    this.syncEngine = new SyncEngine(this.plugin, this.notificationManager);
    this.plugin.syncEngine = this.syncEngine;
    
    this.syncManager = new SyncManager(this.plugin, this.notificationManager);
    this.plugin.syncManager = this.syncManager;
    
    this.autoSyncManager = new AutoSyncManager(this.plugin, this.syncEngine, this.notificationManager);
    this.plugin.autoSyncManager = this.autoSyncManager;
    
    this.fileEventHandler = new FileEventHandler(this.plugin, this.syncEngine, this.autoSyncManager);
    this.plugin.fileEventHandler = this.fileEventHandler;
    
    this.cacheManager = new CacheManager(this.notificationManager);
    this.plugin.cacheManager = this.cacheManager;
    
    // 向设置管理器传递依赖组件
    this.settingsManager.setDependencies(this.autoSyncManager, this.providerManager);
    
    // 初始化插件服务 - 确保早期初始化以便可以调用公共API方法
    this.pluginService = new PluginService(
      this.plugin.app,
      this.providerManager,
      this.syncManager,
      this.settingsManager,
      this.cacheManager
    );
    this.plugin.pluginService = this.pluginService;
  }
  
  /**
   * 注册UI元素和命令
   */
  private registerUIElements(): void {
    // 添加设置选项卡
    this.settingTab = new CloudSyncSettingTab(this.plugin.app, this.plugin);
    this.plugin.settingTab = this.settingTab;
    this.plugin.addSettingTab(this.settingTab);
    
    // 添加状态栏
    this.plugin.addStatusBarItem().setText('Cloud Sync');
    
    // 添加手动同步命令
    this.plugin.addCommand({
      id: 'manual-sync',
      name: '手动同步',
      callback: async () => {
        try {
          await this.plugin.manualSync();
        } catch (error) {
          console.error('手动同步命令执行失败', error);
          this.notificationManager.show('sync-cmd-error', `同步命令执行失败: ${error.message || ''}`, 5000);
        }
      }
    });
  }
  
  /**
   * 注册事件监听器
   */
  private registerEventListeners(): void {
    // 注册文件事件监听器
    this.fileEventHandler.registerFileEvents();
    
    // 如果启用了自动同步，开始自动同步
    this.autoSyncManager.updateAutoSyncStatus();
  }
} 