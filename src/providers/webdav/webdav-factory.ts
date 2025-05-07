import { App } from 'obsidian';
import { StorageProvider } from '@providers/common/storage-provider';
import { WebDAVSettings } from '@models/plugin-settings';
import { GenericWebDAVVendor } from './vendors/generic-vendor';
import { JianguoyunWebDAVVendor } from './vendors/jianguoyun-vendor';
import CloudSyncPlugin from '@main';

/**
 * WebDAV提供商工厂类
 * 负责创建正确的WebDAV提供商实现
 * @author Bing
 */
export class WebDAVFactory {
  /**
   * 识别WebDAV服务器类型
   * @param serverUrl 服务器URL
   * @returns 服务器类型标识
   */
  static identifyProviderType(serverUrl: string): 'jianguoyun' | 'generic' {
    if (!serverUrl) return 'generic';
    
    const url = serverUrl.toLowerCase().trim();
    
    // 检测坚果云
    if (url.includes('dav.jianguoyun.com') || 
        url.includes('jianguoyun') || 
        url.includes('jgy')) {
      return 'jianguoyun';
    }
    
    // 默认返回通用类型
    return 'generic';
  }
  
  /**
   * 创建WebDAV提供商实例
   * @param config WebDAV配置
   * @param app Obsidian应用实例
   * @param plugin 可选，插件实例，用于获取日志服务
   * @returns WebDAV提供商实例
   */
  static createProvider(config: WebDAVSettings, app: App, plugin?: CloudSyncPlugin): StorageProvider {
    const providerType = this.identifyProviderType(config.serverUrl);
    
    // 根据类型创建对应的提供商
    switch (providerType) {
      case 'jianguoyun':
        return new JianguoyunWebDAVVendor(config, app, plugin);
      default:
        return new GenericWebDAVVendor(config, app, plugin);
    }
  }
} 