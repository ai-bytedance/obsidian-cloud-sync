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
import { LogService } from '@services/log/log-service';

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
  private logService: LogService;
  
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
    
    // 记录初始化完成日志
    this.logService.info('Cloud Sync 插件初始化完成');
    console.log('Cloud Sync 插件初始化完成');
  }
  
  /**
   * 清理插件资源
   */
  cleanup(): void {
    console.log('卸载 Cloud Sync 插件');
    this.logService.info('Cloud Sync 插件正在卸载');
    
    // 停止自动同步
    if (this.autoSyncManager) {
      this.autoSyncManager.stopAutoSync();
    }
    
    // 取消文件事件监听
    if (this.fileEventHandler) {
      this.fileEventHandler.unregisterFileEvents();
    }
    
    // 导出最终日志（如果需要）
    if (this.plugin.settings.debugMode && this.logService) {
      const finalLog = this.logService.export();
      console.log('最终日志:', finalLog);
    }
  }
  
  /**
   * 初始化服务
   */
  private initializeServices(): void {
    // 初始化日志服务（最先初始化，以便记录后续操作）
    this.logService = new LogService(this.plugin.settings?.logLevel || 'info');
    this.plugin.logService = this.logService;
    this.logService.info('日志服务已初始化');
    
    // 如果启用了调试模式，启用控制台拦截
    if (this.plugin.settings?.debugMode) {
      this.logService.interceptConsole();
      this.logService.info('已启用控制台拦截（调试模式）');
    }
    
    // 初始化通知管理器
    this.notificationManager = new NotificationManager();
    this.plugin.notificationManager = this.notificationManager;
    this.logService.info('通知管理器已初始化');
    
    // 初始化设置管理器
    this.settingsManager = new SettingsManager(this.plugin, this.notificationManager);
    this.plugin.settingsManager = this.settingsManager;
    this.logService.info('设置管理器已初始化');
  }
  
  /**
   * 初始化设置
   */
  private async initializeSettings(): Promise<void> {
    // 初始化默认设置
    this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
    
    // 加载设置
    this.plugin.settings = await this.settingsManager.loadSettings();
    this.logService.info('设置已加载');
    
    // 更新日志级别
    if (this.plugin.settings.debugMode) {
      this.logService.setLogLevel(this.plugin.settings.logLevel);
      this.logService.info('日志级别已更新', { level: this.plugin.settings.logLevel });
    }
    
    // 验证和修复设置
    let needSave = this.settingsManager.validateAndFixSettings();
    if (needSave) {
      try {
        await this.plugin.saveSettings(this.plugin.settings);
        this.logService.info('已在插件加载时修复设置问题');
        console.log('已在插件加载时修复设置问题');
      } catch (error) {
        this.logService.error('保存修复后的设置失败', error);
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
    this.logService.info('提供商管理器已初始化');
    
    // 初始化提供商
    this.providerManager.initializeProviders();
    this.logService.info('提供商已初始化');
    
    // 初始化加密服务
    this.plugin.cryptoService = new AESCryptoService();
    this.logService.info('加密服务已初始化');
    
    // 初始化其他组件
    this.vaultFileManager = new VaultFileManager(this.plugin);
    this.plugin.vaultFileManager = this.vaultFileManager;
    this.logService.info('Vault文件管理器已初始化');
    
    this.syncEngine = new SyncEngine(this.plugin, this.notificationManager);
    this.plugin.syncEngine = this.syncEngine;
    this.logService.info('同步引擎已初始化');
    
    this.syncManager = new SyncManager(this.plugin, this.notificationManager);
    this.plugin.syncManager = this.syncManager;
    this.logService.info('同步管理器已初始化');
    
    this.autoSyncManager = new AutoSyncManager(this.plugin, this.syncEngine, this.notificationManager);
    this.plugin.autoSyncManager = this.autoSyncManager;
    this.logService.info('自动同步管理器已初始化');
    
    this.fileEventHandler = new FileEventHandler(this.plugin, this.syncEngine, this.autoSyncManager);
    this.plugin.fileEventHandler = this.fileEventHandler;
    this.logService.info('文件事件处理器已初始化');
    
    this.cacheManager = new CacheManager(this.notificationManager);
    this.plugin.cacheManager = this.cacheManager;
    this.logService.info('缓存管理器已初始化');
    
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
    this.logService.info('插件服务已初始化');
  }
  
  /**
   * 注册UI元素和命令
   */
  private registerUIElements(): void {
    // 添加设置选项卡
    this.settingTab = new CloudSyncSettingTab(this.plugin.app, this.plugin);
    this.plugin.addSettingTab(this.settingTab);
    this.logService.info('设置UI已注册');
    
    // 添加功能按钮到功能区
    this.plugin.addRibbonIcon('cloud', 'Cloud Sync', async () => {
      // 尝试手动同步
      try {
        await this.plugin.manualSync();
      } catch (error) {
        this.logService.error('从功能区按钮触发同步失败', error);
        this.notificationManager.show('sync-error', `同步失败: ${error.message || error}`, 5000);
      }
    });
    this.logService.info('功能区按钮已添加');
    
    // 添加命令
    this.plugin.addCommand({
      id: 'sync-now',
      name: '立即同步',
      callback: async () => {
        try {
          await this.plugin.manualSync();
        } catch (error) {
          this.logService.error('从命令触发同步失败', error);
          this.notificationManager.show('sync-error', `同步失败: ${error.message || error}`, 5000);
        }
      }
    });
    this.logService.info('同步命令已注册');
  }
  
  /**
   * 注册事件监听器
   */
  private registerEventListeners(): void {
    // 注册文件事件监听器
    this.fileEventHandler.registerFileEvents();
    this.logService.info('文件事件监听器已注册');
    
    // 如果启用了自动同步，开始自动同步
    this.autoSyncManager.updateAutoSyncStatus();
    this.logService.info('自动同步状态已更新', { enabled: this.plugin.settings.enableSync });
  }
} 