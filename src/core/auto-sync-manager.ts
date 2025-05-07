import { SyncEngine } from '@src/core/sync-engine'; 
import { PluginSettings } from '@models/plugin-settings';
import { NotificationManager } from '@services/notification/notification-manager';
import CloudSyncPlugin from '@main';
import { NetworkService, NetworkType } from '@services/network/network-service';
import { ModuleLogger } from '@services/log/log-service';

/**
 * 自动同步管理器
 * 负责处理自动同步的调度和执行
 * @author Bing
 */
export class AutoSyncManager {
  private intervalId: NodeJS.Timeout | null = null;
  private lastSyncTime: number = 0;
  // 添加状态跟踪变量
  private isRunning: boolean = false;
  private networkService: NetworkService;
  private networkListener: ((isOnline: boolean, type: NetworkType) => void) | null = null;
  private logger: ModuleLogger;

  /**
   * 构造函数
   * @param plugin 插件实例
   * @param syncEngine 同步引擎实例
   * @param notificationManager 通知管理器
   * @author Bing
   */
  constructor(
    private plugin: CloudSyncPlugin,
    private syncEngine: SyncEngine,
    private notificationManager: NotificationManager
  ) {
    this.networkService = NetworkService.getInstance();
    this.logger = this.plugin.logService.getModuleLogger('AutoSyncManager');
    
    // 添加网络状态变化监听，适应网络检测功能
    this.setupNetworkListener();
  }
  
  /**
   * 设置网络状态变化监听器
   * @private
   */
  private setupNetworkListener(): void {
    // 先移除旧的监听器（如果存在）
    if (this.networkListener) {
      this.networkService.removeNetworkStatusListener(this.networkListener);
      this.networkListener = null;
    }
    
    // 创建并添加新的监听器
    this.networkListener = (isOnline: boolean, type: NetworkType) => {
      if (this.plugin.settings.networkDetection && this.isRunning) {
        // 当网络从非WiFi变为WiFi时，或在PC平台从非良好连接变为以太网时，触发同步
        if (isOnline && (type === NetworkType.WIFI || type === NetworkType.ETHERNET)) {
          this.logger.info(`网络状态变为${type === NetworkType.WIFI ? 'WiFi' : '以太网'}，尝试执行延迟同步`);
          // 延迟30秒后执行同步，避免网络切换瞬间的不稳定
          setTimeout(() => {
            // 再次检查状态，确保仍处于自动同步中且仍是良好连接
            if (this.isRunning && 
                this.plugin.settings.networkDetection &&
                (this.networkService.isWifiConnection() || this.networkService.isEthernetConnection())) {
              this.executeAutoSync();
            }
          }, 30000);
        }
      }
    };
    
    this.networkService.addNetworkStatusListener(this.networkListener);
  }

  /**
   * 启动自动同步
   * 根据设置的同步间隔进行调度
   * @author Bing
   */
  startAutoSync() {
    // 如果自动同步未启用或间隔无效，直接返回
    if (!this.plugin.settings.enableSync || this.plugin.settings.syncInterval <= 0) {
      this.logger.info('自动同步未启用或间隔无效');
      return;
    }

    // 如果已经有定时任务在运行且状态正确，避免重复启动
    if (this.intervalId && this.isRunning) {
      this.logger.info('自动同步已在运行中，跳过重复启动');
      return;
    }

    // 如果已经有定时任务在运行，先停止它
    if (this.intervalId) {
      this.stopAutoSync(false); // 内部停止，不显示通知
    }

    // 计算间隔时间（分钟转为毫秒）
    const interval = this.plugin.settings.syncInterval * 60 * 1000;

    // 设置定时器
    this.intervalId = setInterval(() => {
      this.executeAutoSync();
    }, interval);
    
    // 更新运行状态
    this.isRunning = true;

    // 仅在状态实际变化时才输出日志和显示通知
    this.logger.info(`自动同步已启动，间隔时间: ${this.plugin.settings.syncInterval}分钟`);
    this.notificationManager.show('auto-sync-started', `自动同步已启动，间隔时间: ${this.plugin.settings.syncInterval}分钟`, 3000);
  }

