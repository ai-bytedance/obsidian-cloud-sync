import { NotificationManager } from '@services/notification/notification-manager';
import { StorageProvider, FileInfo, ConnectionStatus } from '@providers/common/storage-provider';
import { StorageProviderType } from '@models/plugin-settings';
import { LocalFileInfo, SyncStrategyBase } from '@src/core/sync-strategies/sync-strategy-base';
import { LocalToRemoteSync } from '@src/core/sync-strategies/local-to-remote-sync';
import { RemoteToLocalSync } from '@src/core/sync-strategies/remote-to-local-sync';
import { BidirectionalSync } from '@src/core/sync-strategies/bidirectional-sync';
import { SyncPathUtils } from '@src/utils/sync-path-utils';
import { SyncFileFilter } from '@src/utils/sync-file-filter';
import CloudSyncPlugin from '@main';
import { LogService, ModuleLogger } from '@services/log/log-service';

/**
 * 同步引擎类
 * 负责协调各种同步策略和处理同步过程
 * @author Bing
 */
export class SyncEngine {
  private localToRemoteSync: LocalToRemoteSync;
  private remoteToLocalSync: RemoteToLocalSync;
  private bidirectionalSync: BidirectionalSync;
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
    // 初始化日志记录器
    this.logger = this.plugin.logService.getModuleLogger('SyncEngine');
    
