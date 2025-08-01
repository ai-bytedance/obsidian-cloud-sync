import { App, TFile, TFolder, Platform, normalizePath } from 'obsidian';
import { StorageProvider, FileInfo, ConnectionStatus } from '@providers/common/storage-provider';
import { NotificationManager } from '@services/notification/notification-manager';
import { PluginSettings, StorageProviderType } from '@models/plugin-settings';
import { SyncStrategyBase, LocalFileInfo } from '@src/core/sync-strategies/sync-strategy-base';
import CloudSyncPlugin from '@main';
import { SyncPathUtils } from '@src/utils/sync-path-utils';
import { SyncFileFilter } from '@src/utils/sync-file-filter';
import { Notice } from 'obsidian';
import { NetworkService, NetworkType } from '@services/network/network-service';
import { SyncEngine } from '@src/core/sync-engine';
import { LogService, ModuleLogger } from '@services/log/log-service';

/**
 * 同步管理器类
 * 负责处理云同步的核心功能，包括手动同步等操作
 * @author Bing
 */
export class SyncManager {
  private lastSyncTime: number = 0; // 跟踪上次同步时间
  private syncLockAcquired: boolean = false; // 添加同步锁
  private syncLockTimeout: ReturnType<typeof setTimeout> | null = null; // 添加超时计时器
  private readonly MAX_SYNC_DURATION = 5 * 60 * 1000; // 5分钟超时
  private networkService: NetworkService;
  private logger: ModuleLogger;
  
  /**
   * 构造函数
   * @param plugin 插件实例
   * @param notificationManager 通知管理器
   * @author Bing
   */
  constructor(
    private plugin: CloudSyncPlugin,
    private notificationManager: NotificationManager
  ) {
    this.networkService = NetworkService.getInstance();
    this.logger = this.plugin.logService.getModuleLogger('SyncManager');
  }

