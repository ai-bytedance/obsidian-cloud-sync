import { StorageProvider, FileInfo } from '@providers/common/storage-provider';
import { StorageProviderType } from '@models/plugin-settings';
import { SyncStrategyBase, LocalFileInfo } from './sync-strategy-base';
import { SyncPathUtils } from '@src/utils/sync-path-utils';
import CloudSyncPlugin from '@main';

/**
 * 远程到本地同步策略类
 * 实现将远程存储文件同步到本地的逻辑
 * 支持增量和全量同步模式
 * @author Bing
 */
export class RemoteToLocalSync extends SyncStrategyBase {
  /**
   * 构造函数
   * @param plugin 插件实例
   * @author Bing
   */
  constructor(plugin: CloudSyncPlugin) {
    super(plugin);
    this.logger = plugin.logService.getModuleLogger('RemoteToLocalSync');
  }
  
  /**
   * 执行同步
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  async sync(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void> {
    this.logger.info('===========================================');
    this.logger.info('【RemoteToLocalSync】执行远程到本地同步...');
    this.logger.info(`提供商类型: ${providerType}, 同步模式: ${this.plugin.settings.syncMode}`);
    this.logger.info('===========================================');
    
    if (this.plugin.settings.syncMode === 'incremental') {
      await this.syncIncremental(provider, localFiles, remoteFiles, providerType);
    } else {
      await this.syncFull(provider, localFiles, remoteFiles, providerType);
    }
  }
  
  /**
   * 增量同步 - 远程到本地
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  private async syncIncremental(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void> {
    this.logger.info('============= 开始执行增量同步（远程到本地）=============');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    
    // 构建映射用于快速比较
    const localFilesMap = this.createLocalFilesMap(localFiles);
    
    // 过滤出需要同步的远程文件（只同步已修改的文件）
    const filteredRemoteFiles = remoteFiles.filter(remoteFile => {
      if (remoteFile.isFolder) {
        this.logger.info(`包含文件夹(始终同步): ${remoteFile.path}`);
        return true; // 文件夹始终同步
      }
      
      // 使用路径映射工具处理路径
      let localPath = SyncPathUtils.mapRemotePathToLocal(remoteFile.path, basePath);
      this.logger.info(`远程路径映射到本地路径: ${remoteFile.path} -> ${localPath || '(空路径)'}`);
      // 处理空路径情况
      if (localPath === '') {
        this.logger.info(`远程路径映射为空，使用文件名作为本地路径: ${remoteFile.name || remoteFile.path}`);
        localPath = remoteFile.name || remoteFile.path;
      }
      
      // 在本地文件中查找对应文件
      const localFile = localFilesMap.get(localPath);
      
      // 如果本地文件不存在，或者远程文件比本地文件新，则需要同步
      if (!localFile) {
        this.logger.info(`本地不存在文件，需要下载: ${localPath}`);
        return true;
      }
      
      // 比较修改时间
      const localMtime = new Date(localFile.mtime).getTime();
      const remoteMtime = remoteFile.modifiedTime.getTime();
      
      // 如果远程文件更新，则需要同步
      if (remoteMtime > localMtime) {
        this.logger.info(`远程文件更新，需要下载: ${remoteFile.path} (远程: ${remoteMtime}, 本地: ${localMtime})`);
        return true;
      } else {
        this.logger.info(`跳过文件(已存在且未修改): ${remoteFile.path} (远程: ${remoteMtime}, 本地: ${localMtime})`);
        return false;
      }
    });
    
    this.logger.info(`远程文件总数: ${remoteFiles.length}, 需要同步的文件数: ${filteredRemoteFiles.length}`);
    
    // 使用过滤后的文件列表调用原有的同步方法
    await this.syncRemoteToLocal(provider, localFiles, filteredRemoteFiles, providerType);
  }
  
  /**
   * 全量同步 - 远程到本地
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  private async syncFull(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void> {
    this.logger.info('============= 开始执行全量同步（远程到本地）=============');
    // 全量同步直接使用所有文件
    await this.syncRemoteToLocal(provider, localFiles, remoteFiles, providerType);
  }
  
  /**
   * 远程到本地同步
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  private async syncRemoteToLocal(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void> {
    this.logger.info('执行远程到本地同步');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    this.logger.info(`使用远程根路径: ${basePath || '/'}`);
    
    // 转换为Map便于查找
    const localFilesMap = this.createLocalFilesMap(localFiles);
    
    // 先处理远程文件夹，确保本地存在对应的文件夹结构
    this.logger.info('处理远程文件夹...');
    const remoteFolders = remoteFiles.filter(file => file.isFolder);
    
    // 按路径深度排序，确保父文件夹在子文件夹之前处理
    remoteFolders.sort((a, b) => {
      const depthA = a.path.split('/').length;
      const depthB = b.path.split('/').length;
      return depthA - depthB;
    });
    
    // 创建本地文件夹
    for (const remoteFolder of remoteFolders) {
      // 使用新的路径映射方法来正确处理远程文件夹路径
      let localFolderPath = SyncPathUtils.mapRemotePathToLocal(remoteFolder.path, basePath);
      // 如果返回空字符串（表示是基础路径本身），则跳过
      if (localFolderPath === '') {
        this.logger.info(`跳过基础路径本身: ${remoteFolder.path}`);
        continue;
      }
      this.logger.info(`远程文件夹路径映射到本地: ${remoteFolder.path} -> ${localFolderPath}`);
      
      // 检查本地是否已存在该文件夹
      try {
        const exists = await this.plugin.app.vault.adapter.exists(localFolderPath);
        if (!exists) {
          this.logger.info(`创建本地文件夹: ${localFolderPath}`);
          
          // 确保父文件夹存在
          const parentPath = localFolderPath.split('/').slice(0, -1).join('/');
          if (parentPath && parentPath !== localFolderPath) {
            this.logger.info(`确保父文件夹存在: ${parentPath}`);
            try {
              const parentExists = await this.plugin.app.vault.adapter.exists(parentPath);
              if (!parentExists) {
                this.logger.info(`创建父文件夹: ${parentPath}`);
                await this.plugin.app.vault.adapter.mkdir(parentPath);
              }
            } catch (parentError) {
              this.logger.error(`创建父文件夹失败: ${parentPath}`, parentError);
            }
          }
          
          await this.plugin.app.vault.adapter.mkdir(localFolderPath);
        } else {
          this.logger.info(`本地文件夹已存在: ${localFolderPath}`);
        }
      } catch (error) {
        this.logger.error(`创建本地文件夹失败: ${localFolderPath}`, error);
      }
    }
    
    // 然后处理每个远程文件
    this.logger.info('处理远程文件...');
    // 记录所有需要下载的文件，以便输出详细统计
    let downloadedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const remoteFile of remoteFiles) {
      // 跳过文件夹，已在上面处理
      if (remoteFile.isFolder) continue;
      
      // 使用新的路径映射方法来正确处理远程文件路径
      let localPath = SyncPathUtils.mapRemotePathToLocal(remoteFile.path, basePath);
      this.logger.info(`远程文件路径映射到本地: ${remoteFile.path} -> ${localPath || '(空路径)'}`);
      // 如果返回空字符串（表示是基础路径本身但它是一个文件），这种情况很少见，但为安全起见处理它
      if (localPath === '') {
        this.logger.info(`远程文件路径映射为空，使用文件名作为本地路径: ${remoteFile.name}`);
        localPath = remoteFile.name;
      }
      
      const localFile = localFilesMap.get(localPath);
      // 检查文件扩展名，便于调试
      const fileExt = localPath.split('.').pop()?.toLowerCase() || '无扩展名';
      this.logger.info(`处理远程文件: ${remoteFile.path}, 本地路径: ${localPath}, 文件类型: ${fileExt}, 大小: ${remoteFile.size} 字节`);
      
      try {
        // 检查是否需要下载
        let needDownload = false;
        if (!localFile) {
          this.logger.info(`本地文件不存在，需要下载: ${localPath}`);
          needDownload = true;
        } else if (remoteFile.modifiedTime.getTime() > new Date(localFile.mtime).getTime()) {
          this.logger.info(`远程文件更新时间(${remoteFile.modifiedTime.toISOString()})比本地(${new Date(localFile.mtime).toISOString()})新，需要下载`);
          needDownload = true;
        } else {
          this.logger.info(`本地文件已是最新，无需下载: ${localPath}`);
          skippedCount++;
          continue;
        }
        
        if (needDownload) {
          // 确保目录存在
          const localDir = localPath.split('/').slice(0, -1).join('/');
          if (localDir) {
            const dirExists = await this.plugin.app.vault.adapter.exists(localDir);
            if (!dirExists) {
              this.logger.info(`创建本地目录: ${localDir}`);
              await this.plugin.app.vault.adapter.mkdir(localDir);
            }
          }
          
          // 下载文件
          this.logger.info(`下载文件: ${remoteFile.path} -> ${localPath}`);
          
          // 使用带解密功能的下载方法
          await this.handleEncryptedDownload(this.plugin, provider, remoteFile.path, localPath);
          
          downloadedCount++;
          this.logger.info(`下载成功: ${localPath}`);
        }
      } catch (error) {
        errorCount++;
        this.logger.error(`下载文件失败: ${remoteFile.path} -> ${localPath}`, error);
      }
    }
    
    // 如果启用了删除本地多余文件，删除远程不存在但本地存在的文件
    if (this.plugin.settings.deleteLocalExtraFiles) {
      await this.deleteLocalExtraFiles(provider, localFiles, remoteFiles, providerType);
    }
    
    // 输出统计信息
    this.logger.info(`同步完成，统计信息:`);
    this.logger.info(`- 下载文件数: ${downloadedCount}`);
    this.logger.info(`- 跳过文件数: ${skippedCount}`);
    this.logger.info(`- 失败文件数: ${errorCount}`);
  }
  
  /**
   * 删除本地多余文件
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  private async deleteLocalExtraFiles(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void> {
    this.logger.info('开始删除本地多余文件和文件夹...');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    
    // 创建远程文件路径集合
    const remotePathSet = new Set<string>();
    for (const remoteFile of remoteFiles) {
      // 使用新的路径映射方法处理远程路径
      let localPath = SyncPathUtils.mapRemotePathToLocal(remoteFile.path, basePath);
      // 如果是空路径（基础路径本身），跳过添加到集合
      if (localPath === '') {
        this.logger.info(`远程路径是基础路径本身，跳过添加到remotePathSet: ${remoteFile.path}`);
        continue; // 跳过此文件
      } else {
        this.logger.info(`远程路径映射到本地路径: ${remoteFile.path} -> ${localPath}`);
        remotePathSet.add(localPath);
      }
    }
    
    // 先删除多余的文件
    let deletedFilesCount = 0;
    for (const localFile of localFiles) {
      if (!localFile.isFolder && !remotePathSet.has(localFile.path)) {
        try {
          this.logger.info(`删除本地多余文件: ${localFile.path}`);
          await this.plugin.app.vault.adapter.remove(localFile.path);
          deletedFilesCount++;
        } catch (error) {
          this.logger.error(`删除本地文件失败: ${localFile.path}`, error);
        }
      }
    }
    
    // 按深度排序本地文件夹（先删除深层文件夹）
    const localFolders = localFiles
      .filter(file => file.isFolder)
      .sort((a, b) => {
        // 按路径深度排序，深层的先处理
        const depthA = a.path.split('/').length;
        const depthB = b.path.split('/').length;
        return depthB - depthA; // 注意这里是倒序
      });
    
    // 删除多余的文件夹
    let deletedFoldersCount = 0;
    for (const localFolder of localFolders) {
      if (!remotePathSet.has(localFolder.path)) {
        try {
          // 检查文件夹是否为空
          const folderContents = await this.plugin.app.vault.adapter.list(localFolder.path);
          if (folderContents.files.length === 0 && folderContents.folders.length === 0) {
            this.logger.info(`删除本地空文件夹: ${localFolder.path}`);
            await this.plugin.app.vault.adapter.rmdir(localFolder.path, true);
            deletedFoldersCount++;
          } else {
            this.logger.info(`本地文件夹不为空，跳过删除: ${localFolder.path}`);
          }
        } catch (error) {
          this.logger.error(`删除本地文件夹失败: ${localFolder.path}`, error);
        }
      }
    }
    
    this.logger.info(`本地多余文件和文件夹删除完成，共删除 ${deletedFilesCount} 个文件和 ${deletedFoldersCount} 个文件夹`);
  }
} 