    // 初始化同步策略
    this.localToRemoteSync = new LocalToRemoteSync(plugin);
    this.remoteToLocalSync = new RemoteToLocalSync(plugin);
    this.bidirectionalSync = new BidirectionalSync(plugin);
  }
  
  /**
   * 执行同步
   * @param isAutoSync 是否为自动同步
   * @author Bing
   */
  public async performSync(isAutoSync: boolean) {
    // 检查是否有启用的存储提供商
    if (this.plugin.storageProviders.size === 0) {
      throw new Error('未启用任何存储提供商，请先在设置中启用至少一个云盘');
    }
    
    // 对每个存储提供商执行同步
    for (const [providerType, provider] of this.plugin.storageProviders.entries()) {
      try {
        this.logger.info(`同步提供商: ${providerType} (${provider.getName()})`);
        
        // 对于手动同步，显示进度通知
        if (!isAutoSync) {
          this.notificationManager.show('sync-provider', `正在同步: ${provider.getName()}`, 30000);
        }
        
        // 添加更详细的日志，显示当前同步设置
        this.logger.info(`当前同步设置: 同步模式=${this.plugin.settings.syncMode}, 同步方向=${this.plugin.settings.syncDirection}`);
        
        // 检查连接状态
        if (provider.getStatus() !== ConnectionStatus.CONNECTED) {
          this.logger.info(`提供商 ${providerType} 未连接，尝试连接...`);
          
          let connectSuccess = false;
          let connectAttempts = 0;
          const maxConnectAttempts = 2;
          
          while (!connectSuccess && connectAttempts <= maxConnectAttempts) {
            try {
              connectSuccess = await provider.connect();
              if (connectSuccess) {
                this.logger.info(`提供商 ${providerType} 连接成功`);
              } else {
                connectAttempts++;
                this.logger.warning(`提供商 ${providerType} 连接失败 (尝试 ${connectAttempts}/${maxConnectAttempts + 1})`);
                if (connectAttempts <= maxConnectAttempts) {
                  // 等待一秒再重试
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
            } catch (connectError) {
              connectAttempts++;
              this.logger.error(`提供商 ${providerType} 连接错误 (尝试 ${connectAttempts}/${maxConnectAttempts + 1}):`, connectError);
              
              // 如果是最后一次尝试，抛出错误
              if (connectAttempts > maxConnectAttempts) {
                throw connectError;
              }
              
              // 否则等待后重试
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          
          // 再次检查连接状态
          if (provider.getStatus() !== ConnectionStatus.CONNECTED) {
            throw new Error(`无法连接到${providerType}服务，请检查网络连接和服务器地址`);
          }
        }
        
        this.logger.info(`开始同步提供商: ${providerType}`);
        
        // 获取本地文件列表
        this.logger.info('获取本地文件列表...');
        const localFiles = await this.getLocalFiles();
        this.logger.info(`本地文件数量: ${localFiles.length}`);
        
        // 确保远程根目录存在
        this.logger.info('确保远程根目录存在...');
        try {
          await this.ensureRemoteRootDir(provider);
        } catch (dirError) {
          this.logger.error('确保远程根目录存在失败:', dirError);
          
          // 对于WebDAV提供商，特别是坚果云，继续尝试
          if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
            this.logger.info('远程根目录处理失败，但尝试继续同步（坚果云可能不需要显式创建目录）');
          } else {
            throw dirError;
          }
        }
        
        // 获取远程文件列表
        const remotePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
        this.logger.info(`获取远程文件列表，路径: ${remotePath || '根目录'}...`);
        let remoteFiles: FileInfo[] = [];
        try {
          remoteFiles = await provider.listFiles(remotePath);
          this.logger.info(`远程文件数量: ${remoteFiles.length}`);
        } catch (error) {
          this.logger.error(`获取远程文件列表失败:`, error);
          
          // 尝试修复: 如果是首次同步，可能远程目录不存在，创建它
          if (error.code === 'NOT_FOUND' || error.status === 404) {
            this.logger.info('远程目录不存在，尝试创建...');
            try {
              await provider.createFolder(remotePath);
              this.logger.info('远程目录创建成功，重新获取文件列表...');
              
              // 再次尝试获取远程文件列表
              remoteFiles = await provider.listFiles(remotePath);
              this.logger.info(`远程文件数量: ${remoteFiles.length}`);
            } catch (createError) {
              this.logger.error('创建远程目录失败:', createError);
              
              // 对于坚果云，继续尝试
              if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
                this.logger.info('尝试在没有明确创建目录的情况下继续同步');
                remoteFiles = []; // 使用空数组继续
              } else {
                throw createError;
              }
            }
          } else if (error.code === 'AUTH_FAILED' || error.status === 401 || error.status === 403) {
            // 认证错误，提供更具体的错误信息
            throw new Error(`获取远程文件列表失败: 认证错误，请检查账号和密码 (${error.message || error})`);
          } else {
            // 其他类型的错误，直接抛出
            throw error;
          }
        }
        
        // 根据同步模式和同步方向执行同步
        this.logger.info(`使用同步模式: ${this.plugin.settings.syncMode}, 同步方向: ${this.plugin.settings.syncDirection}`);
        
        try {
          // 更新进度通知
          if (!isAutoSync) {
            this.notificationManager.clear('sync-provider');
            this.notificationManager.show('sync-executing', `正在执行${this.plugin.settings.syncDirection === 'bidirectional' ? '双向' : (this.plugin.settings.syncDirection === 'uploadOnly' ? '上传' : '下载')}同步...`, 30000);
          }
          
          // 将本地文件列表转换为LocalFileInfo类型
          const typedLocalFiles: LocalFileInfo[] = localFiles.map(file => ({
            path: file.path,
            mtime: file.mtime,
            size: file.size,
            isFolder: file.isFolder
          }));
          
          // 根据同步方向决定同步操作
          const syncDirection = this.plugin.settings.syncDirection;
          this.logger.info(`执行同步操作，当前同步方向: ${syncDirection}`);
          
          if (syncDirection === 'uploadOnly') {
            // 仅上传模式
            this.logger.info(`使用本地到远程同步策略 (仅上传模式)`);
            await this.localToRemoteSync.sync(provider, typedLocalFiles, remoteFiles, providerType);
          } else if (syncDirection === 'downloadOnly') {
            // 仅下载模式
            this.logger.info(`使用远程到本地同步策略 (仅下载模式)`);
            await this.remoteToLocalSync.sync(provider, typedLocalFiles, remoteFiles, providerType);
          } else {
            // 双向同步
            this.logger.info(`使用双向同步策略 (双向模式)`);
            await this.bidirectionalSync.sync(provider, typedLocalFiles, remoteFiles, providerType);
          }
          
          // 清除进度通知
          if (!isAutoSync) {
            this.notificationManager.clear('sync-executing');
          }
        } catch (syncError) {
          this.logger.error(`同步操作失败:`, syncError);
          
          // 清除进度通知
          if (!isAutoSync) {
            this.notificationManager.clear('sync-executing');
          }
          
          // 对于认证错误提供更具体的错误信息
          if (syncError.code === 'AUTH_FAILED' || syncError.status === 401 || syncError.status === 403) {
            throw new Error(`同步操作失败: 认证错误，请检查账号和密码 (${syncError.message || syncError})`);
          } else {
            throw new Error(`同步操作失败: ${syncError.message || syncError}`);
          }
        }
        
        this.logger.info(`提供商 ${providerType} 同步完成`);
      } catch (error) {
        this.logger.error(`提供商 ${providerType} 同步失败:`, error);
        
        // 清除任何进度通知
        if (!isAutoSync) {
          this.notificationManager.clear('sync-provider');
          this.notificationManager.clear('sync-executing');
        }
        
        if (!isAutoSync) {
          throw error; // 手动同步时，将错误抛出
        }
      }
    }
  }

  /**
   * 确保远程根目录存在
   * @param provider 存储提供商
   * @author Bing
   */
  private async ensureRemoteRootDir(provider: StorageProvider) {
    try {
      this.logger.info('检查远程根目录是否存在...');
      const remotePath = '';
      
      // 检查根目录是否存在，不存在则创建
      const exists = await provider.folderExists(remotePath);
      
      if (!exists) {
        this.logger.info('远程根目录不存在，尝试创建...');
        try {
          await provider.createFolder(remotePath);
          this.logger.info('远程根目录创建成功');
        } catch (createError) {
          this.logger.error('创建远程根目录失败:', createError);
          
          // 对于坚果云特殊处理，某些错误可以忽略
          if (provider.getName() === 'WebDAV' && 
              (createError.code === 'AUTH_FAILED' || createError.status === 403)) {
            this.logger.info('坚果云可能不需要显式创建根目录，继续执行...');
            return;
          }
          
          throw createError;
        }
      } else {
        this.logger.info('远程根目录已存在');
      }
    } catch (error) {
      this.logger.error('确保远程根目录存在失败:', error);
      
      // 如果是认证错误，提供更明确的提示
      if (error.code === 'AUTH_FAILED' || error.status === 401 || error.status === 403) {
        throw new Error('认证失败，请检查账号和密码设置');
      }
      
      throw error;
    }
  }

  /**
   * 获取本地文件和文件夹列表
   * @returns 本地文件列表
   * @author Bing
   */
  private async getLocalFiles(): Promise<{path: string, mtime: number, size: number, isFolder: boolean}[]> {
    const items: {path: string, mtime: number, size: number, isFolder: boolean}[] = [];
    const MAX_RECURSION_DEPTH = 50; // 最大递归深度
    const processed = new Set<string>(); // 已处理路径集合
    
    // 递归获取所有文件和文件夹
    const getFilesRecursively = async (dir: string = '', depth: number = 0) => {
      // 添加深度限制
      if (depth > MAX_RECURSION_DEPTH) {
        this.logger.warning(`达到最大递归深度 ${MAX_RECURSION_DEPTH}，停止扫描: ${dir}`);
        return;
      }
      
      // 防止重复处理同一路径
      if (processed.has(dir)) {
        this.logger.warning(`检测到重复路径: ${dir}，跳过处理`);
        return;
      }
      
      processed.add(dir);
      
      const dirItems = await this.plugin.app.vault.adapter.list(dir);
      
      // 处理文件
      for (const file of dirItems.files) {
        // 检查是否在忽略列表中
        const filePath = { path: file };
        if (SyncFileFilter.shouldExcludeFile(filePath, this.plugin.settings)) {
          continue;
        }
        
        try {
          const stat = await this.plugin.app.vault.adapter.stat(file);
          if (stat) {
            items.push({
              path: file,
              mtime: stat.mtime,
              size: stat.size,
              isFolder: false
            });
          }
        } catch (e) {
          this.logger.error(`无法获取文件信息: ${file}`, e);
        }
      }
      
      // 递归处理子目录
      for (const folder of dirItems.folders) {
        // 检查是否在忽略列表中
        const folderPath = { path: folder };
        if (SyncFileFilter.shouldExcludeFile(folderPath, this.plugin.settings)) {
          continue;
        }
        
        try {
          // 添加文件夹本身
          const folderStat = await this.plugin.app.vault.adapter.stat(folder);
          if (folderStat) {
            items.push({
              path: folder,
              mtime: folderStat.mtime,
              size: 0, // 文件夹大小为0
              isFolder: true
            });
          }
        } catch (e) {
          this.logger.error(`无法获取文件夹信息: ${folder}`, e);
          // 即使获取统计信息失败，仍然添加文件夹以确保同步
          items.push({
            path: folder,
            mtime: Date.now(),
            size: 0,
            isFolder: true
          });
        }
        
        // 继续递归处理此文件夹，传递增加的深度值
        await getFilesRecursively(folder, depth + 1);
      }
    };
    
    await getFilesRecursively();
    
    // 增强日志输出，显示扫描到的文件夹
    const folders = items.filter(item => item.isFolder);
    this.logger.info(`本地文件扫描完成，共发现 ${items.length} 个文件，其中 ${folders.length} 个文件夹，最大递归深度: ${MAX_RECURSION_DEPTH}`);
    
    if (folders.length > 0) {
      this.logger.debug('本地文件夹列表:');
      for (const folder of folders) {
        this.logger.debug(`- ${folder.path}`);
      }
    }
    
    return items;
  }
} 