import { StorageProvider, FileInfo } from '@providers/common/storage-provider';
import { StorageProviderType } from '@models/plugin-settings';
import { SyncStrategyBase, LocalFileInfo } from './sync-strategy-base';
import { SyncPathUtils } from '@src/utils/sync-path-utils';
import { processMarkdownContent } from '@src/utils/markdown-processor';
import { isBinaryFileType } from '@providers/webdav/webdav-parsers';
import { normalizePath } from 'obsidian';
import CloudSyncPlugin from '@main';

/**
 * 本地到远程同步策略类
 * 实现从本地到远程存储的单向同步逻辑
 * 本地文件会覆盖远程文件
 * 支持增量和全量同步模式
 * @author Bing
 */
export class LocalToRemoteSync extends SyncStrategyBase {
  /**
   * 构造函数
   * @param plugin 插件实例
   * @author Bing
   */
  constructor(plugin: CloudSyncPlugin) {
    super(plugin);
    this.logger = plugin.logService.getModuleLogger('LocalToRemoteSync');
  }
  
  /**
   * 处理文件上传（包含加密逻辑）
   * @private
   * @param provider 存储提供商
   * @param content 文件内容
   * @param remotePath 远程路径
   * @param sourceFilePath, 源文件路径（用于日志）
   * @author Bing
   */
  private async handleUpload(
    provider: StorageProvider,
    content: string, 
    remotePath: string, 
    sourceFilePath: string
  ): Promise<void> {
    return this.handleEncryptedUpload(this.plugin, provider, content, remotePath, sourceFilePath);
  }
  
  /**
   * 处理二进制文件上传
   * @private
   * @param provider 存储提供商
   * @param content 二进制文件内容
   * @param remotePath 远程路径
   * @param sourceFilePath 源文件路径（用于日志）
   */
  private async uploadBinaryFile(
    provider: StorageProvider,
    content: ArrayBuffer,
    remotePath: string,
    sourceFilePath: string
  ): Promise<void> {
    return this.handleBinaryUpload(this.plugin, provider, content, remotePath, sourceFilePath);
  }
  
  /**
   * 确保远程基础路径存在
   * @param provider 存储提供商
   * @param providerType 提供商类型
   * @returns 是否成功确保了基础路径的存在
   * @author Bing
   */
  private async ensureRemoteBasePath(
    provider: StorageProvider,
    providerType: StorageProviderType
  ): Promise<boolean> {
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    if (!basePath) return true; // 不需要基础路径时直接返回true
    
    this.logger.info(`检查远程基础路径是否存在: ${basePath}`);
    
    try {
      // 检查远程基础路径是否存在
      const exists = await provider.folderExists(basePath);
      if (!exists) {
        this.logger.info(`远程基础路径不存在，尝试创建: ${basePath}`);
        await provider.createFolder(basePath);
        this.logger.info(`成功创建远程基础路径: ${basePath}`);
      } else {
        this.logger.info(`远程基础路径已存在: ${basePath}`);
      }
      return true;
    } catch (error) {
      this.logger.error(`无法确保远程基础路径存在: ${basePath}`, error);
      return false;
    }
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
    this.logger.info('【LocalToRemoteSync】执行本地到远程同步...');
    this.logger.info(`提供商类型: ${providerType}, 同步模式: ${this.plugin.settings.syncMode}`);
    this.logger.info('===========================================');

    if (this.plugin.settings.syncMode === 'incremental') {
      await this.syncIncremental(provider, localFiles, remoteFiles, providerType);
    } else {
      await this.syncFull(provider, localFiles, remoteFiles, providerType);
    }
  }
  
  /**
   * 检查是否为系统或不相关文件夹
   * 用于过滤不应被同步的文件夹
   * @param path 文件夹路径
   * @returns 是否为系统或不相关文件夹
   * @author Bing
   */
  private isSystemOrUnrelatedFolder(path: string): boolean {
    // 系统或特殊文件夹列表，这些文件夹不应被同步
    // 目前只包含"我的坚果云"，未来可扩展为更多类型
    const systemFolders = ['我的坚果云'];
    
    // 检查路径是否匹配任一系统文件夹
    return systemFolders.some(folder => 
      path === folder || // 完全匹配
      path.startsWith(folder + '/') // 文件夹内的子路径
    );
  }
  
