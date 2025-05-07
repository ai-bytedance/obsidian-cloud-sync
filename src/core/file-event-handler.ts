import { TAbstractFile, TFile, debounce } from 'obsidian';
import CloudSyncPlugin from '@main';
import { SyncEngine } from '@src/core/sync-engine';
import { SyncFileFilter } from '@src/utils/sync-file-filter';
import { AutoSyncManager } from '@src/core/auto-sync-manager';
import { ModuleLogger } from '@services/log/log-service';

/**
 * 文件事件处理器类
 * 负责处理Obsidian文件系统事件
 * 包括文件创建、修改、删除和重命名等事件
 * @author Bing
 */
export class FileEventHandler {
  // 标记事件是否已注册
  private eventsRegistered: boolean = false;
  private logger: ModuleLogger;
  
  /**
   * 构造函数
   * @param plugin 插件实例
   * @param syncEngine 同步引擎
   * @param autoSyncManager 自动同步管理器
   * @author Bing
   */
  constructor(
    private plugin: CloudSyncPlugin,
    private syncEngine: SyncEngine,
    private autoSyncManager: AutoSyncManager
  ) {
    this.logger = this.plugin.logService.getModuleLogger('FileEventHandler');
  }
  
  /**
   * 注册文件事件监听器
   * @author Bing
   */
  registerFileEvents() {
    if (this.eventsRegistered) {
      this.logger.info('文件事件监听器已注册，跳过重复注册');
      return;
    }
    
    // 注册文件创建事件
    this.plugin.registerEvent(
      this.plugin.app.vault.on('create', (file) => {
        // 检查是否应该忽略
        if (SyncFileFilter.shouldExcludeFile(file, this.plugin.settings)) {
          this.logger.info(`忽略创建事件: ${file.path}`);
          return;
        }
        
        this.logger.info(`文件创建: ${file.path}`);
        // 这里可以根据需要触发同步操作，例如：
        // 1. 即时同步
        // 2. 添加到待同步队列
        // 3. 重置自动同步计时器
      })
    );
    
    // 注册文件修改事件
    this.plugin.registerEvent(
      this.plugin.app.vault.on('modify', (file) => {
        // 检查是否应该忽略
        if (SyncFileFilter.shouldExcludeFile(file, this.plugin.settings)) {
          this.logger.info(`忽略修改事件: ${file.path}`);
          return;
        }
        
        this.logger.info(`文件修改: ${file.path}`);
        // 同上，根据需要触发同步操作
      })
    );
    
    // 注册文件删除事件
    this.plugin.registerEvent(
      this.plugin.app.vault.on('delete', (file) => {
        // 检查是否应该忽略
        if (SyncFileFilter.shouldExcludeFile(file, this.plugin.settings)) {
          this.logger.info(`忽略删除事件: ${file.path}`);
          return;
        }
        
        this.logger.info(`文件删除: ${file.path}`);
        // 同上，根据需要触发同步操作
      })
    );
    
    // 注册文件重命名事件
    this.plugin.registerEvent(
      this.plugin.app.vault.on('rename', (file, oldPath) => {
        // 检查是否应该忽略
        if (SyncFileFilter.shouldExcludeFile(file, this.plugin.settings)) {
          this.logger.info(`忽略重命名事件: ${oldPath} -> ${file.path}`);
          return;
        }
        
        this.logger.info(`文件重命名: ${oldPath} -> ${file.path}`);
        // 同上，根据需要触发同步操作
      })
    );
    
    this.eventsRegistered = true;
    this.logger.info('文件事件监听器已注册');
  }
  
  /**
   * 取消注册文件事件监听器
   * 在插件卸载或重新加载时调用
   * @author Chatbot
   */
  unregisterFileEvents() {
    // Obsidian的Plugin.registerEvent方法会自动将事件添加到一个内部列表中
    // 当插件卸载时，所有注册的事件会自动被移除，无需手动取消注册
    // 但我们可以标记为未注册，以便下次注册时知道状态
    if (this.eventsRegistered) {
      this.eventsRegistered = false;
      this.logger.info('文件事件监听器标记为已取消注册');
    }
  }
  
  /**
   * 延迟同步，避免短时间内多次触发同步
   * @author Bing
   */
  private debouncedSync = debounce(() => {
    if (this.plugin.settings.enableSync) {
      this.plugin.manualSync();
    }
  }, 5000, true);
} 