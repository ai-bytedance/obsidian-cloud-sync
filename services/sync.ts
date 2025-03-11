import { TFile, Notice } from 'obsidian';
import CloudSyncPlugin from '../main';

// 同步状态类型
interface SyncStatus {
  lastSynced: number;
  status: 'synced' | 'error' | 'pending';
  error?: string;
}

// 同步队列项类型
interface SyncQueueItem {
  file: TFile;
  timestamp: number;
  action: 'create' | 'modify' | 'delete' | 'rename';
  oldPath?: string;
}

export class SyncService {
  private plugin: CloudSyncPlugin;
  private syncQueue: Map<string, SyncQueueItem> = new Map();
  private syncStatus: Map<string, SyncStatus> = new Map();
  private processingQueue: boolean = false;
  private queueProcessingTimeout: NodeJS.Timeout | null = null;
  
  // 记录上次显示"未启用云盘"提示的时间，避免频繁提示
  private lastNoCloudEnabledNoticeTime: number = 0;
  
  constructor(plugin: CloudSyncPlugin) {
    this.plugin = plugin;
  }
  
  // 添加文件到同步队列 - 兼容旧方法
  addToQueue(file: TFile) {
    this.queueFileForSync('modify', file);
  }
  
  // 添加文件到同步队列 - 新方法，支持不同的操作类型
  queueFileForSync(action: 'create' | 'modify' | 'delete', file: TFile) {
    // 检查是否应该同步该文件
    if (action !== 'delete' && !this.plugin.shouldSyncFile(file)) {
      return;
    }
    
    this.syncQueue.set(file.path, {
      file,
      timestamp: Date.now(),
      action
    });
    
    this.scheduleQueueProcessing();
  }
  
  // 添加重命名文件到同步队列
  queueFileForRename(file: TFile, oldPath: string) {
    // 检查是否应该同步该文件
    if (!this.plugin.shouldSyncFile(file)) {
      return;
    }
    
    this.syncQueue.set(file.path, {
      file,
      timestamp: Date.now(),
      action: 'rename',
      oldPath
    });
    
    this.scheduleQueueProcessing();
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
    // 检查是否有云盘被启用
    if (!this.plugin.settings.baiduDrive.enabled && !this.plugin.settings.aliDrive.enabled) {
      // 最多每30分钟提示一次"未启用云盘"
      const now = Date.now();
      if (now - this.lastNoCloudEnabledNoticeTime > 30 * 60 * 1000) {
        new Notice('云盘同步：未启用任何云盘，请在设置中启用至少一个云盘', 10000);
        this.lastNoCloudEnabledNoticeTime = now;
      }
      
      // 清空队列，避免积累大量未处理的文件
      this.syncQueue.clear();
      return;
    }
    
    if (this.processingQueue || this.syncQueue.size === 0) {
      return;
    }
    
    this.processingQueue = true;
    
    try {
      // 使用 updateStatusBarText 方法更新状态栏
      this.plugin.updateStatusBarText('云盘同步: 同步中...');
      
      // 按时间戳排序
      const sortedItems = Array.from(this.syncQueue.values())
        .sort((a, b) => a.timestamp - b.timestamp);
      
      // 记录失败的文件
      const failedFiles: string[] = [];
      
      for (const item of sortedItems) {
        try {
          if (item.action === 'delete') {
            await this.deleteFile(item.file.path);
          } else if (item.action === 'rename' && item.oldPath) {
            await this.renameFile(item.oldPath, item.file.path);
          } else {
            await this.syncFile(item.file);
          }
          this.syncQueue.delete(item.file.path);
        } catch (error) {
          console.error(`同步文件失败: ${item.file.path}`, error);
          failedFiles.push(item.file.path);
          
          // 从队列中移除，避免反复尝试同步失败的文件
          this.syncQueue.delete(item.file.path);
        }
      }
      
      // 只显示一次汇总错误，而不是每个文件都显示
      if (failedFiles.length > 0) {
        if (failedFiles.length === 1) {
          new Notice(`同步文件失败: ${failedFiles[0]}`);
        } else {
          new Notice(`同步失败: ${failedFiles.length} 个文件未能同步`);
        }
      }
      
      this.plugin.updateStatusBarText('云盘同步: 同步完成');
      setTimeout(() => {
        this.plugin.updateStatusBarText('云盘同步: 准备就绪');
      }, 3000);
    } catch (error) {
      console.error('处理同步队列失败', error);
      new Notice(`处理同步队列失败: ${error.message}`);
    } finally {
      this.processingQueue = false;
      
      // 如果队列中还有文件，继续处理
      if (this.syncQueue.size > 0) {
        this.scheduleQueueProcessing();
      }
    }
  }
  
