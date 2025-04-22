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
  constructor(private plugin: CloudSyncPlugin) {
    super();
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
    console.log('执行增量同步（远程到本地）');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    
    // 构建映射用于快速比较
    const localFilesMap = this.createLocalFilesMap(localFiles);
    
    // 过滤出需要同步的远程文件（只同步已修改的文件）
    const filteredRemoteFiles = remoteFiles.filter(remoteFile => {
      if (remoteFile.isFolder) {
        console.log(`包含文件夹(始终同步): ${remoteFile.path}`);
        return true; // 文件夹始终同步
      }
      
      // 使用路径映射工具处理路径
      let localPath = SyncPathUtils.mapRemotePathToLocal(remoteFile.path, basePath);
      console.log(`远程路径映射到本地路径: ${remoteFile.path} -> ${localPath || '(空路径)'}`);
      // 处理空路径情况
      if (localPath === '') {
        console.log(`远程路径映射为空，使用文件名作为本地路径: ${remoteFile.name || remoteFile.path}`);
        localPath = remoteFile.name || remoteFile.path;
      }
      
      // 在本地文件中查找对应文件
      const localFile = localFilesMap.get(localPath);
      
      // 如果本地文件不存在，或者远程文件比本地文件新，则需要同步
      if (!localFile) {
        console.log(`本地不存在文件，需要下载: ${localPath}`);
        return true;
      }
      
      // 比较修改时间
      const localMtime = new Date(localFile.mtime).getTime();
      const remoteMtime = remoteFile.modifiedTime.getTime();
      
      // 如果远程文件更新，则需要同步
      if (remoteMtime > localMtime) {
        console.log(`远程文件更新，需要下载: ${remoteFile.path} (远程: ${remoteMtime}, 本地: ${localMtime})`);
        return true;
      } else {
        console.log(`跳过文件(已存在且未修改): ${remoteFile.path} (远程: ${remoteMtime}, 本地: ${localMtime})`);
        return false;
      }
    });
    
    console.log(`远程文件总数: ${remoteFiles.length}, 需要同步的文件数: ${filteredRemoteFiles.length}`);
    
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
    console.log('执行全量同步（远程到本地）');
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
    console.log('执行远程到本地同步');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    console.log(`使用远程根路径: ${basePath || '/'}`);
    
    // 转换为Map便于查找
    const localFilesMap = this.createLocalFilesMap(localFiles);
    
    // 先处理远程文件夹，确保本地存在对应的文件夹结构
    console.log('处理远程文件夹...');
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
        console.log(`跳过基础路径本身: ${remoteFolder.path}`);
        continue;
      }
      console.log(`远程文件夹路径映射到本地: ${remoteFolder.path} -> ${localFolderPath}`);
      
      // 检查本地是否已存在该文件夹
      try {
        const exists = await this.plugin.app.vault.adapter.exists(localFolderPath);
        if (!exists) {
          console.log(`创建本地文件夹: ${localFolderPath}`);
          
          // 确保父文件夹存在
          const parentPath = localFolderPath.split('/').slice(0, -1).join('/');
          if (parentPath && parentPath !== localFolderPath) {
            console.log(`确保父文件夹存在: ${parentPath}`);
            try {
              const parentExists = await this.plugin.app.vault.adapter.exists(parentPath);
              if (!parentExists) {
                console.log(`创建父文件夹: ${parentPath}`);
                await this.plugin.app.vault.adapter.mkdir(parentPath);
              }
            } catch (parentError) {
              console.error(`创建父文件夹失败: ${parentPath}`, parentError);
            }
          }
          
          await this.plugin.app.vault.adapter.mkdir(localFolderPath);
        } else {
          console.log(`本地文件夹已存在: ${localFolderPath}`);
        }
      } catch (error) {
        console.error(`创建本地文件夹失败: ${localFolderPath}`, error);
      }
    }
    
    // 然后处理每个远程文件
    console.log('处理远程文件...');
    // 记录所有需要下载的文件，以便输出详细统计
    let downloadedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const remoteFile of remoteFiles) {
      // 跳过文件夹，已在上面处理
      if (remoteFile.isFolder) continue;
      
      // 使用新的路径映射方法来正确处理远程文件路径
      let localPath = SyncPathUtils.mapRemotePathToLocal(remoteFile.path, basePath);
      console.log(`远程文件路径映射到本地: ${remoteFile.path} -> ${localPath || '(空路径)'}`);
      // 如果返回空字符串（表示是基础路径本身但它是一个文件），这种情况很少见，但为安全起见处理它
      if (localPath === '') {
        console.log(`远程文件路径映射为空，使用文件名作为本地路径: ${remoteFile.name}`);
        localPath = remoteFile.name;
      }
      
      const localFile = localFilesMap.get(localPath);
      // 检查文件扩展名，便于调试
      const fileExt = localPath.split('.').pop()?.toLowerCase() || '无扩展名';
      console.log(`处理远程文件: ${remoteFile.path}, 本地路径: ${localPath}, 文件类型: ${fileExt}, 大小: ${remoteFile.size} 字节`);
      
      try {
        // 检查是否需要下载
        let needDownload = false;
        if (!localFile) {
          console.log(`本地文件不存在，需要下载: ${localPath}`);
          needDownload = true;
        } else if (remoteFile.modifiedTime.getTime() > new Date(localFile.mtime).getTime()) {
          console.log(`远程文件更新时间(${remoteFile.modifiedTime.toISOString()})比本地(${new Date(localFile.mtime).toISOString()})新，需要下载`);
          needDownload = true;
        } else {
          console.log(`本地文件已是最新，无需下载: ${localPath}`);
          skippedCount++;
          continue;
        }
        
        if (needDownload) {
          console.log(`下载文件: ${remoteFile.path} -> ${localPath}`);
          
          if (provider.downloadFileContent) {
            // 确保父目录存在
            const dirPath = localPath.split('/').slice(0, -1).join('/');
            if (dirPath) {
              try {
                const dirExists = await this.plugin.app.vault.adapter.exists(dirPath);
                if (!dirExists) {
                  console.log(`创建父目录: ${dirPath}`);
                  await this.plugin.app.vault.adapter.mkdir(dirPath);
                }
              } catch (dirError) {
                console.error(`创建父目录失败: ${dirPath}`, dirError);
                errorCount++;
                continue;
              }
            }
            
            // 下载文件内容
            const content = await provider.downloadFileContent(remoteFile.path);
            
            // 写入本地文件
            if (typeof content === 'string') {
              await this.plugin.app.vault.adapter.write(localPath, content);
            } else {
              await this.plugin.app.vault.adapter.writeBinary(localPath, content);
            }
            
            downloadedCount++;
            console.log(`文件下载成功: ${remoteFile.path} -> ${localPath}`);
          } else {
            console.error(`提供商不支持直接下载文件内容: ${provider.getName()}`);
            errorCount++;
          }
        }
      } catch (error) {
        console.error(`下载文件失败: ${remoteFile.path} -> ${localPath}`, error);
        errorCount++;
      }
    }
    
    console.log(`下载统计: 已下载 ${downloadedCount} 个文件, 跳过 ${skippedCount} 个文件, 失败 ${errorCount} 个文件`);
    
    // 如果启用了删除本地多余文件，删除远程不存在但本地存在的文件
    if (this.plugin.settings.deleteLocalExtraFiles) {
      console.log('检查并删除本地多余文件和文件夹...');
      
      // 统计所有远程文件路径
      const remotePathSet = new Set<string>();
      for (const file of remoteFiles) {
        // 使用路径映射工具处理路径
        let localPath = SyncPathUtils.mapRemotePathToLocal(file.path, basePath);
        // 处理空路径情况
        if (localPath === '') {
          console.log(`远程文件是基础路径本身，使用文件名作为本地路径: ${file.name || file.path}`);
          localPath = file.name || file.path;
        }
        remotePathSet.add(localPath);
      }
      
      // 删除本地多余文件
      for (const localFile of localFiles) {
        if (!localFile.isFolder && !remotePathSet.has(localFile.path)) {
          try {
            console.log(`准备删除本地多余文件: ${localFile.path}`);
            await this.plugin.app.vault.adapter.remove(localFile.path);
            console.log(`删除本地多余文件成功: ${localFile.path}`);
          } catch (error) {
            console.error(`删除本地文件失败: ${localFile.path}`, error);
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
      
      // 删除本地多余文件夹
      for (const localFolder of localFolders) {
        if (!remotePathSet.has(localFolder.path)) {
          try {
            // 检查文件夹是否为空
            const folderContents = await this.plugin.app.vault.adapter.list(localFolder.path);
            if (folderContents.files.length === 0 && folderContents.folders.length === 0) {
              console.log(`准备删除本地空文件夹: ${localFolder.path}`);
              await this.plugin.app.vault.adapter.rmdir(localFolder.path, true);
              console.log(`删除本地空文件夹成功: ${localFolder.path}`);
            } else {
              console.log(`本地文件夹不为空，跳过删除: ${localFolder.path}`);
            }
          } catch (error) {
            console.error(`删除本地文件夹失败: ${localFolder.path}`, error);
          }
        }
      }
      
      console.log('本地多余文件和文件夹清理完成');
    }
  }
} 