  /**
   * 增量同步 - 单向（本地到远程）
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
    this.logger.info('============= 开始执行增量同步（本地到远程）=============');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    this.logger.info(`使用远程基础路径: ${basePath || '/'}`);
    
    // 确保远程基础路径存在
    const basePathExists = await this.ensureRemoteBasePath(provider, providerType);
    if (!basePathExists) {
      this.logger.warning('无法确保远程基础路径存在，同步操作可能不完整');
    }
    
    // 创建映射以加速查找
    const localFilesMap = this.createLocalFilesMap(localFiles);
    const remoteFilesMap = this.createRemoteFilesMap(remoteFiles);
    
    this.logger.info(`初始状态: 本地文件共 ${localFiles.length} 个 (${localFiles.filter(f => f.isFolder).length} 个文件夹), 远程文件共 ${remoteFiles.length} 个 (${remoteFiles.filter(f => f.isFolder).length} 个文件夹)`);
    
    // 先处理文件夹，确保所有需要的文件夹都存在
    await this.syncFolders(provider, localFiles, remoteFiles, providerType, basePath);
    
    // 然后处理文件
    await this.syncFiles(provider, localFiles, remoteFiles, providerType, basePath);
    
    this.logger.info('============= 增量同步（本地到远程）完成 =============');
  }
  
  /**
   * 全量同步 - 单向（本地到远程）
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
    // 由于全量同步在这个方向上与增量同步的实现是相同的
    // 只是需要添加删除远程多余文件的步骤
    this.logger.info('============= 开始执行全量同步（本地到远程）=============');
    
    // 先执行标准的增量同步操作
    await this.syncIncremental(provider, localFiles, remoteFiles, providerType);
    
    // 然后删除远程多余的文件
    await this.deleteRemoteExtraFiles(provider, localFiles, remoteFiles, providerType);
    
    this.logger.info('============= 全量同步（本地到远程）完成 =============');
  }
  
  /**
   * 同步文件夹
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @param basePath 远程基础路径
   * @author Bing
   */
  private async syncFolders(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType,
    basePath: string
  ): Promise<void> {
    // 提取所有本地文件夹
    const localFolders = localFiles.filter(file => file.isFolder);
    
    // 过滤掉系统和不相关文件夹
    const foldersToSync = localFolders.filter(folder => !this.isSystemOrUnrelatedFolder(folder.path));
    
    this.logger.info(`准备同步 ${foldersToSync.length} 个本地文件夹到远程`);
    
    // 按路径深度排序，确保父文件夹在子文件夹之前处理
    foldersToSync.sort((a, b) => {
      const depthA = a.path.split('/').length;
      const depthB = b.path.split('/').length;
      return depthA - depthB;
    });
    
    // 处理每个文件夹
    for (const folder of foldersToSync) {
      // 构建远程路径
      const remotePath = basePath ? `${basePath}/${folder.path}` : folder.path;
      
      try {
        // 检查远程文件夹是否存在
        const exists = await provider.folderExists(remotePath);
        
        if (!exists) {
          this.logger.info(`创建远程文件夹: ${remotePath}`);
          
          try {
            await provider.createFolder(remotePath);
            this.logger.info(`远程文件夹创建成功: ${remotePath}`);
          } catch (createError) {
            this.logger.error(`创建远程文件夹失败: ${remotePath}`, createError);
            
            // 特殊处理坚果云的错误
            if (providerType === 'webdav') {
              this.logger.warning(`尝试替代方法创建远程文件夹: ${remotePath}`);
              
              // 尝试通过上传空文件来隐式创建目录
              try {
                const dummyFilePath = remotePath + '/.folder';
                const content = '';
                await provider.uploadFile(dummyFilePath, content);
                this.logger.info(`通过创建空文件的方式创建了文件夹: ${remotePath}`);
              } catch (uploadError) {
                this.logger.error(`创建标记文件也失败: ${remotePath}`, uploadError);
              }
            }
          }
        } else {
          this.logger.info(`远程文件夹已存在: ${remotePath}`);
        }
      } catch (error) {
        this.logger.error(`处理文件夹时发生错误: ${folder.path}`, error);
      }
    }
  }
  
  /**
   * 同步文件
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @param basePath 远程基础路径
   * @author Bing
   */
  private async syncFiles(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType,
    basePath: string
  ): Promise<void> {
    // 提取所有非文件夹的本地文件
    const filesToSync = localFiles.filter(file => !file.isFolder);
    
    this.logger.info(`准备同步 ${filesToSync.length} 个本地文件到远程`);
    
    // 创建远程文件映射
    const remoteFilesMap = this.createRemoteFilesMap(remoteFiles);
    
    // 处理每个文件
    for (const file of filesToSync) {
      // 构建远程路径
      const remotePath = basePath ? `${basePath}/${file.path}` : file.path;
      
      // 检查远程文件是否存在
      const remoteFile = remoteFilesMap.get(remotePath);
      
      try {
        // 检查文件扩展名，判断是否为二进制文件
        const fileExt = file.path.split('.').pop() || '';
        const isBinary = isBinaryFileType(fileExt);
        
        // 决定是否需要上传文件
        let shouldUpload = true;
        
        if (remoteFile) {
          // 文件在远程已存在，检查修改时间
          const localMtime = new Date(file.mtime).getTime();
          const remoteMtime = remoteFile.modifiedTime.getTime();
          
          // 如果远程文件更新或相同，跳过上传
          if (remoteMtime >= localMtime) {
            this.logger.info(`远程文件已是最新或相同，跳过上传: ${file.path}`);
            shouldUpload = false;
          }
        }
        
        if (shouldUpload) {
          this.logger.info(`上传文件: ${file.path} -> ${remotePath}`);
          
          // 确保远程文件夹存在
          const remoteDirPath = remotePath.split('/').slice(0, -1).join('/');
          if (remoteDirPath) {
            const dirExists = await provider.folderExists(remoteDirPath);
            if (!dirExists) {
              this.logger.info(`创建远程文件夹: ${remoteDirPath}`);
              await provider.createFolder(remoteDirPath);
            }
          }
          
          if (isBinary) {
            // 处理二进制文件
            const binaryContent = await this.plugin.app.vault.adapter.readBinary(file.path);
            await this.uploadBinaryFile(provider, binaryContent, remotePath, file.path);
          } else {
            // 处理文本文件
            const content = await this.plugin.app.vault.adapter.read(file.path);
            
            // 特殊处理Markdown文件，转换Obsidian特有的链接格式
            let processedContent = content;
            if (file.path.toLowerCase().endsWith('.md')) {
              this.logger.info(`处理Markdown文件内容: ${file.path}`);
              processedContent = processMarkdownContent(content, '', providerType.toLowerCase());
            }
            
            await this.handleUpload(provider, processedContent, remotePath, file.path);
          }
          
          this.logger.info(`文件上传成功: ${file.path}`);
        }
      } catch (error) {
        this.logger.error(`上传文件失败: ${file.path}`, error);
      }
    }
  }
  
