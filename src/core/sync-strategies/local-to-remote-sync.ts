import { StorageProvider, FileInfo } from '@providers/common/storage-provider';
import { StorageProviderType } from '@models/plugin-settings';
import { SyncStrategyBase, LocalFileInfo } from './sync-strategy-base';
import { SyncPathUtils } from '@src/utils/sync-path-utils';
import { processMarkdownContent } from '@src/utils/markdown-processor';
import { isBinaryFileType } from '@providers/webdav/webdav-parsers';
import CloudSyncPlugin from '@main';

/**
 * 本地到远程同步策略类
 * 实现将本地文件同步到远程存储的逻辑
 * 支持增量和全量同步模式
 * @author Bing
 */
export class LocalToRemoteSync extends SyncStrategyBase {
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
    console.log('===========================================');
    console.log('【LocalToRemoteSync】执行仅上传同步...');
    console.log(`提供商类型: ${providerType}, 同步模式: ${this.plugin.settings.syncMode}`);
    console.log('===========================================');
    
    if (this.plugin.settings.syncMode === 'incremental') {
      await this.syncIncremental(provider, localFiles, remoteFiles, providerType);
    } else {
      await this.syncFull(provider, localFiles, remoteFiles, providerType);
    }
  }
  
  /**
   * 增量同步 - 本地到远程
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
    console.log('执行增量同步（本地到远程）');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    
    // 过滤出需要同步的本地文件（只同步已修改的文件）
    const filteredLocalFiles = localFiles.filter(localFile => {
      if (localFile.isFolder) return true; // 文件夹始终同步

      // 在远程文件中查找对应文件
      const remotePath = basePath ? `${basePath}/${localFile.path}` : localFile.path;
      const remoteFile = remoteFiles.find(rf => rf.path === remotePath);
      
      // 如果远程文件不存在，或者本地文件比远程文件新，则需要同步
      if (!remoteFile) return true;
      
      // 比较修改时间
      const localMtime = new Date(localFile.mtime).getTime();
      const remoteMtime = remoteFile.modifiedTime.getTime();
      
      // 如果本地文件更新，则需要同步
      return localMtime > remoteMtime;
    });
    
    console.log(`本地文件总数: ${localFiles.length}, 需要同步的文件数: ${filteredLocalFiles.length}`);
    
    // 使用过滤后的文件列表调用原有的同步方法
    await this.syncLocalToRemote(provider, filteredLocalFiles, remoteFiles, providerType);
  }
  
  /**
   * 全量同步 - 本地到远程
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
    console.log('执行全量同步（本地到远程）');
    // 全量同步直接使用所有文件
    await this.syncLocalToRemote(provider, localFiles, remoteFiles, providerType);
  }
  
  /**
   * 本地到远程同步
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  private async syncLocalToRemote(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void> {
    console.log('执行本地到远程同步');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    
    // 创建远程路径集合，用于判断是否需要删除
    const localPathSet = new Set<string>();
    
    // 创建远程文件映射
    const remoteFilesMap = this.createRemoteFilesMap(remoteFiles);
    
    // 先处理文件夹，确保所有文件夹都存在
    for (const localFile of localFiles.filter(f => f.isFolder)) {
      const remotePath = SyncPathUtils.joinPaths(basePath, localFile.path);
      localPathSet.add(remotePath);
      
      try {
        // 确保远程文件夹存在
        if (!await provider.folderExists(remotePath)) {
          console.log(`创建远程文件夹: ${remotePath}`);
          await provider.createFolder(remotePath);
        } else {
          console.log(`远程文件夹已存在: ${remotePath}`);
        }
      } catch (error) {
        console.error(`创建远程文件夹失败: ${remotePath}`, error);
      }
    }
    
    // 然后处理文件，上传文件
    for (const localFile of localFiles.filter(f => !f.isFolder)) {
      const localPath = localFile.path;
      const remotePath = SyncPathUtils.joinPaths(basePath, localPath);
      
      localPathSet.add(remotePath);
      
      const remoteFile = remoteFilesMap.get(remotePath);
      
      try {
        if (!remoteFile || new Date(localFile.mtime).getTime() > remoteFile.modifiedTime.getTime()) {
          // 本地文件新于远程，或远程不存在，上传本地文件
          
          // 检查文件扩展名，判断是否为二进制文件
          const fileExt = localPath.split('.').pop() || '';
          const isBinary = isBinaryFileType(fileExt);
          
          if (isBinary) {
            // 二进制文件（图片等）使用二进制读取
            console.log(`处理二进制文件: ${localPath}`);
            const binaryContent = await this.plugin.app.vault.adapter.readBinary(localFile.path);
            
            // 对二进制内容进行特殊处理
            await this.handleBinaryUpload(this.plugin, provider, binaryContent, remotePath, localFile.path);
            console.log(`上传二进制文件: ${localFile.path} 到 ${remotePath}`);
          } else {
            // 文本文件使用文本读取
            const content = await this.plugin.app.vault.adapter.read(localFile.path);
            
            // 特殊处理Markdown文件，转换Obsidian特有的链接格式
            let processedContent = content;
            if (localFile.path.toLowerCase().endsWith('.md')) {
              console.log(`处理Markdown文件内容: ${localFile.path}`);
              processedContent = processMarkdownContent(content, '', providerType.toLowerCase());
            }
            
            // 使用带加密功能的上传方法
            await this.handleEncryptedUpload(this.plugin, provider, processedContent, remotePath, localFile.path);
            console.log(`上传文本文件: ${localFile.path} 到 ${remotePath}`);
          }
        }
      } catch (error) {
        console.error(`上传文件失败: ${localFile.path} -> ${remotePath}`, error);
        throw error;
      }
    }
    
    // 如果启用了删除远程多余文件，删除本地不存在但远程存在的文件和文件夹
    if (this.plugin.settings.deleteRemoteExtraFiles) {
      console.log('检查并删除远程多余文件和文件夹...');
      
      // 先删除远程多余文件
      for (const remoteFile of remoteFiles) {
        if (!remoteFile.isFolder && !localPathSet.has(remoteFile.path)) {
          try {
            console.log(`准备删除远程多余文件: ${remoteFile.path}`);
            await provider.deleteFile(remoteFile.path);
            console.log(`删除远程多余文件成功: ${remoteFile.path}`);
          } catch (error) {
            // 特别处理坚果云
            if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
              console.warn(`删除坚果云文件失败，但继续处理后续文件: ${remoteFile.path}`, error);
              // 对于坚果云，不中断整个同步过程
              continue;
            } else {
              console.error(`删除远程文件失败: ${remoteFile.path}`, error);
              // 对于非坚果云，可以考虑抛出错误中断同步
              // throw error;
              // 但为了保持兼容性，这里还是继续处理下一个文件
            }
          }
        }
      }
      
      // 提取所有远程文件夹并按深度排序（先删除深层文件夹）
      const remoteFolders = remoteFiles
        .filter(file => file.isFolder)
        .sort((a, b) => {
          // 按路径深度排序，深层的先处理
          const depthA = a.path.split('/').length;
          const depthB = b.path.split('/').length;
          return depthB - depthA; // 注意这里是倒序
        });
      
      // 然后删除远程多余文件夹
      for (const remoteFolder of remoteFolders) {
        // 跳过删除根路径或基础同步路径
        if (remoteFolder.path === basePath || remoteFolder.path === basePath + '/') {
          console.log(`跳过删除基础同步路径: ${remoteFolder.path}`);
          continue;
        }
        
        if (!localPathSet.has(remoteFolder.path)) {
          try {
            console.log(`准备删除远程多余文件夹: ${remoteFolder.path}`);
            await provider.deleteFolder(remoteFolder.path);
            console.log(`删除远程多余文件夹成功: ${remoteFolder.path}`);
          } catch (error) {
            // 特别处理坚果云
            if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
              console.warn(`删除坚果云文件夹失败，但继续处理后续文件: ${remoteFolder.path}`, error);
              // 对于坚果云，不中断整个同步过程
              continue;
            } else {
              console.error(`删除远程文件夹失败: ${remoteFolder.path}`, error);
              // 对于非坚果云，继续处理下一个文件夹
            }
          }
        }
      }
      
      console.log('远程多余文件和文件夹清理完成');
    }
  }
} 