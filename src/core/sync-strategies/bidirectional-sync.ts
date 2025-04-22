import { StorageProvider, FileInfo, FileMetadata } from '@providers/common/storage-provider';
import { StorageProviderType } from '@models/plugin-settings';
import { SyncStrategyBase, LocalFileInfo } from './sync-strategy-base';
import { SyncPathUtils } from '@src/utils/sync-path-utils';
import CloudSyncPlugin from '@main';

/**
 * 双向同步策略类
 * 实现本地和远程存储间的双向同步逻辑
 * 包含冲突检测和解决机制
 * 支持增量和全量同步模式
 * @author Bing
 */
export class BidirectionalSync extends SyncStrategyBase {
  /**
   * 构造函数
   * @param plugin 插件实例
   * @author Bing
   */
  constructor(private plugin: CloudSyncPlugin) {
    super();
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
    
    console.log(`检查远程基础路径是否存在: ${basePath}`);
    
    try {
      // 检查远程基础路径是否存在
      const exists = await provider.folderExists(basePath);
      if (!exists) {
        console.log(`远程基础路径不存在，尝试创建: ${basePath}`);
        await provider.createFolder(basePath);
        console.log(`成功创建远程基础路径: ${basePath}`);
      } else {
        console.log(`远程基础路径已存在: ${basePath}`);
      }
      return true;
    } catch (error) {
      console.error(`无法确保远程基础路径存在: ${basePath}`, error);
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
   * 增量同步 - 双向
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
    console.log('============= 开始执行增量同步（双向）=============');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    console.log(`使用远程基础路径: ${basePath || '/'}`);
    
    // 确保远程基础路径存在
    const basePathExists = await this.ensureRemoteBasePath(provider, providerType);
    if (!basePathExists) {
      console.warn('无法确保远程基础路径存在，同步操作可能不完整');
      // 继续执行，但已发出警告
    }
    
    // 创建映射以加速查找
    const localFilesMap = this.createLocalFilesMap(localFiles);
    const remoteFilesMap = this.createRemoteFilesMap(remoteFiles);
    
    console.log(`初始状态: 本地文件共 ${localFiles.length} 个 (${localFiles.filter(f => f.isFolder).length} 个文件夹), 远程文件共 ${remoteFiles.length} 个 (${remoteFiles.filter(f => f.isFolder).length} 个文件夹)`);
    
    // 本地文件对应的远程路径集合 (用于检测远程已删除的文件)
    const localPathSet = new Set<string>();
    
    // 创建本地文件夹和收集本地文件夹路径
    const localFoldersSet = new Set<string>();
    console.log('收集所有本地文件夹路径...');
    
    for (const localFile of localFiles) {
      if (localFile.isFolder) {
        // 过滤不相关的文件夹，避免同步
        if (this.isSystemOrUnrelatedFolder(localFile.path)) {
          console.log(`跳过系统或不相关文件夹: ${localFile.path}`);
          continue;
        }
        
        localFoldersSet.add(localFile.path);
        console.log(`记录现有本地文件夹: ${localFile.path}`);
        
        // 构建远程路径，将其添加到localPathSet
        const remotePath = basePath ? `${basePath}/${localFile.path}` : localFile.path;
        localPathSet.add(remotePath);
        console.log(`添加到本地路径集合: ${remotePath}`);
      } else {
        // 对于普通文件，也添加到路径集合
        const remotePath = basePath ? `${basePath}/${localFile.path}` : localFile.path;
        localPathSet.add(remotePath);
      }
    }
    
    // 统计并记录本地文件夹数量
    console.log(`共发现 ${localFoldersSet.size} 个本地文件夹，已添加到路径集合`);
    if (localFoldersSet.size > 0) {
      console.log('所有本地文件夹:');
      for (const folder of localFoldersSet) {
        console.log(`- ${folder} -> ${basePath ? `${basePath}/${folder}` : folder}`);
      }
    }
    
    // 预处理步骤: 先处理远程文件夹，确保本地存在对应的文件夹结构
    console.log('预处理: 确保远程文件夹结构在本地存在...');
    const remoteFolders = remoteFiles.filter(file => file.isFolder);
    
    // 输出所有远程文件夹，方便调试
    console.log(`检测到 ${remoteFolders.length} 个远程文件夹:`);
    for (const folder of remoteFolders) {
      console.log(`- 远程文件夹: ${folder.path}`);
    }
    
    // 按路径深度排序，确保父文件夹在子文件夹之前处理
    remoteFolders.sort((a, b) => {
      const depthA = a.path.split('/').length;
      const depthB = b.path.split('/').length;
      return depthA - depthB;
    });
    
    // 使用专门的方法确保本地文件夹结构在远程存在
    console.log('===== 同步阶段1：确保所有本地文件夹在远程存在 =====');
    // 收集所有本地文件夹进行同步
    const localFolders = localFiles.filter(file => file.isFolder);
    if (localFolders.length > 0) {
      console.log(`找到 ${localFolders.length} 个本地文件夹需要同步到远程`);
      await this.syncLocalFoldersToRemote(provider, localFiles, providerType, basePath, localFolders);
    } else {
      console.log('没有找到本地文件夹，跳过文件夹同步');
    }
    
    console.log('===== 同步阶段2：处理文件的双向同步 =====');
    // 执行普通文件的双向同步
    await this.syncBidirectional(provider, localFiles, remoteFiles, providerType, localPathSet);
    
    console.log('============= 双向增量同步完成 =============');
  }
  
  /**
   * 全量同步 - 双向
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
    console.log('执行全量同步（双向）');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    console.log(`使用远程基础路径: ${basePath || '/'}`);
    
    // 确保远程基础路径存在
    const basePathExists = await this.ensureRemoteBasePath(provider, providerType);
    if (!basePathExists) {
      console.warn('无法确保远程基础路径存在，同步操作可能不完整');
      // 继续执行，但已发出警告
    }
    
    // 直接使用双向同步方法
    await this.syncBidirectional(provider, localFiles, remoteFiles, providerType);
  }
  
  /**
   * 双向同步
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @param localPathSet 可选，已有的本地路径集合
   * @author Bing
   */
  private async syncBidirectional(
    provider: StorageProvider, 
    localFiles: LocalFileInfo[], 
    remoteFiles: FileInfo[],
    providerType: StorageProviderType,
    localPathSet?: Set<string>
  ) {
    console.log('执行双向同步');
    
    // 获取远程根路径
    const basePath = SyncPathUtils.getRemoteBasePath(this.plugin.settings, providerType);
    
    // 转换为Map便于查找
    const localFilesMap = this.createLocalFilesMap(localFiles);
    const remoteFilesMap = this.createRemoteFilesMap(remoteFiles);
    
    // 创建本地文件夹和远程文件夹的路径集合（用于删除操作）
    // 如果已有localPathSet则使用，否则创建新的
    if (!localPathSet) {
      localPathSet = new Set<string>();
      console.log('创建新的本地路径集合...');
      for (const file of localFiles) {
        // 过滤不相关的文件夹，避免同步
        if (file.isFolder && this.isSystemOrUnrelatedFolder(file.path)) {
          console.log(`跳过系统或不相关文件夹: ${file.path}`);
          continue;
        }
        
        // 添加到路径集合
        if (basePath) {
          localPathSet.add(`${basePath}/${file.path}`);
        } else {
          localPathSet.add(file.path);
        }
      }
    } else {
      console.log('使用现有的本地路径集合，包含 ' + localPathSet.size + ' 个路径');
    }
    
    const remoteFolders = new Set<string>();
    
    // 处理远程文件夹，确保本地也存在
    for (const file of remoteFiles) {
      if (file.isFolder) {
        remoteFolders.add(file.path);
        
        // 检查文件夹是否属于指定的同步基础路径
        if (basePath && !this.isPathUnderBasePath(file.path, basePath)) {
          console.log(`跳过不在同步基础路径下的远程文件夹: ${file.path}`);
          continue;
        }
        
        // 使用新的路径映射方法来正确处理远程路径
        let localPath = SyncPathUtils.mapRemotePathToLocal(file.path, basePath);
        // 如果是空路径（基础路径本身），则跳过创建
        if (localPath === '') {
          console.log(`远程路径是基础路径本身，跳过创建本地文件夹: ${file.path}`);
          continue; // 跳过此文件夹
        } else {
          console.log(`远程路径映射到本地路径: ${file.path} -> ${localPath}`);
        }
        
        // 检查此文件夹是否是多余文件夹（即本地没有对应的文件夹）
        let isExtraFolder = true;
        
        // 标准化远程路径，用于比较
        const normalizedRemotePath = file.path.replace(/^\/+/, '').replace(/\/+$/, '');
        
        // 遍历本地路径集合，检查是否存在对应路径
        for (const localItemPath of localPathSet) {
          // 标准化本地路径，用于比较
          const normalizedLocalPath = localItemPath.replace(/^\/+/, '').replace(/\/+$/, '');
          if (normalizedRemotePath === normalizedLocalPath) {
            isExtraFolder = false;
            break;
          }
        }
        
        // 如果是多余文件夹且启用了删除远程多余文件，跳过在本地创建
        if (isExtraFolder && this.plugin.settings.deleteRemoteExtraFiles) {
          console.log(`远程文件夹被判定为多余，跳过在本地创建: ${file.path}`);
          continue;
        }
        
        try {
          // 检查本地是否存在该文件夹
          const exists = await this.plugin.app.vault.adapter.exists(localPath);
          if (!exists) {
            console.log(`创建本地文件夹: ${localPath}`);
            
            // 确保父文件夹存在
            const parentPath = localPath.split('/').slice(0, -1).join('/');
            if (parentPath && parentPath !== localPath) {
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
            
            await this.plugin.app.vault.adapter.mkdir(localPath);
          } else {
            console.log(`本地文件夹已存在: ${localPath}`);
          }
        } catch (error) {
          console.error(`创建本地文件夹失败: ${localPath}`, error);
        }
      }
    }
    
    // 1. 处理两边都有的文件（根据冲突策略和修改时间决定同步方向）
    const processedFiles = new Set<string>();
    
    // 处理每个本地文件
    for (const localFile of localFiles.filter(f => !f.isFolder)) {
      // 构建远程路径，确保路径格式正确
      let remotePath;
      if (basePath) {
        // 使用joinPaths确保路径格式正确
        remotePath = SyncPathUtils.joinPaths(basePath, localFile.path);
        console.log(`构建远程路径: ${basePath} + ${localFile.path} -> ${remotePath}`);
      } else {
        remotePath = localFile.path;
        console.log(`未设置basePath，直接使用本地路径作为远程路径: ${remotePath}`);
      }
      const remoteFile = remoteFilesMap.get(remotePath);
      processedFiles.add(localFile.path);
      
      try {
        if (remoteFile) {
          // 文件在本地和远程都存在，比较修改时间
          const localMtime = new Date(localFile.mtime).getTime();
          const remoteMtime = remoteFile.modifiedTime.getTime();
          
          // 根据冲突策略和修改时间决定如何处理
          if (localMtime !== remoteMtime) {
            // 有冲突，根据冲突策略处理
            switch (this.plugin.settings.conflictPolicy) {
              case 'overwrite':
                // 总是用本地覆盖远程
                console.log(`冲突策略：覆盖，上传本地文件: ${localFile.path}`);
                const content = await this.plugin.app.vault.adapter.read(localFile.path);
                await provider.uploadFile(remotePath, content);
                break;
                
              case 'keepLocal':
                // 保留本地文件，上传到远程
                if (localMtime > remoteMtime) {
                  console.log(`冲突策略：保留本地，上传更新的文件: ${localFile.path}`);
                  const content = await this.plugin.app.vault.adapter.read(localFile.path);
                  await provider.uploadFile(remotePath, content);
                } else {
                  console.log(`冲突策略：保留本地，忽略远程文件: ${remoteFile.path}`);
                }
                break;
                
              case 'keepRemote':
                // 保留远程文件，下载到本地
                if (remoteMtime > localMtime) {
                  console.log(`冲突策略：保留远程，下载更新的文件: ${remoteFile.path}`);
                  if (provider.downloadFileContent) {
                    const content = await provider.downloadFileContent(remoteFile.path);
                    if (typeof content === 'string') {
                      await this.plugin.app.vault.adapter.write(localFile.path, content);
                    } else {
                      await this.plugin.app.vault.adapter.writeBinary(localFile.path, content);
                    }
                  }
                } else {
                  console.log(`冲突策略：保留远程，忽略本地文件: ${localFile.path}`);
                }
                break;
                
              case 'merge':
                // 目前无法真正合并文件内容，使用最新的文件
                if (localMtime > remoteMtime) {
                  console.log(`冲突策略：合并（使用最新），上传更新的文件: ${localFile.path}`);
                  const content = await this.plugin.app.vault.adapter.read(localFile.path);
                  await provider.uploadFile(remotePath, content);
                } else {
                  console.log(`冲突策略：合并（使用最新），下载更新的文件: ${remoteFile.path}`);
                  if (provider.downloadFileContent) {
                    const content = await provider.downloadFileContent(remoteFile.path);
                    if (typeof content === 'string') {
                      await this.plugin.app.vault.adapter.write(localFile.path, content);
                    } else {
                      await this.plugin.app.vault.adapter.writeBinary(localFile.path, content);
                    }
                  }
                }
                break;
            }
          } else {
            // 文件相同，无需同步
            console.log(`文件相同，无需同步: ${localFile.path}`);
          }
        } else {
          // 文件只在本地存在，上传到远程
          console.log(`本地独有文件，上传到远程: ${localFile.path}`);
          const content = await this.plugin.app.vault.adapter.read(localFile.path);
          await provider.uploadFile(remotePath, content);
        }
      } catch (error) {
        console.error(`同步文件失败: ${localFile.path}`, error);
      }
    }
    
    // 2. 处理只存在于远程的文件（下载到本地）
    for (const remoteFile of remoteFiles) {
      if (remoteFile.isFolder) continue; // 跳过文件夹，已在前面处理
      
      // 检查文件是否在同步路径下，如果不在则跳过
      if (basePath && !this.isPathUnderBasePath(remoteFile.path, basePath)) {
        console.log(`跳过不在同步基础路径下的远程文件: ${remoteFile.path}`);
        continue;
      }
      
      // 检查此文件是否是多余文件（即本地没有对应的文件）
      let isExtraFile = true;
      
      // 标准化远程路径，用于比较
      const normalizedRemotePath = remoteFile.path.replace(/^\/+/, '').replace(/\/+$/, '');
      
      // 遍历本地路径集合，检查是否存在对应路径
      for (const localPath of localPathSet) {
        // 标准化本地路径，用于比较
        const normalizedLocalPath = localPath.replace(/^\/+/, '').replace(/\/+$/, '');
        if (normalizedRemotePath === normalizedLocalPath) {
          isExtraFile = false;
          break;
        }
      }
      
      // 如果是多余文件，跳过下载
      if (isExtraFile && this.plugin.settings.deleteRemoteExtraFiles) {
        console.log(`远程文件被判定为多余，跳过下载: ${remoteFile.path}`);
        continue;
      }
      
      // 使用新的路径映射方法来正确处理远程路径
      let localPath = SyncPathUtils.mapRemotePathToLocal(remoteFile.path, basePath);
      console.log(`远程路径映射到本地: ${remoteFile.path} -> ${localPath || '(空路径)'}`);
      // 如果返回空字符串（表示是基础路径本身但它是一个文件），这种情况很少见，但为安全起见处理它
      if (localPath === '') {
        console.log(`远程路径映射为空，使用文件名作为本地路径: ${remoteFile.name}`);
        localPath = remoteFile.name;
      }
      
      if (processedFiles.has(localPath)) continue;
      
      try {
        console.log(`远程独有文件，下载到本地: ${remoteFile.path} -> ${localPath}`);
        if (provider.downloadFileContent) {
          // 确保目录存在
          const dirPath = localPath.split('/').slice(0, -1).join('/');
          if (dirPath) {
            await this.plugin.app.vault.adapter.mkdir(dirPath);
          }
          
          // 下载文件
          const content = await provider.downloadFileContent(remoteFile.path);
          if (typeof content === 'string') {
            await this.plugin.app.vault.adapter.write(localPath, content);
          } else {
            await this.plugin.app.vault.adapter.writeBinary(localPath, content);
          }
        } else {
          console.warn('当前存储提供商不支持直接下载文件内容');
        }
      } catch (error) {
        console.error(`下载远程文件失败: ${remoteFile.path} -> ${localPath}`, error);
      }
    }
    
    // 3. 处理删除操作（如果启用了相应设置）
    await this.handleDeletions(provider, localPathSet, remoteFolders, localFilesMap, remoteFilesMap, providerType, basePath);
  }
  
  /**
   * 处理删除操作
   * @param provider 存储提供商
   * @param localPathSet 本地路径集合
   * @param remoteFolders 远程文件夹集合
   * @param localFilesMap 本地文件映射
   * @param remoteFilesMap 远程文件映射
   * @param providerType 提供商类型
   * @param basePath 远程基础路径
   * @author Bing
   */
  private async handleDeletions(
    provider: StorageProvider,
    localPathSet: Set<string>,
    remoteFolders: Set<string>,
    localFilesMap: Map<string, LocalFileInfo>,
    remoteFilesMap: Map<string, FileInfo>,
    providerType: StorageProviderType,
    basePath: string
  ) {
    // 如果启用了删除远程多余文件，删除本地不存在但远程存在的文件和文件夹
    if (this.plugin.settings.deleteRemoteExtraFiles) {
      console.log('检查并删除远程多余文件和文件夹...');
      
      // 先删除远程多余文件
      for (const [remotePath, remoteFile] of remoteFilesMap.entries()) {
        if (!remoteFile.isFolder) {
          // 检查文件是否在同步路径下，如果不在则跳过
          if (basePath && !this.isPathUnderBasePath(remoteFile.path, basePath)) {
            console.log(`跳过删除不在同步基础路径下的远程文件: ${remoteFile.path}`);
            continue;
          }
          
          // 检查是否需要删除
          let shouldDelete = true;
          
          // 标准化当前远程路径，移除前导和尾部斜杠
          const normalizedRemotePath = remoteFile.path.replace(/^\/+/, '').replace(/\/+$/, '');
          
          // 遍历本地路径集合，检查是否有匹配的路径
          for (const localPath of localPathSet) {
            // 标准化本地路径，移除前导和尾部斜杠
            const normalizedLocalPath = localPath.replace(/^\/+/, '').replace(/\/+$/, '');
            
            // 比较标准化后的路径
            if (normalizedRemotePath === normalizedLocalPath) {
              shouldDelete = false;
              console.log(`路径匹配: ${remoteFile.path} 匹配 ${localPath}，跳过删除`);
              break;
            }
          }
          
          if (shouldDelete) {
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
              }
            }
          }
        }
      }
      
      // 提取所有远程文件夹并按深度排序（先删除深层文件夹）
      const remoteFoldersList = Array.from(remoteFolders)
        .sort((a, b) => {
          // 按路径深度排序，深层的先处理
          const depthA = a.split('/').length;
          const depthB = b.split('/').length;
          return depthB - depthA; // 注意这里是倒序
        });
      
      // 然后删除远程多余文件夹
      for (const remoteFolder of remoteFoldersList) {
        // 检查文件夹是否在同步路径下，如果不在则跳过
        if (basePath && !this.isPathUnderBasePath(remoteFolder, basePath)) {
          console.log(`跳过删除不在同步基础路径下的远程文件夹: ${remoteFolder}`);
          continue;
        }
        
        // 跳过删除根路径或基础同步路径
        if (basePath) {
          // 标准化路径，以确保能正确比较
          const normalizedBasePath = basePath.replace(/^\/+/, '').replace(/\/+$/, '');
          const normalizedRemoteFolder = remoteFolder.replace(/^\/+/, '').replace(/\/+$/, '');
          
          // 检查是否为基础同步路径（考虑多种可能的格式）
          if (normalizedBasePath === normalizedRemoteFolder) {
            console.log(`跳过删除基础同步路径: ${remoteFolder} (标准化后: ${normalizedRemoteFolder}, basePath: ${basePath})`);
            continue;
          }
          
          // 额外检查：如果基础路径本身可能是TEST，但remoteFolder是/TEST/
          if (remoteFolder === `/${normalizedBasePath}/` || remoteFolder === `/${normalizedBasePath}`) {
            console.log(`跳过删除基础同步路径(格式不同): ${remoteFolder}`);
            continue;
          }
        }
        
        // 检查是否需要删除
        let shouldDelete = true;
        
        // 标准化当前远程路径，移除前导和尾部斜杠
        const normalizedRemotePath = remoteFolder.replace(/^\/+/, '').replace(/\/+$/, '');
        
        // 遍历本地路径集合，检查是否有匹配的路径
        for (const localPath of localPathSet) {
          // 标准化本地路径，移除前导和尾部斜杠
          const normalizedLocalPath = localPath.replace(/^\/+/, '').replace(/\/+$/, '');
          
          // 比较标准化后的路径
          if (normalizedRemotePath === normalizedLocalPath) {
            shouldDelete = false;
            console.log(`路径匹配: ${remoteFolder} 匹配 ${localPath}，跳过删除`);
            break;
          }
        }
        
        if (shouldDelete) {
          try {
            console.log(`准备删除远程多余文件夹: ${remoteFolder}`);
            await provider.deleteFolder(remoteFolder);
            console.log(`删除远程多余文件夹成功: ${remoteFolder}`);
          } catch (error) {
            // 特别处理坚果云
            if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
              console.warn(`删除坚果云文件夹失败，但继续处理后续文件: ${remoteFolder}`, error);
              // 对于坚果云，不中断整个同步过程
              continue;
            } else {
              console.error(`删除远程文件夹失败: ${remoteFolder}`, error);
              // 对于非坚果云，继续处理下一个文件夹
            }
          }
        }
      }
    }
    
