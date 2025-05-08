import { PluginSettings, FilterMode } from '@models/plugin-settings';
import { TAbstractFile, TFile } from 'obsidian';
import { ModuleLogger } from '@services/log/log-service';
import CloudSyncPlugin from '@main';

/**
 * 同步文件过滤工具类
 * 负责判断文件是否应该被同步排除
 * 根据设置中的忽略规则进行过滤
 * 支持智能检测简单匹配、通配符和正则表达式
 * @author Bing
 */
export class SyncFileFilter {
  // 静态日志记录器
  private static logger: ModuleLogger | null = null;
  // 存储configDir的静态引用
  private static configDir: string | null = null;
  
  /**
   * 配置工具类的日志记录器
   * @param logger 日志记录器
   */
  static configureLogger(logger: ModuleLogger): void {
    SyncFileFilter.logger = logger;
  }
  
  /**
   * 配置配置目录路径
   * @param plugin 插件实例，用于获取configDir
   */
  static configureConfigDir(plugin: CloudSyncPlugin): void {
    SyncFileFilter.configDir = plugin.app.vault.configDir;
    this.logger?.debug(`配置目录设置为: ${SyncFileFilter.configDir}`);
  }
  
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
    
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      // 如果以斜杠开始和结束，视为正则表达式
      this.logger?.debug(`检测到正则表达式过滤规则: ${pattern}`);
      return 'regex';
    } else if (wildcardChars.test(pattern)) {
      // 如果包含通配符，但不以斜杠封装，视为通配符匹配
      this.logger?.debug(`检测到通配符过滤规则: ${pattern}`);
      return 'wildcard';
    } else if (regexSpecialChars.test(pattern)) {
      // 如果包含特殊字符但不是明确的正则表达式格式，建议作为正则处理
      this.logger?.debug(`检测到含有特殊字符的过滤规则，作为正则处理: ${pattern}`);
      return 'regex';
    } else {
      // 其他情况视为简单部分匹配
      this.logger?.debug(`检测到简单匹配过滤规则: ${pattern}`);
      return 'simple';
    }
  }
  
  /**
   * 转换过滤模式为正则表达式
   * @param pattern 过滤字符串
   * @param mode 过滤模式
   * @returns 编译后的正则表达式
   * @author Bing
   */
  static patternToRegex(pattern: string, mode: FilterMode): RegExp {
    try {
      if (mode === 'regex') {
        // 如果是原生正则表达式格式，提取正则表达式内容
        if (pattern.startsWith('/') && pattern.endsWith('/')) {
          const regexContent = pattern.slice(1, -1);
          this.logger?.debug(`正则表达式解析: ${pattern} -> ${regexContent}`);
          return new RegExp(regexContent);
        }
        // 否则直接作为正则表达式内容使用
        return new RegExp(pattern);
      } else if (mode === 'wildcard') {
        // 转换通配符为正则表达式
        // * 匹配任意字符（包括路径分隔符）
        // ? 匹配单个字符
        const regexPattern = pattern
          .replace(/\./g, '\\.') // 转义点号
          .replace(/\*/g, '.*')  // * 转换为 .*
          .replace(/\?/g, '.');  // ? 转换为 .
        
        this.logger?.debug(`通配符转换为正则: ${pattern} -> ${regexPattern}`);
        return new RegExp(`^${regexPattern}$`);
      } else {
        // 简单匹配模式，任何位置匹配即可
        this.logger?.debug(`简单匹配转换为正则: ${pattern}`);
        return new RegExp(pattern);
      }
    } catch (error) {
      this.logger?.error(`过滤规则转换为正则表达式失败: ${pattern}`, { error: error instanceof Error ? error.message : String(error) });
      // 如果转换失败，返回一个匹配所有内容的正则表达式
      return /^.*/;
    }
  }
  
  /**
   * 判断路径是否匹配过滤规则
   * @param path 文件路径
   * @param pattern 过滤规则
   * @param mode 过滤模式
   * @returns 是否匹配
   * @author Bing
   */
  static isPathMatched(path: string, pattern: string, mode: FilterMode): boolean {
    try {
      // 对于空模式，不匹配任何路径
      if (!pattern.trim()) {
        return false;
      }
      
      // 转换为正则表达式进行匹配
      const regex = this.patternToRegex(pattern, mode);
      const isMatch = regex.test(path);
      
      if (isMatch) {
        this.logger?.debug(`路径 "${path}" 匹配过滤规则 "${pattern}" (${mode})`);
      }
      
      return isMatch;
    } catch (error) {
      this.logger?.error(`路径匹配检查失败: ${path} -> ${pattern} (${mode})`, { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
  
  /**
   * 判断文件是否应该被排除在同步之外
   * @param file 文件对象或带有path属性的对象
   * @param settings 插件设置
   * @returns 是否应该排除
   */
  static shouldExcludeFile(file: TFile | { path: string }, settings: PluginSettings): boolean {
    const filePath = file.path;
    const extension = file instanceof TFile ? file.extension : filePath.split('.').pop() || '';
    
    // 检查路径长度限制（Windows MAX_PATH = 260）
    if (filePath.length > 200) {
      this.logger?.warning(`文件路径过长，被排除: ${filePath}`);
      return true;
    }
    
    // 检查是否是系统文件（以.开头的隐藏文件）
    const fileName = filePath.split('/').pop() || '';
    if (fileName.startsWith('.')) {
      this.logger?.debug(`排除系统文件: ${filePath}`);
      return true;
    }
    
    // 检查是否是Obsidian配置文件
    // 使用configDir而不是硬编码的.obsidian
    const configFolderName = this.configDir ? `${this.configDir}/` : '.obsidian/';
    const configDirs = [configFolderName, '.trash/'];
    if (configDirs.some(dir => filePath.includes('/' + dir))) {
      this.logger?.debug(`排除Obsidian配置文件: ${filePath}`);
      return true;
    }
    
    // 检查文件名忽略规则
    if (settings.ignoreFiles && settings.ignoreFiles.length > 0) {
      for (const filePattern of settings.ignoreFiles) {
        if (!filePattern.trim()) continue;
        
        const mode = this.detectFilterMode(filePattern);
        if (this.isPathMatched(fileName, filePattern, mode) || 
            this.isPathMatched(filePath, filePattern, mode)) {
          this.logger?.debug(`文件 "${filePath}" 匹配忽略文件规则 "${filePattern}"`);
          return true;
        }
      }
    }
    
    // 检查扩展名忽略规则
    if (settings.ignoreExtensions && settings.ignoreExtensions.length > 0) {
      if (extension) {
        for (const extPattern of settings.ignoreExtensions) {
          if (!extPattern.trim()) continue;
          
          const mode = this.detectFilterMode(extPattern);
          if (this.isPathMatched(extension, extPattern, mode)) {
            this.logger?.debug(`文件 "${filePath}" 匹配忽略扩展名规则 "${extPattern}"`);
            return true;
          }
        }
      }
    }
    
    // 没有匹配任何排除规则，应该包含此文件
    return false;
  }
  
  /**
   * 判断目录是否应该被排除
   * @param dirPath 目录路径
   * @param settings 插件设置
   * @returns 是否应该排除
   * @author Bing
   */
  static shouldExcludeDirectory(dirPath: string, settings: PluginSettings): boolean {
    // 标准化目录路径，确保以/结尾
    const standardDirPath = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    
    // 检查系统目录（以.开头的隐藏目录）
    const isSystemDir = standardDirPath.split('/').some(segment => segment.startsWith('.') && segment !== '.');
    if (isSystemDir) {
      this.logger?.debug(`排除系统目录: ${standardDirPath}`);
      return true;
    }
    
    // 检查是否是Obsidian配置目录
    // 使用configDir而不是硬编码的.obsidian
    const configFolderName = this.configDir ? `${this.configDir}/` : '.obsidian/';
    const configDirs = [configFolderName, '.trash/'];
    if (configDirs.some(dir => standardDirPath.includes('/' + dir))) {
      this.logger?.debug(`排除Obsidian配置目录: ${standardDirPath}`);
      return true;
    }
    
    // 检查文件夹忽略规则
    if (settings.ignoreFolders && settings.ignoreFolders.length > 0) {
      for (const folderPattern of settings.ignoreFolders) {
        if (!folderPattern.trim()) continue;
        
        const mode = this.detectFilterMode(folderPattern);
        
        // 获取目录名（不包含路径）
        const dirName = standardDirPath.split('/').filter(Boolean).pop() || '';
        
        if (this.isPathMatched(standardDirPath, folderPattern, mode) || 
            this.isPathMatched(dirName, folderPattern, mode)) {
          this.logger?.debug(`目录 "${standardDirPath}" 匹配忽略文件夹规则 "${folderPattern}"`);
          return true;
        }
      }
    }
    
    // 没有匹配任何排除规则，应该包含此目录
    return false;
  }
} 