  /**
   * 手动同步
   * 先验证并修复设置一致性，然后执行同步
   * @param showNotice 是否显示通知
   * @returns 同步是否成功
   */
  async manualSync(showNotice: boolean = true): Promise<boolean> {
    try {
      // 如果锁已被获取，跳过此次同步
      if (this.syncLockAcquired) {
        this.logger.warning('已有同步操作正在进行，跳过此次调用');
        if (showNotice) {
          this.notificationManager.show('sync-warning', '有另一个同步操作正在进行，请稍后再试', 3000);
        }
        return false;
      }
      
      // 确保configDir被添加到ignoreFolders中
      const configDir = normalizePath(this.plugin.app.vault.configDir);
      if (configDir && this.plugin.settings.ignoreFolders) {
        // 检查configDir是否已经存在于ignoreFolders中
        const configDirInList = this.plugin.settings.ignoreFolders.some(
          folder => folder === configDir || folder === `${configDir}/`
        );
        
        if (!configDirInList) {
          this.logger.info(`将配置目录 ${configDir} 添加到忽略文件夹列表`);
          this.plugin.settings.ignoreFolders.push(configDir);
        }
      }
      
      // 检查网络状态（如果启用了网络检测）
      if (this.plugin.settings.networkDetection) {
        // 记录当前网络类型，用于调试
        const networkType = this.networkService.getNetworkType();
        const isPCPlatform = Platform.isDesktop;
        
        // 记录更详细的网络状态日志
        this.logger.info(`[网络检测] 当前平台: ${isPCPlatform ? 'PC' : '移动设备'}, 网络类型: ${networkType}`);
        
        // 使用NetworkService的shouldSync方法统一判断
        if (!this.networkService.shouldSync(true)) {
          const networkTypeName = networkType === NetworkType.CELLULAR ? '移动数据' : 
                                 networkType === NetworkType.ETHERNET ? '以太网' : 
                                 networkType === NetworkType.WIFI ? 'WiFi' : 
                                 networkType === NetworkType.UNKNOWN ? '未知' : 
                                 networkType === NetworkType.NONE ? '离线' : networkType;
          
          this.logger.info(`[网络检测] 当前网络类型为${networkTypeName}，根据网络检测设置跳过同步`);
          if (showNotice) {
            this.notificationManager.show('sync-info', `当前非WiFi网络(${networkTypeName})，已跳过同步操作`, 3000);
          }
          return false;
        } else {
          const networkTypeName = networkType === NetworkType.CELLULAR ? '移动数据' : 
                                 networkType === NetworkType.ETHERNET ? '以太网' : 
                                 networkType === NetworkType.WIFI ? 'WiFi' : 
                                 networkType === NetworkType.UNKNOWN ? '未知' : 
                                 networkType === NetworkType.NONE ? '离线' : networkType;
          this.logger.info(`[网络检测] 网络检测已启用，当前为${networkTypeName}网络，允许同步`);
        }
      }
      
      // 获取锁
      this.syncLockAcquired = true;
      
      // 设置安全超时，防止锁定状态无法释放
      this.syncLockTimeout = setTimeout(() => {
        this.logger.warning('同步操作超时，强制释放锁');
        this.syncLockAcquired = false;
        this.plugin.syncInProgress = false;
        
        if (showNotice) {
          this.notificationManager.show('sync-error', '同步操作超时，已自动中断', 5000);
        }
      }, this.MAX_SYNC_DURATION);
      
      // 设置全局同步进行中标志
      this.plugin.syncInProgress = true;
      
      this.logger.info('开始手动同步...');
      
      // 验证并修复设置一致性
      const needSave = this.validateAndFixSettings();
      if (needSave) {
        await this.plugin.saveSettings(this.plugin.settings);
        this.logger.info('已保存修复后的设置');
        
        // 添加小延迟确保设置完全保存
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // 检查是否有已启用的提供商
      const settings = this.plugin.settings;
      
      // 主动检查WebDAV配置，提前解决可能的状态不一致问题
      const webdavSettings = this.plugin.settings.providerSettings?.webdav;
      const webdavConfigured = this.isWebDAVConfigComplete(webdavSettings);

      if (webdavConfigured) {
        let settingsChanged = false;
        
        // 确保全局同步启用（临时）
        const originalSyncEnabled = this.plugin.settings.enableSync;
        
        // 强制临时启用全局同步
        if (!originalSyncEnabled) {
          this.logger.info('手动同步时临时启用全局同步以确保提供商正确初始化');
          this.plugin.settings.enableSync = true;
          settingsChanged = true;
        }
        
        // 确保WebDAV在启用列表中
        if (!this.plugin.settings.enabledProviders.includes('webdav')) {
          this.logger.info('手动同步时检测到WebDAV配置完整但不在启用列表中，添加WebDAV到启用列表');
          if (!this.plugin.settings.enabledProviders) {
            this.plugin.settings.enabledProviders = [];
          }
          this.plugin.settings.enabledProviders.push('webdav');
          settingsChanged = true;
        }
        
        // 确保WebDAV被标记为启用
        if (webdavSettings && !webdavSettings.enabled) {
          this.logger.info('手动同步时检测到WebDAV配置完整但未标记为启用，设置为启用');
          webdavSettings.enabled = true;
          settingsChanged = true;
        }
        
        // 如果做了改变，保存设置
        if (settingsChanged) {
          await this.plugin.saveSettings(this.plugin.settings);
          this.logger.info('已保存临时更新的WebDAV设置');
          
          // 添加小延迟确保设置完全保存
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      } else {
        this.logger.info('WebDAV配置不完整，可能影响同步功能');
        
        // 如果WebDAV配置不完整但在启用列表中，从列表中移除
        if (settings.enabledProviders.includes('webdav')) {
          this.logger.info('WebDAV配置不完整但被启用，从启用列表中移除');
          settings.enabledProviders = settings.enabledProviders.filter(p => p !== 'webdav');
          await this.plugin.saveSettings(settings);
          
          // 添加小延迟确保设置完全保存
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }

      // 无论全局同步状态如何，在手动同步时强制初始化提供商
      this.logger.info('手动同步：强制初始化提供商');
      const providersInitialized = await this.plugin.ensureProvidersInitialized(true);
      
      if (!providersInitialized) {
        this.logger.info('存储提供商初始化失败，尝试直接恢复');
        
        // 无论如何，确保WebDAV提供商存在（如果配置完整）
        if (webdavConfigured && webdavSettings) {
          this.logger.info('检测到WebDAV配置完整，尝试应急创建WebDAV提供商');
          
          try {
            // 直接创建WebDAV提供商实例
            const WebDAVProvider = this.plugin.getWebDAVProviderClass();
            if (WebDAVProvider) {
              const webdavProvider = new WebDAVProvider(webdavSettings, this.plugin.app);
              
              // 直接添加到提供商映射
              if (!this.plugin.storageProviders) {
                this.plugin.storageProviders = new Map();
              }
              
              this.plugin.storageProviders.set('webdav', webdavProvider);
              this.logger.info('应急创建WebDAV提供商成功，被添加到映射');
              
              // 验证是否真的添加成功
              if (!this.plugin.storageProviders.has('webdav')) {
                this.logger.error('WebDAV提供商添加到映射失败，可能是映射对象问题');
                
                // 重新创建映射并再次尝试
                this.plugin.storageProviders = new Map();
                this.plugin.storageProviders.set('webdav', webdavProvider);
                
                if (this.plugin.storageProviders.has('webdav')) {
                  this.logger.info('第二次尝试添加WebDAV提供商成功');
                } else {
                  throw new Error('即使重建映射，仍无法添加WebDAV提供商');
                }
              }
            } else {
              this.logger.error('无法获取WebDAV提供商类');
              if (showNotice) {
                this.notificationManager.show('sync-error', '无法创建WebDAV提供商，请重启应用', 5000);
              }
              return false;
            }
          } catch (error) {
            this.logger.error('创建WebDAV提供商实例失败:', error);
            if (showNotice) {
              this.notificationManager.show('sync-error', `无法创建WebDAV提供商：${error.message || error}`, 5000);
            }
            return false;
          }
        } else {
          this.logger.info('WebDAV配置不完整，无法创建提供商');
          if (showNotice) {
            this.notificationManager.show('sync-error', '云存储配置不完整，请检查WebDAV设置', 5000);
          }
          return false;
        }
      }
      
      // 检查提供商映射是否为空
      if (!this.plugin.storageProviders || this.plugin.storageProviders.size === 0) {
        this.logger.info('提供商映射为空，尝试再次强制初始化');
        
        // 强制重置并重新初始化
        this.plugin.settings.enableSync = true;
        await this.plugin.saveSettings(this.plugin.settings);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 使用最大强制模式重新初始化
        const reinitialized = await this.plugin.ensureProvidersInitialized(true);
        if (!reinitialized) {
          this.logger.info('再次初始化提供商失败，无法进行同步');
          if (showNotice) {
            this.notificationManager.show('sync-error', '无法初始化存储提供商，请检查配置或重启应用', 5000);
          }
          return false;
        }
        
        // 再次检查映射
        if (!this.plugin.storageProviders || this.plugin.storageProviders.size === 0) {
          this.logger.error('多次尝试后，提供商映射仍为空');
          if (showNotice) {
            this.notificationManager.show('sync-error', '初始化提供商失败，请重启应用以解决此问题', 5000);
          }
          return false;
        }
      }

      // 特别检查WebDAV提供商，确保它存在于映射中
      if (webdavConfigured && 
          (!this.plugin.storageProviders.has('webdav'))) {
        this.logger.info('WebDAV配置完整但未在提供商映射中找到，尝试紧急添加');
        
        try {
          // 直接创建WebDAV提供商实例
          const WebDAVProvider = this.plugin.getWebDAVProviderClass();
          if (WebDAVProvider && webdavSettings) {
            const webdavProvider = new WebDAVProvider(webdavSettings, this.plugin.app);
            this.plugin.storageProviders.set('webdav', webdavProvider);
            this.logger.info('紧急添加WebDAV提供商成功');
          } else {
            this.logger.error('无法获取WebDAV提供商类或设置');
            if (showNotice) {
              this.notificationManager.show('sync-error', '无法创建WebDAV提供商，请重启应用', 5000);
            }
            return false;
          }
        } catch (error) {
          this.logger.error('紧急添加WebDAV提供商失败:', error);
        }
      }
      
      // 最终检查是否有可用的提供商
      if (this.plugin.storageProviders.size === 0) {
        this.logger.error('无可用的存储提供商，无法同步');
        if (showNotice) {
          this.notificationManager.show('sync-error', '没有可用的存储提供商，无法同步', 5000);
        }
        return false;
      }

      this.logger.info(`准备开始同步，检测到 ${this.plugin.storageProviders.size} 个提供商`);

      // 由双向同步类执行同步逻辑
      try {
        // 获取本地文件和文件夹列表
        const [localFiles, localFolders] = await Promise.all([
          this.getLocalFiles(),
          this.getLocalFolders()
        ]);
        
        // 对于所有启用的提供商，执行同步
        for (const providerType of this.plugin.settings.enabledProviders) {
          // 获取提供商实例
          const provider = this.plugin.storageProviders.get(providerType);
          if (!provider) {
            this.logger.error(`无法获取提供商实例: ${providerType}`);
            continue;
          }
          
          // 获取远程文件列表
          const remotePath = '';  // 使用根路径
          this.logger.info(`获取远程文件列表，路径: ${remotePath || '根目录'}...`);
          
          // 获取远程文件
          const remoteFiles = await provider.listFiles(remotePath);
          this.logger.info(`获取到 ${remoteFiles.length} 个远程文件/文件夹`);

          // 检查当前设置的同步方向
          const syncDirection = this.plugin.settings.syncDirection;
          this.logger.info(`当前SyncManager中配置的同步方向: ${syncDirection}`);
          
          // 创建SyncEngine实例来处理同步，确保按配置的方向执行
          const syncEngine = new SyncEngine(this.plugin, this.notificationManager);
          await syncEngine.performSync(false); // false表示这是手动同步，非自动同步
        }
      } catch (error) {
        this.logger.error('同步执行中出错:', error);
        throw error;
      }
      
      // 记录此次同步时间
      this.lastSyncTime = Date.now();
      
      if (showNotice) {
        this.notificationManager.show('sync-success', '同步完成', 3000);
      }
      
      return true;
    } catch (error) {
      this.logger.error('同步失败:', error);
      
      // 清除进度通知
      this.notificationManager.clear('sync-provider');
      this.notificationManager.clear('sync-executing');
      
      // 在UI上显示错误通知
      if (showNotice) {
        const errorMessage = error.message || error.toString();
        this.notificationManager.show('sync-error', `同步失败: ${errorMessage}`, 5000);
      }
      
      return false;
    } finally {
      // 清除超时并释放锁
      if (this.syncLockTimeout) {
        clearTimeout(this.syncLockTimeout);
        this.syncLockTimeout = null;
      }
      this.syncLockAcquired = false;
      this.plugin.syncInProgress = false;
    }
  }
  
  /**
   * 检查WebDAV配置是否完整
   * @param settings WebDAV设置对象
   * @returns 是否配置完整
   */
  private isWebDAVConfigComplete(settings: any): boolean {
    // 检查整个设置对象
    if (!settings) return false;
    
    // 检查必要字段
    const hasServerUrl = typeof settings.serverUrl === 'string' && settings.serverUrl.trim() !== '';
    const hasUsername = typeof settings.username === 'string' && settings.username.trim() !== '';
    const hasPassword = typeof settings.password === 'string' && settings.password !== ''; // 密码可以包含空白字符
    
    return hasServerUrl && hasUsername && hasPassword;
  }
  
  /**
   * 获取本地文件列表，包括文件夹
   * @returns 本地文件和文件夹列表
   * @author Bing
   */
  private async getLocalFiles(): Promise<LocalFileInfo[]> {
    const files: LocalFileInfo[] = [];
    
    try {
      // 获取所有文件
      const allFiles = this.plugin.app.vault.getFiles();
      
      for (const file of allFiles) {
        // 检查文件是否应该被忽略
        if (SyncFileFilter.shouldExcludeFile(file, this.plugin.settings)) {
          this.logger.info(`忽略文件: ${file.path}`);
          continue;
        }
        
        try {
          // 获取文件元数据
          const stat = await this.plugin.app.vault.adapter.stat(file.path);
          if (!stat) {
            this.logger.warning(`获取文件元数据为空: ${file.path}`);
            continue;
          }
          
          files.push({
            path: file.path,
            mtime: stat.mtime,
            size: stat.size,
            isFolder: false
          });
        } catch (err) {
          this.logger.error(`无法获取文件信息: ${file.path}`, err);
        }
      }
      
      // 获取所有文件夹
      const folders = await this.getLocalFolders();
      files.push(...folders);
      
      this.logger.info(`本地文件列表创建完成: ${files.length} 个条目`);
      return files;
    } catch (error) {
      this.logger.error('获取本地文件列表时出错:', error);
      throw error;
    }
  }
  
  /**
   * 获取本地文件夹列表
   * @returns 本地文件夹列表
   * @author Bing
   */
  private async getLocalFolders(): Promise<LocalFileInfo[]> {
    const folders: LocalFileInfo[] = [];
    
    try {
      // 递归获取指定目录下的所有文件夹
      const getFoldersRecursively = async (dir: string) => {
        try {
          const { folders: subFolders } = await this.plugin.app.vault.adapter.list(dir);
          
          for (const folder of subFolders) {
            // 检查文件夹是否应该被忽略
            const filePath = { path: folder };
            if (SyncFileFilter.shouldExcludeFile(filePath, this.plugin.settings)) {
              this.logger.info(`忽略文件夹: ${folder}`);
              continue;
            }
            
            try {
              const stat = await this.plugin.app.vault.adapter.stat(folder);
              
              if (stat) {
                folders.push({
                  path: folder,
                  mtime: stat.mtime,
                  size: 0,
                  isFolder: true
                });
              } else {
                // 如果无法获取文件夹状态，使用当前时间作为修改时间
                folders.push({
                  path: folder,
                  mtime: Date.now(),
                  size: 0,
                  isFolder: true
                });
              }
              
              // 递归处理子文件夹
              await getFoldersRecursively(folder);
            } catch (err) {
              this.logger.error(`无法获取文件夹信息: ${folder}`, err);
              
              // 即使出错，也添加文件夹，确保同步结构
              folders.push({
                path: folder,
                mtime: Date.now(),
                size: 0,
                isFolder: true
              });
            }
          }
        } catch (error) {
          this.logger.error(`列出目录失败: ${dir}`, error);
        }
      }
      
      // 从根目录开始获取所有文件夹
      await getFoldersRecursively('');
      
      this.logger.info(`本地文件夹列表创建完成: ${folders.length} 个文件夹`);
      return folders;
    } catch (error) {
      this.logger.error('获取本地文件夹列表时出错:', error);
      return [];
    }
  }
  
  /**
   * 测试所有启用的提供商连接
   * @returns 是否所有提供商都连接成功
   * @author Bing
   */
  private async testAllEnabledProviders(): Promise<boolean> {
    const enabledProviders = this.plugin.settings.enabledProviders;
    if (!enabledProviders || enabledProviders.length === 0) {
      this.logger.info('没有启用的提供商，无需测试连接');
      return false;
    }
    
    this.logger.info(`测试连接前检查已启用的提供商: ${enabledProviders.join(', ')}`);
    
    // 检查提供商映射是否为空
    if (!this.plugin.storageProviders || this.plugin.storageProviders.size === 0) {
      this.logger.info('提供商映射为空，先尝试初始化提供商');
      // 在测试连接前，确保提供商已初始化
      const initialized = await this.plugin.ensureProvidersInitialized(true);
      if (!initialized) {
        this.logger.error('无法初始化提供商，测试连接失败');
        return false;
      }
      
      // 即使初始化报告成功，也要再次验证提供商映射
      if (!this.plugin.storageProviders || this.plugin.storageProviders.size === 0) {
        this.logger.error('初始化报告成功，但提供商映射仍为空');
        
        // 最后尝试：强制再次初始化提供商，不依赖先前的状态
        this.logger.info('最后尝试：强制重新初始化所有提供商');
        try {
          // 首先验证WebDAV配置是否正确
          const webdavSettings = this.plugin.settings.providerSettings?.webdav;
          const configComplete = webdavSettings?.serverUrl && 
                                 webdavSettings?.username && 
                                 webdavSettings?.password;
                                 
          if (configComplete && webdavSettings) {
            // 确保WebDAV在启用列表中
            if (!this.plugin.settings.enabledProviders.includes('webdav')) {
              this.plugin.settings.enabledProviders.push('webdav');
            }
            
            // 确保WebDAV标记为启用
            webdavSettings.enabled = true;
            
            // 确保全局同步启用
            const originalSyncEnabled = this.plugin.settings.enableSync;
            this.plugin.settings.enableSync = true;
            
            // 保存设置
            await this.plugin.saveSettings(this.plugin.settings);
            
            // 强制重新初始化
            await this.plugin.ensureProvidersInitialized(true);
            
            // 恢复原始同步设置
            this.plugin.settings.enableSync = originalSyncEnabled;
            await this.plugin.saveSettings(this.plugin.settings);
            
            // 最终检查
            if (!this.plugin.storageProviders || !this.plugin.storageProviders.has('webdav')) {
              this.logger.error('多次尝试后，WebDAV提供商仍未成功初始化');
              return false;
            } else {
              this.logger.info('最终尝试成功：WebDAV提供商已初始化');
            }
          } else {
            this.logger.error('WebDAV配置不完整，无法执行最终初始化尝试');
            return false;
          }
        } catch (error) {
          this.logger.error('最终初始化尝试失败:', error);
          return false;
        }
      }
    } else {
      this.logger.info(`当前已初始化的提供商映射中有 ${this.plugin.storageProviders.size} 个提供商`);
      
      // 检查WebDAV提供商是否存在
      if (enabledProviders.includes('webdav') && !this.plugin.storageProviders.has('webdav')) {
        this.logger.info('WebDAV在启用列表中但未在映射中找到，尝试重新初始化');
        // 在测试连接前，确保提供商已完全初始化
        await this.plugin.ensureProvidersInitialized(true);
        
        // 再次检查WebDAV是否初始化
        if (!this.plugin.storageProviders.has('webdav')) {
          this.logger.error('尝试重新初始化后，仍未能添加WebDAV提供商');
          return false;
        }
      }
    }
    
    // 再次检查提供商映射
    if (!this.plugin.storageProviders || this.plugin.storageProviders.size === 0) {
      this.logger.error('初始化提供商后映射仍为空，测试连接失败');
      return false;
    }
    
    this.logger.info('初始化后提供商映射状态:');
    for (const [key, provider] of this.plugin.storageProviders.entries()) {
      this.logger.info(`- ${key}: ${provider.getName()}`);
    }
    
    let allSuccess = true;
    
    for (const providerType of enabledProviders) {
      // 获取提供商实例
      const provider = this.plugin.storageProviders.get(providerType);
      
      if (!provider) {
        this.logger.error(`无法获取提供商实例: ${providerType}`);
        this.logger.info(`当前提供商映射中的键: [${Array.from(this.plugin.storageProviders.keys()).join(', ')}]`);
        allSuccess = false;
        continue;
      }
      
      try {
        this.logger.info(`测试提供商连接: ${providerType}`);
        const connected = await provider.testConnection();
        
        if (!connected) {
          this.logger.error(`提供商 ${providerType} 连接测试失败`);
          allSuccess = false;
        } else {
          this.logger.info(`提供商 ${providerType} 连接测试成功`);
        }
      } catch (error) {
        this.logger.error(`测试提供商 ${providerType} 连接时出错:`, error);
        allSuccess = false;
      }
    }
    
    return allSuccess;
  }

  /**
   * 验证并修复设置一致性问题
   * @returns 是否需要保存设置
   * @author Bing
   */
  private validateAndFixSettings(): boolean {
    // 由于providerManager是私有属性，无法直接访问，保留原有实现
    let needSave = false;

    this.logger.info('验证设置一致性...');

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
          this.logger.info('修复：WebDAV已启用但不在enabledProviders列表中');
          this.plugin.settings.enabledProviders.push('webdav');
          needSave = true;
        } else if (!isEnabled && isInEnabled) {
          // 修复：在列表中但未启用
          this.logger.info('修复：WebDAV在enabledProviders列表中但未启用');
          if (this.plugin.settings.providerSettings.webdav) {
            this.plugin.settings.providerSettings.webdav.enabled = true;
            needSave = true;
          }
        }
        
        // 在手动同步时，确保WebDAV已配置且已启用时，同步功能也应启用
        if (isEnabled || isInEnabled || this.plugin.settings.enabledProviders.includes('webdav')) {
          if (!this.plugin.settings.enableSync) {
            this.logger.info('修复：WebDAV已启用，但全局同步功能未开启，现自动启用全局同步');
            this.plugin.settings.enableSync = true;
            needSave = true;
          }
        }
      }
    }

    // 记录当前状态
    if (needSave) {
      this.logger.info('修复后设置状态 - 同步启用:', this.plugin.settings.enableSync);
      this.logger.info('修复后设置状态 - 启用的提供商:', this.plugin.settings.enabledProviders);
      this.logger.info('修复后设置状态 - WebDAV启用:', 
        this.plugin.settings.providerSettings.webdav?.enabled || false);
    }

    return needSave;
  }

