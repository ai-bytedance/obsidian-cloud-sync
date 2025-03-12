import { TFile, Notice } from 'obsidian';
import CloudSyncPlugin from '../main';

// 同步操作类型
type SyncOperation = 'create' | 'modify' | 'delete' | 'rename';

// 同步队列项
interface SyncQueueItem {
  path: string;
  operation: SyncOperation;
  oldPath?: string;
  timestamp: number;
}

export class SyncService {
  private plugin: CloudSyncPlugin;
  private syncQueue: Map<string, SyncQueueItem> = new Map();
  private isSyncing: boolean = false;
  private lastSyncTime: number = 0;
  private syncStatus: Map<string, {
    lastSynced: number;
    status: 'synced' | 'error' | 'pending';
    error?: string;
  }> = new Map();
  private processingQueue: boolean = false;
  private queueProcessingTimeout: NodeJS.Timeout | null = null;
  
  // 记录上次显示"未启用云盘"提示的时间，避免频繁提示
  private lastNoCloudEnabledNoticeTime: number = 0;
  
  constructor(plugin: CloudSyncPlugin) {
    this.plugin = plugin;
  }
  
  // 添加文件到同步队列 - 兼容旧方法
  addToQueue(file: TFile) {
    this.queueFileForSync(file.path, 'modify');
  }
  
  // 添加文件到同步队列 - 新方法，支持不同的操作类型
  queueFileForSync(path: string, operation: SyncOperation, oldPath?: string) {
    // 检查是否应该排除该文件
    if (this.shouldExcludeFile(path)) {
      return;
    }

    // 添加到队列
    this.syncQueue.set(path, {
      path,
      operation,
      oldPath,
      timestamp: Date.now()
    });

    // 如果不是正在同步，且距离上次同步已经过去了至少 5 秒，则触发同步
    if (!this.isSyncing && Date.now() - this.lastSyncTime > 5000) {
      setTimeout(() => this.processQueue(), 2000); // 延迟 2 秒，合并短时间内的多次修改
    }
  }
  
  // 检查文件是否应该被排除
  private shouldExcludeFile(path: string): boolean {
    // 检查文件扩展名
    const excludeExtensions = this.plugin.settings.excludeExtensions.split(',').map(ext => ext.trim());
    for (const ext of excludeExtensions) {
      if (ext && path.endsWith(ext)) {
        return true;
      }
    }

    // 检查文件路径
    const excludePaths = this.plugin.settings.excludePaths.split(',').map(p => p.trim());
    for (const excludePath of excludePaths) {
      if (excludePath && path.startsWith(excludePath)) {
        return true;
      }
    }

    return false;
  }
  
  // 添加重命名文件到同步队列
  queueFileForRename(file: TFile, oldPath: string) {
    this.queueFileForSync(file.path, 'rename', oldPath);
  }
  
  // 安排队列处理
  private scheduleQueueProcessing() {
    if (this.queueProcessingTimeout) {
      clearTimeout(this.queueProcessingTimeout);
    }
    
    this.queueProcessingTimeout = setTimeout(() => {
      this.processQueue();
    }, 2000); // 延迟2秒处理队列，合并短时间内的多次修改
  }
  
