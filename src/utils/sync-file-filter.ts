import { PluginSettings, FilterMode } from '@models/plugin-settings';
import { TAbstractFile, TFile } from 'obsidian';

/**
 * 同步文件过滤工具类
 * 负责判断文件是否应该被同步排除
 * 根据设置中的忽略规则进行过滤
 * 支持智能检测简单匹配、通配符和正则表达式
 * @author Bing
 */
export class SyncFileFilter {
  /**
   * 检测过滤模式
   * @param pattern 输入的过滤字符串
   * @returns 检测到的过滤模式
   * @author Bing
   */
  static detectFilterMode(pattern: string): FilterMode {
    // 检查是否包含正则表达式特殊字符
    const regexSpecialChars = /[\[\]{}()^$.|+\\]/g;
    
    // 检查是否包含通配符
    const wildcardChars = /[*?]/g;
    
    if (regexSpecialChars.test(pattern)) {
      return 'regex';
    } else if (wildcardChars.test(pattern)) {
      return 'wildcard';
    } else {
      return 'simple';
    }
  }

  /**
   * 将通配符模式转换为正则表达式
   * @param pattern 通配符模式
   * @returns 正则表达式
   * @author Bing
   */
  static wildcardToRegex(pattern: string): RegExp {
    // 转义所有正则表达式特殊字符，但保留*和?
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    
    // 替换通配符为正则表达式等价形式
    // * 匹配0个或多个任意字符
    // ? 匹配1个任意字符
    const converted = escaped
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    // 返回一个完整的正则表达式
    return new RegExp(`^${converted}$`);
  }
  
  /**
   * 根据检测到的模式匹配模式
   * @param pattern 过滤规则
   * @param path 要测试的路径
   * @returns 是否匹配
   * @author Bing
   */
  static matchWithAutoDetection(pattern: string, path: string): boolean {
    // 检测过滤模式
    const mode = this.detectFilterMode(pattern);
    
    switch (mode) {
      case 'simple':
        // 简单匹配：完全相等或是文件夹路径
        return path === pattern || path.startsWith(pattern + '/');
        
      case 'wildcard':
        // 通配符匹配：使用转换后的正则表达式
        try {
          const regex = this.wildcardToRegex(pattern);
          return regex.test(path);
        } catch (e) {
          console.error(`通配符转换为正则表达式失败: ${pattern}`, e);
          return false;
        }
        
      case 'regex':
        // 正则表达式匹配：直接使用
        try {
          const regex = new RegExp(pattern);
          return regex.test(path);
        } catch (e) {
          console.error(`无效的正则表达式: ${pattern}`, e);
          return false;
        }
    }
  }

  /**
   * 判断文件是否应该被忽略
   * @param file 文件
   * @param settings 插件设置
   * @returns 是否忽略
   * @author Bing
   */
  static shouldIgnoreFile(file: TAbstractFile | { path: string }, settings: PluginSettings): boolean {
    // 获取文件路径
    const path = typeof file === 'object' && 'path' in file ? file.path : '';
    // 获取文件名（不含路径）
    const fileName = path.split('/').pop() || '';
    
    // 检查是否在忽略的文件夹中
    for (const folderPattern of settings.ignoreFolders) {
      // 使用智能模式检测匹配
      if (this.matchWithAutoDetection(folderPattern.trim(), path)) {
        return true;
      }
      
      // 对于目录结构，还需要检查路径的各个部分
      const pathParts = path.split('/');
      for (const part of pathParts) {
        if (part && this.matchWithAutoDetection(folderPattern.trim(), part)) {
          return true;
        }
      }
    }
    
    // 检查是否是忽略的文件
    for (const filePattern of settings.ignoreFiles) {
      // 使用智能模式检测匹配
      if (this.matchWithAutoDetection(filePattern.trim(), path) || 
          this.matchWithAutoDetection(filePattern.trim(), fileName)) {
        return true;
      }
    }
    
    // 检查是否有忽略的扩展名
    let extension: string | undefined;
    
    if (file instanceof TFile) {
      extension = file.extension;
    } else {
      // 通过分割路径尝试获取扩展名
      const parts = path.split('.');
      extension = parts.length > 1 ? parts.pop() : undefined;
    }
    
    if (extension) {
      for (const extPattern of settings.ignoreExtensions) {
        // 使用智能模式检测匹配
        if (this.matchWithAutoDetection(extPattern.trim(), extension)) {
          return true;
        }
      }
    }
    
    return false;
  }
} 