  // 同步单个文件
  async syncFile(file: TFile) {
    // 检查是否有云盘被启用
    if (!this.plugin.settings.baiduDrive.enabled && !this.plugin.settings.aliDrive.enabled) {
      // 最多每30分钟提示一次"未启用云盘"
      const now = Date.now();
      if (now - this.lastNoCloudEnabledNoticeTime > 30 * 60 * 1000) {
        new Notice('云盘同步：未启用任何云盘，请在设置中启用至少一个云盘', 10000);
        this.lastNoCloudEnabledNoticeTime = now;
      }
      return;
    }
    
    try {
      // 读取文件内容
      const content = await this.plugin.app.vault.readBinary(file);
      
      // 加密文件内容
      const encryptedContent = await this.plugin.encryption.encrypt(content);
      
      const promises: Promise<any>[] = [];
      
      if (this.plugin.settings.baiduDrive.enabled) {
        promises.push(
          this.plugin.baiduDrive.uploadFile(file.path, this.stringToArrayBuffer(encryptedContent))
            .catch(error => {
              console.error(`百度网盘上传失败: ${file.path}`, error);
              throw new Error(`百度网盘上传失败: ${error.message}`);
            })
        );
      }
      
      if (this.plugin.settings.aliDrive.enabled) {
        promises.push(
          this.plugin.aliDrive.uploadFile(file.path, this.stringToArrayBuffer(encryptedContent))
            .catch(error => {
              console.error(`阿里云盘上传失败: ${file.path}`, error);
              throw new Error(`阿里云盘上传失败: ${error.message}`);
            })
        );
      }
      
      await Promise.all(promises);
      
      // 更新同步状态
      this.syncStatus.set(file.path, {
        lastSynced: Date.now(),
        status: 'synced'
      });
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
  
  // 将字符串转换为 ArrayBuffer
  private stringToArrayBuffer(str: string): ArrayBuffer {
    const encoder = new TextEncoder();
    return encoder.encode(str).buffer;
  }
  
  // 删除文件
  async deleteFile(filePath: string) {
    // 检查是否有云盘被启用
    if (!this.plugin.settings.baiduDrive.enabled && !this.plugin.settings.aliDrive.enabled) {
      // 最多每30分钟提示一次"未启用云盘"
      const now = Date.now();
      if (now - this.lastNoCloudEnabledNoticeTime > 30 * 60 * 1000) {
        new Notice('云盘同步：未启用任何云盘，请在设置中启用至少一个云盘', 10000);
        this.lastNoCloudEnabledNoticeTime = now;
      }
      return;
    }
    
    const promises: Promise<any>[] = [];
    
    if (this.plugin.settings.baiduDrive.enabled) {
      promises.push(
        this.plugin.baiduDrive.deleteFile(filePath)
          .catch(error => {
            console.error(`百度网盘删除失败: ${filePath}`, error);
            throw new Error(`百度网盘删除失败: ${error.message}`);
          })
      );
    }
    
    if (this.plugin.settings.aliDrive.enabled) {
      promises.push(
        this.plugin.aliDrive.deleteFile(filePath)
          .catch(error => {
            console.error(`阿里云盘删除失败: ${filePath}`, error);
            throw new Error(`阿里云盘删除失败: ${error.message}`);
          })
      );
    }
    
    try {
      await Promise.all(promises);
      
      // 从同步状态中移除
      this.syncStatus.delete(filePath);
    } catch (error) {
      console.error(`删除文件失败: ${filePath}`, error);
      new Notice(`删除文件失败: ${filePath} - ${error.message}`);
    }
  }
  
  // 重命名文件
  async renameFile(oldPath: string, newPath: string) {
    // 检查是否有云盘被启用
    if (!this.plugin.settings.baiduDrive.enabled && !this.plugin.settings.aliDrive.enabled) {
      // 最多每30分钟提示一次"未启用云盘"
      const now = Date.now();
      if (now - this.lastNoCloudEnabledNoticeTime > 30 * 60 * 1000) {
        new Notice('云盘同步：未启用任何云盘，请在设置中启用至少一个云盘', 10000);
        this.lastNoCloudEnabledNoticeTime = now;
      }
      return;
    }
    
    const promises: Promise<any>[] = [];
    
    if (this.plugin.settings.baiduDrive.enabled) {
      promises.push(
        this.plugin.baiduDrive.renameFile(oldPath, newPath)
          .catch(error => {
            console.error(`百度网盘重命名失败: ${oldPath} -> ${newPath}`, error);
            throw new Error(`百度网盘重命名失败: ${error.message}`);
          })
      );
    }
    
    if (this.plugin.settings.aliDrive.enabled) {
      promises.push(
        this.plugin.aliDrive.renameFile(oldPath, newPath)
          .catch(error => {
            console.error(`阿里云盘重命名失败: ${oldPath} -> ${newPath}`, error);
            throw new Error(`阿里云盘重命名失败: ${error.message}`);
          })
      );
    }
    
    try {
      await Promise.all(promises);
      
      // 更新同步状态
      if (this.syncStatus.has(oldPath)) {
        const status = this.syncStatus.get(oldPath);
        this.syncStatus.set(newPath, status!);
        this.syncStatus.delete(oldPath);
      }
    } catch (error) {
      console.error(`重命名文件失败: ${oldPath} -> ${newPath}`, error);
      new Notice(`重命名文件失败: ${oldPath} -> ${newPath} - ${error.message}`);
    }
  }
  
  // 全量同步
  async syncAll() {
    // 检查是否有云盘被启用
    if (!this.plugin.settings.baiduDrive.enabled && !this.plugin.settings.aliDrive.enabled) {
      new Notice('云盘同步：未启用任何云盘，请在设置中启用至少一个云盘', 10000);
      this.lastNoCloudEnabledNoticeTime = Date.now();
      return;
    }
    
    try {
      // 使用 updateStatusBarText 方法更新状态栏
      this.plugin.updateStatusBarText('云盘同步: 全量同步中...');
      
      // 获取所有文件
      const files = this.plugin.app.vault.getFiles();
      
      // 过滤需要同步的文件
      const filesToSync = files.filter(file => this.plugin.shouldSyncFile(file));
      
      // 记录失败的文件
      const failedFiles: string[] = [];
      
      // 上传所有文件
      for (const file of filesToSync) {
        try {
          await this.syncFile(file);
        } catch (error) {
          console.error(`同步文件失败: ${file.path}`, error);
          failedFiles.push(file.path);
        }
      }
      
      // 只显示一次汇总错误，而不是每个文件都显示
      if (failedFiles.length > 0) {
        if (failedFiles.length === 1) {
          new Notice(`同步文件失败: ${failedFiles[0]}`);
        } else {
          new Notice(`同步失败: ${failedFiles.length} 个文件未能同步`);
        }
      } else {
        new Notice(`全量同步完成，共同步 ${filesToSync.length} 个文件`);
      }
      
      this.plugin.updateStatusBarText('云盘同步: 同步完成');
      setTimeout(() => {
        this.plugin.updateStatusBarText('云盘同步: 准备就绪');
      }, 3000);
    } catch (error) {
      console.error('全量同步失败', error);
      new Notice(`全量同步失败: ${error.message}`);
    }
  }
  
  // 重置同步间隔
  resetSyncInterval() {
    if (this.plugin.syncIntervalId) {
      clearInterval(this.plugin.syncIntervalId);
    }
    
    if (this.plugin.settings.syncInterval > 0) {
      this.plugin.syncIntervalId = window.setInterval(() => {
        // 检查是否有云盘被启用
        if (this.plugin.settings.baiduDrive.enabled || this.plugin.settings.aliDrive.enabled) {
          this.syncAll();
        }
      }, this.plugin.settings.syncInterval * 60 * 1000);
    }
  }
} 