  // 处理同步队列
  private async processQueue() {
    if (this.processingQueue || this.syncQueue.size === 0) {
      return;
    }
    
    this.processingQueue = true;
    this.isSyncing = true;
    
    try {
      // 检查是否有云盘被启用
      if (!this.isAnyCloudEnabled()) {
        // 避免频繁提示
        if (Date.now() - this.lastNoCloudEnabledNoticeTime > 60000) { // 1分钟内不重复提示
          new Notice('云盘同步：未启用任何云盘，请在设置中启用至少一个云盘', 5000);
          this.lastNoCloudEnabledNoticeTime = Date.now();
        }
        return;
      }
      
      this.plugin.updateStatusBarText('云盘同步: 同步中...');
      
      // 复制队列并清空原队列
      const queueItems = Array.from(this.syncQueue.values());
      this.syncQueue.clear();
      
      // 按操作类型分组处理
      const createOrModifyItems = queueItems.filter(item => 
        item.operation === 'create' || item.operation === 'modify');
      const deleteItems = queueItems.filter(item => item.operation === 'delete');
      const renameItems = queueItems.filter(item => item.operation === 'rename');
      
      // 处理重命名操作
      for (const item of renameItems) {
        if (item.oldPath) {
          await this.renameFile(item.oldPath, item.path);
        }
      }
      
      // 处理删除操作
      for (const item of deleteItems) {
        await this.deleteFile(item.path);
      }
      
      // 处理创建或修改操作
      for (const item of createOrModifyItems) {
        const file = this.getFileByPath(item.path);
        if (file instanceof TFile) {
          await this.syncFile(file);
        }
      }
      
      this.lastSyncTime = Date.now();
      this.plugin.updateStatusBarText('云盘同步: 同步完成');
      setTimeout(() => {
        this.plugin.updateStatusBarText('云盘同步: 就绪');
      }, 3000);
    } catch (error) {
      console.error('同步失败', error);
      this.plugin.updateStatusBarText('云盘同步: 同步失败');
      new Notice(`同步失败: ${error.message}`);
    } finally {
      this.processingQueue = false;
      this.isSyncing = false;
      
      // 如果队列中还有项目，继续处理
      if (this.syncQueue.size > 0) {
        setTimeout(() => this.processQueue(), 1000);
      }
    }
  }
  
  // 检查是否有云盘被启用
  private isAnyCloudEnabled(): boolean {
    return (
      this.plugin.settings.baiduDrive.enabled || 
      this.plugin.settings.aliDrive.enabled ||
      this.plugin.settings.jianguoyunDrive.enabled ||
      this.plugin.settings.googleDrive.enabled ||
      this.plugin.settings.oneDrive.enabled ||
      this.plugin.settings.iCloudDrive.enabled
    );
  }
  
  // 同步单个文件
  private async syncFile(file: TFile) {
    try {
      const content = await this.plugin.app.vault.readBinary(file);
      const encryptedContent = await this.plugin.encryption.encrypt(content);
      
      const promises = [];
      
      // 百度网盘
      if (this.plugin.settings.baiduDrive.enabled) {
        promises.push(
          this.plugin.baiduDrive.uploadFile(file.path, this.stringToArrayBuffer(encryptedContent))
            .catch(error => {
              console.error(`百度网盘上传失败: ${file.path}`, error);
              throw new Error(`百度网盘上传失败: ${error.message}`);
            })
        );
      }
      
      // 阿里云盘
      if (this.plugin.settings.aliDrive.enabled) {
        promises.push(
          this.plugin.aliDrive.uploadFile(file.path, this.stringToArrayBuffer(encryptedContent))
            .catch(error => {
              console.error(`阿里云盘上传失败: ${file.path}`, error);
              throw new Error(`阿里云盘上传失败: ${error.message}`);
            })
        );
      }
      
      // 坚果云
      if (this.plugin.settings.jianguoyunDrive.enabled) {
        promises.push(
          this.plugin.jianguoyunDrive.uploadFile(file.path, this.stringToArrayBuffer(encryptedContent))
            .catch(error => {
              console.error(`坚果云上传失败: ${file.path}`, error);
              throw new Error(`坚果云上传失败: ${error.message}`);
            })
        );
      }
      
      // Google Drive
      if (this.plugin.settings.googleDrive.enabled) {
        promises.push(
          this.plugin.googleDrive.uploadFile(file.path, this.stringToArrayBuffer(encryptedContent))
            .catch(error => {
              console.error(`Google Drive上传失败: ${file.path}`, error);
              throw new Error(`Google Drive上传失败: ${error.message}`);
            })
        );
      }
      
      // OneDrive
      if (this.plugin.settings.oneDrive.enabled) {
        promises.push(
          this.plugin.oneDrive.uploadFile(file.path, this.stringToArrayBuffer(encryptedContent))
            .catch(error => {
              console.error(`OneDrive 上传失败: ${file.path}`, error);
              throw new Error(`OneDrive 上传失败: ${error.message}`);
            })
        );
      }
      
      // iCloud
      if (this.plugin.settings.iCloudDrive.enabled) {
        promises.push(
          this.plugin.iCloudDrive.uploadFile(file.path, this.stringToArrayBuffer(encryptedContent))
            .catch(error => {
              console.error(`iCloud 上传失败: ${file.path}`, error);
              throw new Error(`iCloud 上传失败: ${error.message}`);
            })
        );
      }
      
      await Promise.all(promises);
      
      // 更新同步状态
      this.syncStatus.set(file.path, {
        lastSynced: Date.now(),
        status: 'synced'
      });
      
      return true;
    } catch (error) {
      console.error(`同步文件失败: ${file.path}`, error);
      
      // 更新同步状态
      this.syncStatus.set(file.path, {
        lastSynced: Date.now(),
        status: 'error',
        error: error.message
      });
      
      throw error;
    }
  }
  
