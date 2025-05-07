/**
 * 网络服务类
 * 负责检测网络连接状态和类型
 * @author Bing
 */
import { ModuleLogger } from '@services/log/log-service';
import CloudSyncPlugin from '@main';

/**
 * 网络类型枚举
 */
export enum NetworkType {
  WIFI = 'wifi',
  CELLULAR = 'cellular',
  ETHERNET = 'ethernet',
  UNKNOWN = 'unknown',
  NONE = 'none'
}

/**
 * 网络服务类
 */
export class NetworkService {
  private static instance: NetworkService;
  private networkStatusListeners: Array<(isOnline: boolean, type: NetworkType) => void> = [];
  private logger: ModuleLogger | null = null;

  /**
   * 获取实例（单例模式）
   */
  public static getInstance(): NetworkService {
    if (!NetworkService.instance) {
      NetworkService.instance = new NetworkService();
    }
    return NetworkService.instance;
  }

  /**
   * 设置日志服务
   * @param plugin 插件实例
   */
  public setLogger(plugin: CloudSyncPlugin): void {
    if (plugin && plugin.logService) {
      this.logger = plugin.logService.getModuleLogger('NetworkService');
      this.logger.info('网络服务日志已初始化');
    }
  }

  /**
   * 构造函数
   */
  private constructor() {
    // 添加网络状态变化事件监听
    window.addEventListener('online', () => this.notifyListeners());
    window.addEventListener('offline', () => this.notifyListeners());
    
    // 如果支持网络信息API，也监听网络类型变化
    if (this.isNetworkInfoApiSupported()) {
      // @ts-ignore - 这是实验性API，TypeScript可能没有类型定义
      navigator.connection.addEventListener('change', () => this.notifyListeners());
    }
  }

  /**
   * 检查当前是否在线
   * @returns 是否在线
   */
  public isOnline(): boolean {
    return navigator.onLine;
  }

  /**
   * 检查是否为WiFi网络
   * @returns 是否为WiFi网络
   */
  public isWifiConnection(): boolean {
    return this.getNetworkType() === NetworkType.WIFI;
  }
  
  /**
   * 检查是否为以太网连接
   * @returns 是否为以太网连接
   */
  public isEthernetConnection(): boolean {
    return this.getNetworkType() === NetworkType.ETHERNET;
  }

  /**
   * 获取当前网络类型
   * @returns 网络类型
   */
  public getNetworkType(): NetworkType {
    // 如果离线，直接返回NONE
    if (!navigator.onLine) {
      this.logger?.info('网络状态: 离线');
      return NetworkType.NONE;
    }

    // 检查是否支持网络信息API
    if (this.isNetworkInfoApiSupported()) {
      // @ts-ignore - 这是实验性API，TypeScript可能没有类型定义
      const connection = navigator.connection;
      
      // 根据有效类型判断
      // @ts-ignore
      const type = connection.type || connection.effectiveType;
      
      // 记录原始类型信息，有助于调试
      this.logger?.info(`Network Info API报告的连接类型: ${type}`);
      
      // 增强型判断逻辑
      if (type === 'wifi') {
        this.logger?.info('检测到WiFi网络连接');
        return NetworkType.WIFI;
      } else if (type === 'ethernet') {
        this.logger?.info('检测到以太网连接');
        return NetworkType.ETHERNET;
      } else if (['cellular', 'slow-2g', '2g', '3g', '4g', '5g'].includes(type)) {
        this.logger?.info(`检测到移动数据连接: ${type}`);
        return NetworkType.CELLULAR;
      } else {
        // 未知类型，尝试用额外检测
        if (this.isPCPlatform()) {
          // 在PC平台上，尝试进一步判断
          // 如果是通过以太网连接的可能性大，则返回ETHERNET
          if (this.isProbablyEthernet()) {
            this.logger?.info('无法精确识别网络类型，但环境判断可能是以太网连接');
            return NetworkType.ETHERNET;
          }
        }
        
        this.logger?.info(`无法识别的网络类型: ${type}，返回UNKNOWN`);
        return NetworkType.UNKNOWN;
      }
    }

    // 如果不支持网络信息API，再次尝试平台判断
    this.logger?.info('不支持Network Information API，使用兼容模式');
    
    if (this.isPCPlatform()) {
      this.logger?.info('在PC平台上无法识别具体网络类型，默认返回UNKNOWN');
      // PC平台上，即使返回UNKNOWN，shouldSync也会允许同步
      return NetworkType.UNKNOWN;
    }
    
    // 其他情况
    this.logger?.info('无法识别网络类型，返回UNKNOWN');
    return NetworkType.UNKNOWN;
  }

  /**
   * 基于环境和其他间接信息，估计当前是否可能是以太网连接
   * 这是一个启发式方法，不保证100%准确
   * @private
   * @returns 是否可能是以太网连接
   */
  private isProbablyEthernet(): boolean {
    // 确保是PC平台
    if (!this.isPCPlatform()) {
      return false;
    }
    
    // 在PC平台上，如果是Windows或macOS，且Online，很可能是以太网
    const userAgent = navigator.userAgent.toLowerCase();
    const isWindows = userAgent.indexOf('windows') !== -1;
    const isMac = userAgent.indexOf('macintosh') !== -1;
    
    // 简单假设：在桌面系统上，如果在线，可能是以太网连接
    // 这是一个保守的估计，实际应用中可能需要更复杂的判断
    const result = (isWindows || isMac) && navigator.onLine;
    if (result) {
      this.logger?.info(`估计可能是以太网连接 (${isWindows ? 'Windows' : isMac ? 'Mac' : '其他PC平台'})`);
    }
    return result;
  }

