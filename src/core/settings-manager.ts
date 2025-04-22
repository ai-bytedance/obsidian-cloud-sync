import { PluginSettings, DEFAULT_SETTINGS } from '@models/plugin-settings';
import CloudSyncPlugin from '@main';
import { AutoSyncManager } from '@src/core/auto-sync-manager';
import { ProviderManager } from '@src/core/provider-manager';
import { NotificationManager } from '@services/notification/notification-manager';

/**
 * 设置管理器类
 * 负责管理插件设置的加载、保存及默认值处理
 * @author Bing
 */
export class SettingsManager {
  private autoSyncManager: AutoSyncManager | null = null;
  private providerManager: ProviderManager | null = null;
  
  /**
   * 构造函数
   * @param plugin 插件实例
   * @param notificationManager 通知管理器
   * @author Bing
   */
  constructor(
    private plugin: CloudSyncPlugin,
    private notificationManager: NotificationManager
  ) {}
  
  /**
   * 设置依赖组件
   * 在所有组件初始化后调用
   * @param autoSyncManager 自动同步管理器
   * @param providerManager 提供商管理器
   * @author Bing
   */
  setDependencies(
    autoSyncManager: AutoSyncManager, 
    providerManager: ProviderManager
  ): void {
    this.autoSyncManager = autoSyncManager;
    this.providerManager = providerManager;
  }
  
  /**
   * 加载插件设置
   * @returns 加载的设置
   * @author Bing
   */
  async loadSettings(): Promise<PluginSettings> {
    // 加载用户设置，与默认设置合并
    const settings = Object.assign({}, DEFAULT_SETTINGS, await this.plugin.loadData());
    
    // 确保同步模式和同步方向有有效值
    if (!settings.syncMode) {
      console.log('同步模式无效，设置为默认值: incremental');
      settings.syncMode = 'incremental';
    }
    
    if (!settings.syncDirection) {
      console.log('同步方向无效，设置为默认值: bidirectional');
      settings.syncDirection = 'bidirectional';
    }
    
    // 处理同步间隔与自动同步的关联逻辑 
    if (settings.syncInterval === 0 && settings.enableSync) {
      console.log('加载设置时检测到同步间隔为0但同步已启用，自动关闭同步功能');
      settings.enableSync = false;
    }
    
    // 记录加载的设置
    console.log('加载的设置，同步模式:', settings.syncMode, 
                '同步方向:', settings.syncDirection,
                '自动同步:', settings.enableSync,
                '同步间隔:', settings.syncInterval);
    
    return settings;
  }
  
  /**
   * 保存插件设置
   * @param newSettings 新设置
   * @author Bing
   */
  async saveSettings(newSettings?: PluginSettings) {
    // 保存之前的自动同步设置状态，用于检测变化
    const oldEnableSync = this.plugin.settings.enableSync;
    const oldSyncInterval = this.plugin.settings.syncInterval;
    const oldEnabledProviders = [...(this.plugin.settings.enabledProviders || [])];
    
    // 检查WebDAV之前的状态
    const oldWebDAVEnabled = this.plugin.settings.providerSettings?.webdav?.enabled;
    
    if (newSettings) {
      this.plugin.settings = newSettings;
    }
    
    // 处理同步间隔与自动同步的关联逻辑
    if (this.plugin.settings.syncInterval === 0 && this.plugin.settings.enableSync) {
      console.log('设置同步间隔为0，自动关闭同步功能');
      this.plugin.settings.enableSync = false;
    }
    
    await this.plugin.saveData(this.plugin.settings);
    
    // 确保所需的依赖组件已设置
    if (!this.providerManager || !this.autoSyncManager) {
      console.warn('保存设置时未设置必要的依赖组件');
      return;
    }
    
    // 检查WebDAV设置是否发生变化
    const newWebDAVEnabled = this.plugin.settings.providerSettings?.webdav?.enabled;
    const webdavEnableChanged = oldWebDAVEnabled !== newWebDAVEnabled;
    
    // 检查enabledProviders是否发生变化
    const newEnabledProviders = this.plugin.settings.enabledProviders || [];
    let providersChanged = false;
    
    if (oldEnabledProviders.length !== newEnabledProviders.length) {
      providersChanged = true;
    } else {
      // 检查内容是否有变化
      for (const provider of oldEnabledProviders) {
        if (!newEnabledProviders.includes(provider)) {
          providersChanged = true;
          break;
        }
      }
    }
    
    // 检查同步设置是否发生变化
    const enableSyncChanged = oldEnableSync !== this.plugin.settings.enableSync;
    const syncIntervalChanged = oldSyncInterval !== this.plugin.settings.syncInterval;
    
    // 由于设置管理是一个关键点，添加更多调试信息
    console.log('保存设置，变更检测:', {
      enableSyncChanged,
      syncIntervalChanged,
      providersChanged,
      webdavEnableChanged
    });
    
    // 重新初始化存储提供商 - 无条件执行以确保同步状态正确
    console.log('重新初始化存储提供商...');
    await this.providerManager.initializeProviders();
    
    // 更新插件中的提供商映射引用
    this.plugin.storageProviders = this.providerManager.getProviders();
    
    // 如果任何相关设置发生变化，更新自动同步状态
    if (enableSyncChanged || syncIntervalChanged || providersChanged || webdavEnableChanged) {
      console.log('同步相关设置已变更，更新自动同步状态');
      this.autoSyncManager.updateAutoSyncStatus();
    }
  }
  
  /**
   * 验证并修复设置一致性问题
   * @returns 是否需要保存设置
   * @author Bing
   */
  validateAndFixSettings(): boolean {
    let needSave = false;
    
    console.log('验证设置一致性...');
    
    // 检查设置的基本结构
    if (!this.plugin.settings.enabledProviders) {
      this.plugin.settings.enabledProviders = [];
      needSave = true;
    }
    
    // 检查 WebDAV 配置
    if (this.plugin.settings.providerSettings.webdav) {
      // 如果 WebDAV 已配置但不在 enabledProviders 中
      const webdavConfigured = 
        this.plugin.settings.providerSettings.webdav?.serverUrl && 
        this.plugin.settings.providerSettings.webdav?.username && 
        this.plugin.settings.providerSettings.webdav?.password;
      
      if (webdavConfigured) {
        const isInEnabled = this.plugin.settings.enabledProviders.includes('webdav');
        const isEnabled = this.plugin.settings.providerSettings.webdav?.enabled;
        
        if (isEnabled && !isInEnabled) {
          // 修复：已启用但不在列表中
          console.log('修复：WebDAV已启用但不在enabledProviders列表中');
          this.plugin.settings.enabledProviders.push('webdav');
          needSave = true;
        } else if (!isEnabled && isInEnabled) {
          // 修复：在列表中但未启用
          console.log('修复：WebDAV在enabledProviders列表中但未启用，从列表中移除');
          this.plugin.settings.enabledProviders = this.plugin.settings.enabledProviders.filter(p => p !== 'webdav');
          needSave = true;
        }
      }
    }
    
    // 处理同步间隔与自动同步关联逻辑
    if (this.plugin.settings.syncInterval === 0 && this.plugin.settings.enableSync) {
      console.log('同步间隔为0，自动关闭自动同步');
      this.plugin.settings.enableSync = false;
      needSave = true;
    } else if (this.plugin.settings.syncInterval > 0 && !this.plugin.settings.enableSync) {
      // 注意：不自动打开，只修复间隔与状态的不一致
      console.log('同步间隔大于0但同步未启用，可能存在不一致');
    }
    
    return needSave;
  }
} 