  // 删除文件
  private async deleteFile(path: string) {
    const promises = [];
    
    // 百度网盘
    if (this.plugin.settings.baiduDrive.enabled) {
      promises.push(
        this.plugin.baiduDrive.deleteFile(path)
          .catch(error => {
            console.error(`百度网盘删除失败: ${path}`, error);
            throw new Error(`百度网盘删除失败: ${error.message}`);
          })
      );
    }
    
    // 阿里云盘
    if (this.plugin.settings.aliDrive.enabled) {
      promises.push(
        this.plugin.aliDrive.deleteFile(path)
          .catch(error => {
            console.error(`阿里云盘删除失败: ${path}`, error);
            throw new Error(`阿里云盘删除失败: ${error.message}`);
          })
      );
    }
    
    // 坚果云
    if (this.plugin.settings.jianguoyunDrive.enabled) {
      promises.push(
        this.plugin.jianguoyunDrive.deleteFile(path)
          .catch(error => {
            console.error(`坚果云删除失败: ${path}`, error);
            throw new Error(`坚果云删除失败: ${error.message}`);
          })
      );
    }
    
    // Google Drive
    if (this.plugin.settings.googleDrive.enabled) {
      promises.push(
        this.plugin.googleDrive.deleteFile(path)
          .catch(error => {
            console.error(`Google Drive删除失败: ${path}`, error);
            throw new Error(`Google Drive删除失败: ${error.message}`);
          })
      );
    }
    
    // OneDrive
    if (this.plugin.settings.oneDrive.enabled) {
      promises.push(
        this.plugin.oneDrive.deleteFile(path)
          .catch(error => {
            console.error(`OneDrive 删除失败: ${path}`, error);
            throw new Error(`OneDrive 删除失败: ${error.message}`);
          })
      );
    }
    
    // iCloud
    if (this.plugin.settings.iCloudDrive.enabled) {
      promises.push(
        this.plugin.iCloudDrive.deleteFile(path)
          .catch(error => {
            console.error(`iCloud 删除失败: ${path}`, error);
            throw new Error(`iCloud 删除失败: ${error.message}`);
          })
      );
    }
    
    await Promise.all(promises);
    
    // 移除同步状态
    this.syncStatus.delete(path);
  }
  
