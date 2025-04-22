import { TAbstractFile, TFile, debounce } from 'obsidian';
import CloudSyncPlugin from '@main';
import { SyncEngine } from '@src/core/sync-engine';
import { SyncFileFilter } from '@src/utils/sync-file-filter';
import { AutoSyncManager } from '@src/core/auto-sync-manager';

/**
 * 文件事件处理器类
 * 负责处理Obsidian文件系统事件
 * 包括文件创建、修改、删除和重命名等事件
 * @author Bing
 */
export class FileEventHandler {
  /**
   * 构造函数
   * @param plugin 插件实例
   * @param syncEngine 同步引擎
   * @author Bing
   */
  constructor(
    private plugin: CloudSyncPlugin,
    private syncEngine: SyncEngine,
    private autoSyncManager: AutoSyncManager
  ) {}
  
  /**
   * 注册文件事件监听器
   * @author Bing
   */
  registerFileEvents() {
    // 文件创建事件
    this.plugin.registerEvent(
      this.plugin.app.vault.on('create', this.handleFileCreated.bind(this))
    );
    
    // 文件修改事件
    this.plugin.registerEvent(
      this.plugin.app.vault.on('modify', this.handleFileModified.bind(this))
    );
    
    // 文件删除事件
    this.plugin.registerEvent(
      this.plugin.app.vault.on('delete', this.handleFileDeleted.bind(this))
    );
    
    // 文件重命名事件
    this.plugin.registerEvent(
      this.plugin.app.vault.on('rename', this.handleFileRenamed.bind(this))
    );
  }
  
  /**
   * 处理文件创建事件
   * @param file 创建的文件
   * @author Bing
   */
  private handleFileCreated(file: TAbstractFile) {
    // 忽略被过滤的文件
    if (SyncFileFilter.shouldIgnoreFile(file, this.plugin.settings)) return;
    
    // 文件变更后进行同步
    this.debouncedSync();
  }
  
  /**
   * 处理文件修改事件
   * @param file 修改的文件
   * @author Bing
   */
  private handleFileModified(file: TAbstractFile) {
    // 忽略被过滤的文件
    if (SyncFileFilter.shouldIgnoreFile(file, this.plugin.settings)) return;
    
    // 文件变更后进行同步
    this.debouncedSync();
  }
  
  /**
   * 处理文件删除事件
   * @param file 删除的文件
   * @author Bing
   */
  private handleFileDeleted(file: TAbstractFile) {
    // 忽略被过滤的文件
    if (SyncFileFilter.shouldIgnoreFile(file, this.plugin.settings)) return;
    
    // 文件变更后进行同步
    this.debouncedSync();
  }
  
  /**
   * 处理文件重命名事件
   * @param file 重命名的文件
   * @param oldPath 旧路径
   * @author Bing
   */
  private handleFileRenamed(file: TAbstractFile, oldPath: string) {
    // 忽略被过滤的文件
    if (SyncFileFilter.shouldIgnoreFile(file, this.plugin.settings)) return;
    
    // 文件变更后进行同步
    this.debouncedSync();
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