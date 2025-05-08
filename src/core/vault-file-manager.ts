import CloudSyncPlugin from '@main';
import { TFile, TAbstractFile, TFolder, Vault } from 'obsidian';
import { SyncFileFilter } from '@src/utils/sync-file-filter';
import { ModuleLogger } from '@services/log/log-service';

/**
 * 保管库文件信息接口
 * @author Bing
 */
interface VaultFileInfo {
  path: string;
  data: ArrayBuffer;
  lastModified: number;
  type: 'file' | 'folder';
}

/**
 * 保管库文件管理器类
 * 负责管理与Obsidian保管库相关的文件操作
 * 包括文件获取、删除和移动等
 * @author Bing
 */
export class VaultFileManager {
  private vault: Vault;
  private logger: ModuleLogger;

  /**
   * 构造函数
   * @param plugin 插件实例
   * @author Bing
   */
  constructor(private plugin: CloudSyncPlugin) {
    this.vault = this.plugin.app.vault;
    this.logger = this.plugin.logService.getModuleLogger('VaultFileManager');
  }

  /**
   * 获取保管库中所有需要同步的文件
   * @returns 保管库文件信息列表
   * @author Bing
   */
  public async getVaultFiles(): Promise<VaultFileInfo[]> {
    const files = this.vault.getFiles();
    const syncFiles: VaultFileInfo[] = [];

    for (const file of files) {
      // 检查文件是否应该被同步
      if (SyncFileFilter.shouldExcludeFile(file, this.plugin.settings)) {
        continue;
      }

      try {
        const fileData = await this.vault.readBinary(file);
        const lastModified = file.stat.mtime;

        syncFiles.push({
          path: file.path,
          data: fileData,
          lastModified,
          type: 'file'
        });
      } catch (error) {
        this.logger.error(`读取文件 ${file.path} 失败:`, error);
      }
    }

    // 获取文件夹信息
    const folders = this.getFolders();
    syncFiles.push(...folders);

    return syncFiles;
  }

  /**
   * 获取保管库中所有需要同步的文件夹
   * @returns 文件夹信息列表
   * @author Bing
   */
  private getFolders(): VaultFileInfo[] {
    const folders: VaultFileInfo[] = [];
    const folderSet = new Set<string>();

    // 收集所有文件夹路径
    this.vault.getAllLoadedFiles().forEach(file => {
      if (file instanceof TFolder && file.path !== '/') {
        // 检查文件夹是否应该被同步
        if (!SyncFileFilter.shouldExcludeFile(file, this.plugin.settings)) {
          folderSet.add(file.path);
        }
      }
    });

    // 转换为VaultFileInfo对象
    folderSet.forEach(folderPath => {
      folders.push({
        path: folderPath,
        data: new ArrayBuffer(0),
        lastModified: Date.now(),
        type: 'folder'
      });
    });

    return folders;
  }

  /**
   * 创建文件
   * @param path 文件路径
   * @param data 文件数据
   * @author Bing
   */
  public async createFile(path: string, data: ArrayBuffer): Promise<void> {
    await this.vault.createBinary(path, data);
  }

  /**
   * 更新文件
   * @param path 文件路径
   * @param data 文件数据
   * @author Bing
   */
  public async updateFile(path: string, data: ArrayBuffer): Promise<void> {
    const file = this.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.vault.modifyBinary(file, data);
    } else {
      // 如果文件不存在，创建它
      await this.createFile(path, data);
    }
  }

  /**
   * 删除文件
   * @param path 文件路径
   * @author Bing
   */
  public async deleteFile(path: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(path);
    if (file) {
      // 使用app.fileManager.trashFile替代直接删除
      // 这会根据用户偏好处理文件（例如移动到回收站）
      await this.plugin.app.fileManager.trashFile(file);
    }
  }

  /**
   * 创建文件夹
   * @param path 文件夹路径
   * @author Bing
   */
  public async createFolder(path: string): Promise<void> {
    await this.vault.createFolder(path);
  }

  /**
   * 确保文件夹存在
   * 如果文件夹不存在，则创建它及其所有父文件夹
   * @param path 文件夹路径
   * @author Bing
   */
  public async ensureFolderExists(path: string): Promise<void> {
    const parts = path.split('/').filter(p => p.length > 0);
    let currentPath = '';

    for (const part of parts) {
      currentPath += part + '/';
      const folder = this.vault.getAbstractFileByPath(currentPath);
      if (!folder) {
        try {
          await this.vault.createFolder(currentPath);
        } catch (error) {
          // 如果创建失败但文件夹已存在，忽略错误
          if (!this.vault.getAbstractFileByPath(currentPath)) {
            throw error;
          }
        }
      }
    }
  }

  /**
   * 获取文件的最后修改时间
   * @param path 文件路径
   * @returns 最后修改时间，如果文件不存在则返回0
   * @author Bing
   */
  public getFileLastModified(path: string): number {
    const file = this.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      return file.stat.mtime;
    }
    return 0;
  }
} 