  // 重命名文件
  private async renameFile(oldPath: string, newPath: string) {
    const promises = [];
    
    // 百度网盘
    if (this.plugin.settings.baiduDrive.enabled) {
      promises.push(
        this.plugin.baiduDrive.renameFile(oldPath, newPath)
          .catch(error => {
            console.error(`百度网盘重命名失败: ${oldPath} -> ${newPath}`, error);
            throw new Error(`百度网盘重命名失败: ${error.message}`);
          })
      );
    }
    
    // 阿里云盘
    if (this.plugin.settings.aliDrive.enabled) {
      promises.push(
        this.plugin.aliDrive.renameFile(oldPath, newPath)
          .catch(error => {
            console.error(`阿里云盘重命名失败: ${oldPath} -> ${newPath}`, error);
            throw new Error(`阿里云盘重命名失败: ${error.message}`);
          })
      );
    }
    
    // 坚果云
    if (this.plugin.settings.jianguoyunDrive.enabled) {
      promises.push(
        this.plugin.jianguoyunDrive.renameFile(oldPath, newPath)
          .catch(error => {
            console.error(`坚果云重命名失败: ${oldPath} -> ${newPath}`, error);
            throw new Error(`坚果云重命名失败: ${error.message}`);
          })
      );
    }
    
    // Google Drive
    if (this.plugin.settings.googleDrive.enabled) {
      promises.push(
        this.plugin.googleDrive.renameFile(oldPath, newPath)
          .catch(error => {
            console.error(`Google Drive重命名失败: ${oldPath} -> ${newPath}`, error);
            throw new Error(`Google Drive重命名失败: ${error.message}`);
          })
      );
    }
    
    // OneDrive
    if (this.plugin.settings.oneDrive.enabled) {
      promises.push(
        this.plugin.oneDrive.renameFile(oldPath, newPath)
          .catch(error => {
            console.error(`OneDrive 重命名失败: ${oldPath} -> ${newPath}`, error);
            throw new Error(`OneDrive 重命名失败: ${error.message}`);
          })
      );
    }
    
    // iCloud
    if (this.plugin.settings.iCloudDrive.enabled) {
      promises.push(
        this.plugin.iCloudDrive.renameFile(oldPath, newPath)
          .catch(error => {
            console.error(`iCloud 重命名失败: ${oldPath} -> ${newPath}`, error);
            throw new Error(`iCloud 重命名失败: ${error.message}`);
          })
      );
    }
    
    await Promise.all(promises);
    
    // 更新同步状态
    if (this.syncStatus.has(oldPath)) {
      const status = this.syncStatus.get(oldPath);
      this.syncStatus.delete(oldPath);
      this.syncStatus.set(newPath, status!);
    }
  }
  
  // 辅助方法：将字符串转换为 ArrayBuffer
  private stringToArrayBuffer(str: string): ArrayBuffer {
    const encoder = new TextEncoder();
    return encoder.encode(str).buffer;
  }
  
  // 辅助方法：根据路径获取文件
  private getFileByPath(path: string): TFile | null {
    // 直接使用 vault.getFiles() 方法获取所有文件，然后查找匹配路径的文件
    const files = this.plugin.app.vault.getFiles();
    return files.find(file => file.path === path) || null;
  }
  
  // 全量同步
  async syncAll() {
    // 检查是否有云盘被启用
    if (!this.isAnyCloudEnabled()) {
      new Notice('云盘同步：未启用任何云盘，请在设置中启用至少一个云盘', 5000);
      this.lastNoCloudEnabledNoticeTime = Date.now();
      return;
    }
    
    if (this.isSyncing) {
      new Notice('同步已在进行中，请稍后再试');
      return;
    }
    
    this.isSyncing = true;
    
    try {
      this.plugin.updateStatusBarText('云盘同步: 全量同步中...');
      
      // 获取所有文件
      const files = this.plugin.app.vault.getFiles();
      const totalFiles = files.length;
      let processedFiles = 0;
      let failedFiles: string[] = [];
      
      for (const file of files) {
        // 检查是否应该排除该文件
        if (this.shouldExcludeFile(file.path)) {
          processedFiles++;
          continue;
        }
        
        try {
          await this.syncFile(file);
        } catch (error) {
          console.error(`同步文件失败: ${file.path}`, error);
          failedFiles.push(file.path);
        }
        
        processedFiles++;
        this.plugin.updateStatusBarText(`云盘同步: 同步中 (${processedFiles}/${totalFiles})`);
      }
      
      this.lastSyncTime = Date.now();
      
      if (failedFiles.length > 0) {
        if (failedFiles.length === 1) {
          new Notice(`同步文件失败: ${failedFiles[0]}`);
        } else {
          new Notice(`同步失败: ${failedFiles.length} 个文件同步失败`);
        }
        this.plugin.updateStatusBarText(`云盘同步: ${failedFiles.length} 个文件同步失败`);
      } else {
        this.plugin.updateStatusBarText('云盘同步: 同步完成');
        setTimeout(() => {
          this.plugin.updateStatusBarText('云盘同步: 就绪');
        }, 3000);
      }
    } catch (error) {
      console.error('全量同步失败', error);
      this.plugin.updateStatusBarText('云盘同步: 同步失败');
      new Notice(`全量同步失败: ${error.message}`);
    } finally {
      this.isSyncing = false;
    }
  }
}