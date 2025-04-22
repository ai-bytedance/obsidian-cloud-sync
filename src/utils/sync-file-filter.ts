import { PluginSettings } from '@models/plugin-settings';
import { TAbstractFile, TFile } from 'obsidian';

/**
 * 同步文件过滤工具类
 * 负责判断文件是否应该被同步排除
 * 根据设置中的忽略规则进行过滤
 * @author Bing
 */
export class SyncFileFilter {
  /**
   * 判断文件是否应该被忽略
   * @param file 文件
   * @param settings 插件设置
   * @returns 是否忽略
   * @author Bing
   */
  static shouldIgnoreFile(file: TAbstractFile | { path: string }, settings: PluginSettings): boolean {
    const path = typeof file === 'object' && 'path' in file ? file.path : '';
    
    // 检查是否在忽略的文件夹中
    for (const folder of settings.ignoreFolders) {
      if (path.startsWith(folder + '/') || path === folder) {
        return true;
      }
    }
    
    // 检查是否是忽略的文件
    for (const ignoreFile of settings.ignoreFiles) {
      if (path === ignoreFile) {
        return true;
      }
    }
    
    // 检查是否有忽略的扩展名
    if (file instanceof TFile) {
      const extension = file.extension;
      if (extension && settings.ignoreExtensions.includes(extension)) {
        return true;
      }
    } else {
      // 如果不是TFile实例，通过路径检查扩展名
      const extension = path.split('.').pop();
      if (extension && settings.ignoreExtensions.includes(extension)) {
        return true;
      }
    }
    
    return false;
  }
} 