  /**
   * 检查是否需要同步，并根据需要执行同步操作
   * @param forceInitialize 是否强制初始化提供商
   * @returns 是否成功执行了同步
   */
  async syncIfNeeded(forceInitialize: boolean = false): Promise<boolean> {
    this.logger.info('检查是否需要同步...');
    
    // 检查同步频率
    const now = new Date().getTime();
    const syncFrequency = this.plugin.settings.syncInterval || 0;
    
    // 根据同步频率决定是否需要同步
    if (syncFrequency <= 0) {
      this.logger.info('自动同步已禁用');
      return false;
    }
    
    // 检查是否正在同步中
    if (this.plugin.syncInProgress) {
      this.logger.info('同步已在进行中，跳过');
      return false;
    }
    
    // 检查网络状态（如果启用了网络检测）
    if (this.plugin.settings.networkDetection) {
      // 使用NetworkService的shouldSync方法统一判断
      if (!this.networkService.shouldSync(true)) {
        const networkType = this.networkService.getNetworkType();
        this.logger.info(`当前网络类型为${networkType}，根据网络检测设置跳过自动同步`);
        return false;
      } else {
        const networkType = this.networkService.getNetworkType();
        this.logger.info(`网络检测已启用，当前为${networkType === NetworkType.WIFI ? 'WiFi' : '以太网'}网络，继续自动同步`);
      }
    }
    
    const timeDiff = now - this.lastSyncTime;
    const syncInterval = syncFrequency * 60 * 1000; // 转换为毫秒
    
    if (timeDiff < syncInterval && !forceInitialize) {
      this.logger.info(`距离上次同步时间较短 (${Math.floor(timeDiff / 1000)}秒), 不进行同步`);
      return false;
    }
    
    // 首先验证设置一致性
    this.logger.info('同步前验证设置一致性');
    let settingsChanged = this.validateAndFixSettings();
    
    // 更主动地检查WebDAV配置，确保状态一致性
    const webdavSettings = this.plugin.settings.providerSettings.webdav;
    const webdavConfigured = 
      webdavSettings && 
      webdavSettings.serverUrl && 
      webdavSettings.username && 
      webdavSettings.password;
      
    if (webdavConfigured) {
      this.logger.info('检测到WebDAV配置完整');
      
      // 确保WebDAV在启用列表中
      if (!this.plugin.settings.enabledProviders.includes('webdav')) {
        this.logger.info('将WebDAV添加到启用列表');
        this.plugin.settings.enabledProviders.push('webdav');
        settingsChanged = true;
      }
      
      // 确保WebDAV被标记为启用
      if (webdavSettings && !webdavSettings.enabled) {
        this.logger.info('确保WebDAV标记为已启用');
        webdavSettings.enabled = true;
        settingsChanged = true;
      }
      
      // 如果WebDAV已配置但全局开关未开启，临时启用
      if (!this.plugin.settings.enableSync) {
        this.logger.info('检测到WebDAV配置完整但全局同步开关关闭，临时开启');
        forceInitialize = true;
      }
    }
    
    // 如果设置被修改，保存设置
    if (settingsChanged) {
      try {
        await this.plugin.saveSettings(this.plugin.settings);
        this.logger.info('保存了修复后的设置');
      } catch (error) {
        this.logger.error('保存设置失败:', error);
      }
    }
    
    // 确保提供商已初始化
    const initialized = await this.plugin.ensureProvidersInitialized(forceInitialize);
    if (!initialized) {
      this.logger.info('提供商初始化失败，跳过同步');
      return false;
    }
    
    // 检查是否有启用的提供商
    const providers = this.plugin.settings.enabledProviders || [];
    if (providers.length === 0) {
      this.logger.info('没有启用的存储提供商，跳过同步');
      return false;
    }
    
    // 执行同步操作
    this.logger.info('执行同步操作...');
    try {
      await this.manualSync(true);
      this.logger.info('同步成功完成');
      return true;
    } catch (error) {
      this.logger.error('同步失败:', error);
      return false;
    }
  }
} 