  /**
   * 停止自动同步
   * @param showNotification 是否显示通知，默认为true
   * @author Bing
   */
  stopAutoSync(showNotification: boolean = true) {
    // 如果没有运行中的定时任务，跳过
    if (!this.intervalId || !this.isRunning) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
    this.isRunning = false;
    
    // 清理网络监听器
    if (this.networkListener) {
      this.networkService.removeNetworkStatusListener(this.networkListener);
      this.networkListener = null;
    }
    
    // 仅在需要时显示日志和通知
    if (showNotification) {
      this.logger.info('自动同步已停止');
      this.notificationManager.show('auto-sync-stopped', '自动同步已停止', 3000);
    } else {
      this.logger.info('自动同步已内部停止（无通知）');
    }
  }

  /**
   * 执行自动同步
   * 检查是否满足同步条件并触发同步操作
   * @private
   * @author Bing
   */
  private async executeAutoSync() {
    try {
      // 如果同步功能已被禁用，停止自动同步
      if (!this.plugin.settings.enableSync) {
        this.logger.info('同步功能已被禁用，停止自动同步');
        this.stopAutoSync();
        return;
      }
      
      // 如果已有同步正在进行，跳过此次自动同步
      if (this.plugin.syncInProgress) {
        this.logger.info('有同步操作正在进行，跳过自动同步');
        return;
      }
      
      // 检查网络状态（如果启用了网络检测）
      if (this.plugin.settings.networkDetection) {
        // 使用NetworkService的shouldSync方法来统一判断是否应该同步
        if (!this.networkService.shouldSync(true)) {
          const networkType = this.networkService.getNetworkType();
          this.logger.info(`当前网络类型为${networkType}，根据网络检测设置跳过自动同步`);
          return;
        } else {
          this.logger.info('网络检测已启用，当前为允许同步的网络类型，继续自动同步');
        }
      }
      
      const now = Date.now();
      
      // 设置最小同步间隔，防止过于频繁的同步
      const MIN_SYNC_INTERVAL = 3 * 60 * 1000; // 3分钟
      const configuredInterval = this.plugin.settings.syncInterval * 60 * 1000;
      
      // 使用配置的间隔和最小间隔中的较大值
      const effectiveInterval = Math.max(configuredInterval, MIN_SYNC_INTERVAL);
      
      // 如果距离上次同步时间不足指定间隔，则跳过本次同步
      if (this.lastSyncTime > 0 && now - this.lastSyncTime < effectiveInterval) {
        this.logger.info(`距离上次同步时间不足 ${effectiveInterval/60000} 分钟，跳过本次同步`);
        return;
      }

      this.logger.info('开始执行自动同步');
      await this.plugin.manualSync();
      this.lastSyncTime = Date.now();
      this.logger.info('自动同步完成');
    } catch (error) {
      this.logger.error('自动同步执行出错:', error);
    }
  }

  /**
   * 根据设置更新自动同步状态
   * @author Bing
   */
  updateAutoSyncStatus() {
    const shouldBeRunning = this.plugin.settings.enableSync && this.plugin.settings.syncInterval > 0;
    
    // 只在状态需要改变时执行操作
    if (shouldBeRunning && !this.isRunning) {
      this.startAutoSync();
    } else if (!shouldBeRunning && this.isRunning) {
      this.stopAutoSync();
    }
    
    // 不管是否改变状态，都更新网络监听器，以适应可能的网络检测设置变化
    this.setupNetworkListener();
  }
  
  /**
   * 获取当前自动同步运行状态
   * @returns 是否正在运行
   */
  isAutoSyncRunning(): boolean {
    return this.isRunning;
  }
} 