    // 如果启用了删除本地多余文件，删除远程不存在但本地存在的文件
    if (this.plugin.settings.deleteLocalExtraFiles) {
      console.log('检查并删除本地多余文件和文件夹...');
      
      // 统计所有远程文件路径
      const remotePathSet = new Set<string>();
      for (const [remotePath, file] of remoteFilesMap.entries()) {
        // 使用新的路径映射方法处理远程路径
        let localPath = SyncPathUtils.mapRemotePathToLocal(file.path, basePath);
        // 如果是空路径（基础路径本身），跳过添加到集合
        if (localPath === '') {
          console.log(`远程路径是基础路径本身，跳过添加到remotePathSet: ${file.path}`);
          continue; // 跳过此文件
        } else {
          console.log(`远程路径映射到本地路径: ${file.path} -> ${localPath}`);
          remotePathSet.add(localPath);
        }
      }
      
      // 删除本地多余文件
      for (const [localPath, localFile] of localFilesMap.entries()) {
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
      const localFolders = Array.from(localFilesMap.values())
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

  /**
   * 同步本地文件夹到远程
   * 确保远程存在对应的文件夹结构
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param providerType 提供商类型
   * @param basePath 远程基础路径
   * @param foldersList 可选，已预先提取的文件夹列表
   * @author Bing
   */
  private async syncLocalFoldersToRemote(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    providerType: StorageProviderType,
    basePath: string,
    foldersList?: LocalFileInfo[]
  ): Promise<void> {
    // 使用提供的文件夹列表或从本地文件中提取
    const allFolders = foldersList || localFiles.filter(item => item.isFolder);
    
    if (allFolders.length === 0) {
      console.log('没有检测到本地文件夹，跳过文件夹同步');
      return;
    }
    
    // 过滤掉不需要同步的文件夹
    const folders = allFolders.filter(folder => !this.isSystemOrUnrelatedFolder(folder.path));
    
    if (folders.length === 0) {
      console.log('过滤后没有需要同步的本地文件夹，跳过文件夹同步');
      return;
    }
    
    console.log(`准备同步 ${folders.length} 个本地文件夹到远程，基础路径: ${basePath || '/'}`);
    
    // 排序文件夹，确保父文件夹在子文件夹之前处理
    folders.sort((a, b) => {
      // 按路径深度排序，浅层的先处理
      const depthA = a.path.split('/').length;
      const depthB = b.path.split('/').length;
      return depthA - depthB;
    });
    
    // 打印所有要同步的文件夹
    console.log("待同步的本地文件夹列表（按深度排序）:");
    for (const folder of folders) {
      console.log(`- ${folder.path}`);
    }
    
    // 使用Set记录已处理过的路径
    const processedPaths = new Set<string>();
    // 限制最大处理文件夹数量
    const MAX_FOLDERS = 1000;
    let foldersProcessed = 0;
    
    // 处理后的文件夹数
    let successCount = 0;
    let errorCount = 0;
    let alreadyExistsCount = 0;
    let retryCount = 0;
    
    // 跟踪创建失败的文件夹，用于重试
    const failedFolders: LocalFileInfo[] = [];
    
    // 记录已创建的文件夹，避免重复创建
    const createdFolders = new Set<string>();
    
    // 处理每个文件夹
    for (const folder of folders) {
      try {
        // 构建远程路径
        const remotePath = basePath ? `${basePath}/${folder.path}` : folder.path;
        console.log(`处理文件夹: 本地=${folder.path}, 远程=${remotePath}`);
        
        // 如果是空字符串或根目录，跳过
        if (!folder.path || folder.path === '/') {
          console.log(`跳过根目录或空路径: ${folder.path}`);
          continue;
        }
        
        // 如果此路径已处理过或达到最大处理数量，跳过
        if (processedPaths.has(remotePath)) {
          console.log(`跳过处理: ${remotePath} (已处理过)`);
          continue;
        }
        
        if (foldersProcessed >= MAX_FOLDERS) {
          console.warn(`达到最大处理文件夹数量 ${MAX_FOLDERS}，停止处理后续文件夹`);
          break;
        }
        
        processedPaths.add(remotePath);
        foldersProcessed++;
        
        // 检查是否已经处理过这个文件夹（避免重复处理）
        if (createdFolders.has(remotePath)) {
          console.log(`文件夹已在当前同步周期中处理过: ${remotePath}`);
          continue;
        }
        
        // 检查远程文件夹是否存在
        let exists = false;
        try {
          exists = await provider.folderExists(remotePath);
          console.log(`远程文件夹存在检查: ${exists ? '已存在' : '不存在'}`);
        } catch (existsError) {
          console.error(`检查远程文件夹${remotePath}是否存在时出错:`, existsError);
          exists = false;
        }
        
        if (!exists) {
          console.log(`创建远程文件夹: ${remotePath}`);
          
          // 确保父文件夹存在
          const parentPath = folder.path.split('/').slice(0, -1).join('/');
          const remoteParentPath = parentPath ? (basePath ? `${basePath}/${parentPath}` : parentPath) : basePath;
          
          // 如果有父路径且不是根路径
          if (parentPath && parentPath !== folder.path) {
            console.log(`确保父目录存在: ${parentPath} -> ${remoteParentPath}`);
            
            // 检查父文件夹是否存在
            let parentExists = false;
            try {
              parentExists = await provider.folderExists(remoteParentPath);
              console.log(`父文件夹存在检查: ${parentExists ? '已存在' : '不存在'}`);
              
              // 如果父文件夹不存在，先创建父文件夹
              if (!parentExists && !createdFolders.has(remoteParentPath)) {
                try {
                  await provider.createFolder(remoteParentPath);
                  console.log(`父文件夹创建成功: ${remoteParentPath}`);
                  createdFolders.add(remoteParentPath);
                } catch (parentCreateError) {
                  console.error(`创建父文件夹失败: ${remoteParentPath}`, parentCreateError);
                  
                  // 如果父文件夹创建失败，将当前文件夹添加到失败列表，稍后重试
                  failedFolders.push(folder);
                  errorCount++;
                  continue; // 跳过当前文件夹，继续处理下一个
                }
              }
            } catch (parentExistsError) {
              console.error(`检查父文件夹${remoteParentPath}是否存在时出错:`, parentExistsError);
            }
          }
          
          try {
            await provider.createFolder(remotePath);
            console.log(`远程文件夹创建成功: ${remotePath}`);
            successCount++;
            createdFolders.add(remotePath);
          } catch (createError) {
            errorCount++;
            console.error(`创建远程文件夹失败: ${remotePath}`, createError);
            
            // 将失败的文件夹添加到重试列表
            failedFolders.push(folder);
            
            // 特殊处理坚果云的错误
            if (providerType === 'webdav' && 
               (createError.code === 'AUTH_FAILED' || 
                createError.status === 401 || 
                createError.status === 403)) {
              console.warn(`坚果云创建文件夹失败，尝试替代方法: ${remotePath}`);
              
              // 尝试通过上传空文件来隐式创建目录
              try {
                // 添加一个隐藏的文件标记
                const dummyFilePath = remotePath + '/.folder';
                const content = '';
                await provider.uploadFile(dummyFilePath, content);
                console.log(`通过创建空文件的方式创建了文件夹: ${remotePath}`);
                successCount++; // 我们认为文件夹创建成功
                errorCount--; // 取消之前的错误计数
                createdFolders.add(remotePath);
                
                // 如果成功，从失败列表中移除
                const index = failedFolders.findIndex(f => f.path === folder.path);
                if (index !== -1) {
                  failedFolders.splice(index, 1);
                }
              } catch (uploadError) {
                console.error(`创建标记文件也失败: ${remotePath}`, uploadError);
                // 继续处理下一个文件夹，不中断整个过程
              }
            } else if (createError.status === 409) {
              // 409错误通常意味着父文件夹不存在
              console.warn(`父目录不存在导致创建失败(409): ${remotePath}`);
              
              // 失败的情况下已将文件夹添加到重试列表
            }
          }
        } else {
          console.log(`远程文件夹已存在: ${remotePath}`);
          alreadyExistsCount++;
          createdFolders.add(remotePath);
        }
      } catch (error) {
        errorCount++;
        console.error(`同步文件夹失败: ${folder.path}`, error);
        
        // 将失败的文件夹添加到重试列表
        failedFolders.push(folder);
        
        // 特殊处理坚果云的错误，不中断同步过程
        if (providerType === 'webdav' && 
           (error.code === 'AUTH_FAILED' || 
            error.status === 401 || 
            error.status === 403 || 
            error.status === 405)) {
          console.warn(`坚果云文件夹处理失败，但继续同步: ${folder.path}`);
          // 继续处理下一个文件夹
          continue;
        }
        
        // 对于其他错误，也继续处理但记录警告
        console.warn(`处理文件夹时发生错误: ${folder.path}，但将继续同步`);
      }
    }
    
    // 重试阶段：处理之前创建失败的文件夹
    if (failedFolders.length > 0) {
      console.log(`===== 开始重试阶段：有 ${failedFolders.length} 个文件夹创建失败 =====`);
      
      // 再次排序文件夹，确保父文件夹在子文件夹之前处理
      failedFolders.sort((a, b) => {
        const depthA = a.path.split('/').length;
        const depthB = b.path.split('/').length;
        return depthA - depthB;
      });
      
      for (const folder of failedFolders) {
        const remotePath = basePath ? `${basePath}/${folder.path}` : folder.path;
        console.log(`重试创建文件夹: ${remotePath}`);
        
        // 跳过已成功创建的文件夹
        if (createdFolders.has(remotePath)) {
          console.log(`文件夹已在前一阶段成功创建，跳过: ${remotePath}`);
          continue;
        }
        
        try {
          // 再次尝试检查文件夹是否存在
          const exists = await provider.folderExists(remotePath);
          if (exists) {
            console.log(`重试检查：文件夹已存在，无需创建: ${remotePath}`);
            alreadyExistsCount++;
            retryCount++;
            continue;
          }
          
          // 再次尝试创建文件夹
          await provider.createFolder(remotePath);
          console.log(`重试成功：文件夹创建成功: ${remotePath}`);
          successCount++;
          errorCount--; // 减少之前计入的错误
          retryCount++;
          createdFolders.add(remotePath);
        } catch (retryError) {
          console.error(`重试创建文件夹失败: ${remotePath}`, retryError);
        }
      }
    }
    
    console.log(`本地文件夹同步到远程完成，结果统计:`);
    console.log(`- 成功创建: ${successCount} 个文件夹`);
    console.log(`- 已存在跳过: ${alreadyExistsCount} 个文件夹`);
    console.log(`- 创建失败: ${errorCount} 个文件夹`);
    console.log(`- 重试成功: ${retryCount} 个文件夹`);
    
    if (errorCount > 0) {
      console.warn(`警告: ${errorCount} 个文件夹创建失败，请检查日志了解详情`);
    }
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
    
    // 确保路径格式一致，移除前导斜杠和末尾斜杠
    const normalizedRemotePath = remotePath.replace(/^\/+/, '').replace(/\/+$/, '');
    const normalizedBasePath = basePath.replace(/^\/+/, '').replace(/\/+$/, '');
    
    // 先检查是否完全匹配基础路径，再检查是否是其子路径
    return normalizedRemotePath === normalizedBasePath || 
           normalizedRemotePath.startsWith(normalizedBasePath + '/');
  }
} 