  /**
   * 删除远程多余文件
   * 仅在全量同步时使用
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  private async deleteRemoteExtraFiles(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void> {
    if (!this.plugin.settings.deleteRemoteExtraFiles) {
      this.logger.info('删除远程多余文件功能未启用，跳过');
      return;
    }
    
    this.logger.info('开始删除远程多余文件和文件夹...');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    
    // 创建本地文件路径集合
    const localPathSet = new Set<string>();
    for (const file of localFiles) {
      // 跳过系统或不相关文件夹
      if (file.isFolder && this.isSystemOrUnrelatedFolder(file.path)) {
        continue;
      }
      
      // 构建对应的远程路径
      const remotePath = basePath ? `${basePath}/${file.path}` : file.path;
      localPathSet.add(remotePath);
    }
    
    // 先删除多余的文件
    let deletedFilesCount = 0;
    for (const remoteFile of remoteFiles) {
      if (!remoteFile.isFolder) {
        // 检查远程文件是否在同步基础路径下
        if (basePath && !this.isPathUnderBasePath(remoteFile.path, basePath)) {
          this.logger.info(`跳过不在同步基础路径下的远程文件: ${remoteFile.path}`);
          continue;
        }
        
        // 检查本地是否有对应文件
        if (!localPathSet.has(remoteFile.path)) {
          try {
            this.logger.info(`删除远程多余文件: ${remoteFile.path}`);
            await provider.deleteFile(remoteFile.path);
            deletedFilesCount++;
          } catch (error) {
            this.logger.error(`删除远程文件失败: ${remoteFile.path}`, error);
          }
        }
      }
    }
    
    // 然后删除多余的文件夹（从深层开始）
    let deletedFoldersCount = 0;
    const remoteFolders = remoteFiles
      .filter(file => file.isFolder)
      .sort((a, b) => {
        // 按路径深度排序，深层的先处理
        const depthA = a.path.split('/').length;
        const depthB = b.path.split('/').length;
        return depthB - depthA; // 注意这里是倒序
      });
    
    for (const remoteFolder of remoteFolders) {
      // 检查远程文件夹是否在同步基础路径下
      if (basePath && !this.isPathUnderBasePath(remoteFolder.path, basePath)) {
        this.logger.info(`跳过不在同步基础路径下的远程文件夹: ${remoteFolder.path}`);
        continue;
      }
      
      // 跳过根路径或基础同步路径
      if (remoteFolder.path === '/' || remoteFolder.path === basePath) {
        this.logger.info(`跳过根路径或基础同步路径: ${remoteFolder.path}`);
        continue;
      }
      
      // 检查本地是否有对应文件夹
      if (!localPathSet.has(remoteFolder.path)) {
        try {
          this.logger.info(`删除远程多余文件夹: ${remoteFolder.path}`);
          await provider.deleteFolder(remoteFolder.path);
          deletedFoldersCount++;
        } catch (error) {
          this.logger.error(`删除远程文件夹失败: ${remoteFolder.path}`, error);
        }
      }
    }
    
    this.logger.info(`远程多余文件和文件夹删除完成，共删除 ${deletedFilesCount} 个文件和 ${deletedFoldersCount} 个文件夹`);
  }
  
  /**
   * 检查远程路径是否属于指定的同步基础路径
   * 用于确保只同步指定范围内的文件和文件夹
   * @param remotePath 远程路径
   * @param basePath 基础路径
   * @returns 是否属于指定的同步基础路径
   * @author Bing
   */
  private isPathUnderBasePath(remotePath: string, basePath: string): boolean {
    // 如果没有指定基础路径，则所有路径都认为在范围内
    if (!basePath) return true;
    
    // 确保路径格式一致，使用normalizePath清理用户定义的路径
    const normalizedRemotePath = normalizePath(remotePath);
    const normalizedBasePath = normalizePath(basePath);
    
    // 检查是否是基础路径本身或其子路径
    return normalizedRemotePath === normalizedBasePath || 
           normalizedRemotePath.startsWith(normalizedBasePath + '/');
  }
} 