import { App } from 'obsidian';
import { PluginSettings } from '@models/plugin-settings';
import { WebDAVProvider } from '@providers/webdav/webdav-provider';
import { CacheManager } from '@src/core/cache-manager';
import { ProviderManager } from '@src/core/provider-manager';
import { SyncManager } from '@src/core/sync-manager';
import { SettingsManager } from '@src/core/settings-manager';

/**
 * 插件服务类
 * 负责处理具体的业务逻辑，保持main.ts文件的简洁
 */
export class PluginService {
  /**
   * 构造函数
   * @param app Obsidian应用实例
   * @param providerManager 提供商管理器
   * @param syncManager 同步管理器
   * @param settingsManager 设置管理器
   * @param cacheManager 缓存管理器
   */
  constructor(
    private app: App,
    private providerManager: ProviderManager,
    private syncManager: SyncManager,
    private settingsManager: SettingsManager,
    private cacheManager: CacheManager
  ) {}

  /**
   * 保存插件设置
   * @param newSettings 新设置
   */
  async saveSettings(newSettings?: PluginSettings) {
    await this.settingsManager.saveSettings(newSettings);
  }

  /**
   * 确保提供商已初始化
   * @param forceInitialize 是否强制初始化（忽略全局同步开关状态）
   * @returns 初始化是否成功
   */
  async ensureProvidersInitialized(forceInitialize: boolean = false) {
    return await this.providerManager.ensureProvidersInitialized(forceInitialize);
  }

  /**
   * 手动同步
   * @returns 同步是否成功
   */
  async manualSync(): Promise<boolean> {
    return await this.syncManager.manualSync();
  }

  /**
   * 清除缓存
   */
  async clearCache() {
    await this.cacheManager.clearCache();
  }

  /**
   * 获取WebDAV提供商类
   * 用于在非标准初始化流程中创建WebDAV提供商实例
   * @returns WebDAV提供商类
   */
  getWebDAVProviderClass() {
    try {
      // 动态导入WebDAV提供商类
      return require('@providers/webdav/webdav-provider').WebDAVProvider;
    } catch (error) {
      console.error('获取WebDAV提供商类失败:', error);
      return null;
    }
  }
} 