  /**
   * 检查是否为PC平台
   * 桌面版Obsidian通常运行在PC平台上
   * @returns 是否为PC平台
   */
  public isPCPlatform(): boolean {
    // 检查常见的PC平台特征
    const userAgent = navigator.userAgent.toLowerCase();
    const isWindows = userAgent.indexOf('windows') !== -1;
    const isMac = userAgent.indexOf('macintosh') !== -1;
    const isLinux = userAgent.indexOf('linux') !== -1 && userAgent.indexOf('android') === -1;
    
    // Obsidian桌面版也是PC平台
    const isObsidianDesktop = userAgent.indexOf('obsidian') !== -1 && 
                              userAgent.indexOf('electron') !== -1;
    
    const result = isWindows || isMac || isLinux || isObsidianDesktop;
    if (this.logger) {
      let platform = '';
      if (isWindows) platform = 'Windows';
      else if (isMac) platform = 'Mac';
      else if (isLinux) platform = 'Linux';
      else if (isObsidianDesktop) platform = 'Obsidian Desktop';
      
      if (platform) {
        this.logger.info(`检测到PC平台: ${platform}`);
      } else if (result) {
        this.logger.info('检测到未知PC平台');
      } else {
        this.logger.info('检测到非PC平台');
      }
    }
    return result;
  }

  /**
   * 检查是否应该同步（基于网络检测设置）
   * @param networkDetectionEnabled 是否启用网络检测
   * @returns 是否应该同步
   */
  public shouldSync(networkDetectionEnabled: boolean): boolean {
    // 如果未启用网络检测，则总是允许同步
    if (!networkDetectionEnabled) {
      this.logger?.info('网络检测已禁用，允许同步');
      return true;
    }
    
    // 获取当前网络类型
    const networkType = this.getNetworkType();
    
    // 如果是PC平台，使用更宽松的网络类型判断
    if (this.isPCPlatform()) {
      // PC平台上，除了明确的移动数据网络和离线状态外，都允许同步
      // 这包括WiFi、以太网和未知类型的连接
      if (networkType === NetworkType.WIFI || 
          networkType === NetworkType.ETHERNET || 
          networkType === NetworkType.UNKNOWN) {
        this.logger?.info(`PC平台: ${networkType} 连接，允许同步`);
        return true;
      }
      
      // 对于被错误识别为CELLULAR的连接，也需进一步判断
      // 因为在某些环境下，以太网可能被错误地识别为移动数据
      if (networkType === NetworkType.CELLULAR) {
        // 尝试使用额外的方法判断是否真的是移动数据
        // 如果无法明确判断，在PC平台上倾向于允许同步
        if (this.isTrueCellularConnection()) {
          this.logger?.info('PC平台: 确认为移动数据连接，不允许同步');
          return false; // 确定是移动数据，不同步
        } else {
          this.logger?.info('PC平台: 可能误判为移动数据，允许同步');
          return true;  // 不确定或可能是误判，允许同步
        }
      }
    } else {
      // 移动设备上，仅WiFi网络允许同步
      if (networkType === NetworkType.WIFI) {
        this.logger?.info('移动设备: WiFi连接，允许同步');
        return true;
      } else {
        this.logger?.info(`移动设备: ${networkType} 连接，不允许同步`);
      }
    }
    
    // 其他情况（确定的蜂窝、离线等）不同步
    if (networkType === NetworkType.NONE) {
      this.logger?.info('网络离线，不允许同步');
    } else {
      this.logger?.info(`网络类型 ${networkType} 不符合同步条件`);
    }
    return false;
  }

  /**
   * 尝试进一步确认是否真的是蜂窝移动数据连接
   * 在PC平台上大多数情况下不是真正的移动数据
   * @private
   * @returns 是否确定为蜂窝移动数据
   */
  private isTrueCellularConnection(): boolean {
    // 简化实现：在PC平台上假设不是真正的移动数据
    // 这避免了错误的网络类型检测阻止同步
    if (this.isPCPlatform()) {
      this.logger?.info('PC平台上的移动数据连接可能是误判');
      return false;
    }
    
    // 对于移动设备，依赖原始API判断
    // 如果有必要，可以在这里添加更复杂的检测逻辑
    this.logger?.info('移动设备上的移动数据连接判定为真实');
    return true;
  }

  /**
   * 添加网络状态变化监听器
   * @param listener 监听器函数
   */
  public addNetworkStatusListener(listener: (isOnline: boolean, type: NetworkType) => void): void {
    this.networkStatusListeners.push(listener);
    this.logger?.info('添加了网络状态变化监听器');
  }

  /**
   * 移除网络状态变化监听器
   * @param listener 要移除的监听器函数
   */
  public removeNetworkStatusListener(listener: (isOnline: boolean, type: NetworkType) => void): void {
    const index = this.networkStatusListeners.indexOf(listener);
    if (index !== -1) {
      this.networkStatusListeners.splice(index, 1);
      this.logger?.info('移除了网络状态变化监听器');
    }
  }

  /**
   * 通知所有监听器
   * @private
   */
  private notifyListeners(): void {
    const isOnline = this.isOnline();
    const networkType = this.getNetworkType();
    this.logger?.info(`网络状态变化: 在线=${isOnline}, 类型=${networkType}`);
    
    // 通知所有监听器
    for (const listener of this.networkStatusListeners) {
      try {
        listener(isOnline, networkType);
      } catch (error) {
        this.logger?.error('调用网络状态监听器时出错', error);
      }
    }
  }

  /**
   * 检查是否支持网络信息API
   * @private
   * @returns 是否支持网络信息API
   */
  private isNetworkInfoApiSupported(): boolean {
    // @ts-ignore - 这是实验性API，TypeScript可能没有类型定义
    return !!(navigator.connection);
  }
} 