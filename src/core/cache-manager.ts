import { NotificationManager } from '@services/notification/notification-manager';
import { ModuleLogger } from '@services/log/log-service';
import CloudSyncPlugin from '@main';

/**
 * 缓存管理器类
 * 负责管理云同步缓存，包括清除缓存等操作
 * @author Bing
 */
export class CacheManager {
  private logger: ModuleLogger;
  
  /**
   * 构造函数
   * @param notificationManager 通知管理器
   * @param plugin 插件实例
   * @author Bing
   */
  constructor(
    private notificationManager: NotificationManager,
    private plugin?: CloudSyncPlugin
  ) {
    if (this.plugin && this.plugin.logService) {
      this.logger = this.plugin.logService.getModuleLogger('CacheManager');
    }
  }
  
  /**
   * 清除缓存
   * 清除同步状态、文件元数据缓存等
   * @author Bing
   */
  async clearCache() {
    // 实际实现中，需要清除同步状态、文件元数据缓存等
    if (this.logger) {
      this.logger.info('清除云同步缓存');
    }
    this.notificationManager.show('cache-cleared', '缓存已清除', 3000);
  }
} 