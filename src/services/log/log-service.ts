/**
 * 日志服务类
 * 负责收集、存储和导出日志信息
 * @author Bing
 */
import { LogLevel } from '@models/plugin-settings';
import { App, TFile, normalizePath } from 'obsidian';

// 日志条目接口
interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  data?: any;
}

// 原始控制台方法的备份
interface OriginalConsoleMethods {
  log: typeof console.log;
  debug: typeof console.debug;
  info: typeof console.info;
  warn: typeof console.warn;
  error: typeof console.error;
}

/**
 * 模块化日志类，为特定模块提供日志记录
 */
export class ModuleLogger {
  constructor(
    private logService: LogService,
    private moduleName: string
  ) {}
  
  /**
   * 记录调试级别日志
   * @param message 日志消息
   * @param data 附加数据（可选）
   */
  debug(message: string, data?: any): void {
    this.logService.logWithModule('debug', this.moduleName, message, data);
  }
  
  /**
   * 记录信息级别日志
   * @param message 日志消息
   * @param data 附加数据（可选）
   */
  info(message: string, data?: any): void {
    this.logService.logWithModule('info', this.moduleName, message, data);
  }
  
  /**
   * 记录警告级别日志
   * @param message 日志消息
   * @param data 附加数据（可选）
   */
  warning(message: string, data?: any): void {
    this.logService.logWithModule('warning', this.moduleName, message, data);
  }
  
  /**
   * 记录错误级别日志
   * @param message 日志消息
   * @param data 附加数据（可选）
   */
  error(message: string, data?: any): void {
    this.logService.logWithModule('error', this.moduleName, message, data);
  }
}

/**
 * 日志服务类
 */
export class LogService {
  // 存储日志的数组
  private logs: LogEntry[] = [];
  // 最大日志条目数，防止内存占用过大
  private readonly MAX_LOG_ENTRIES = 5000;
  // 当前日志级别
  private currentLevel: LogLevel = 'info';
  // 是否已拦截控制台
  private consoleIntercepted: boolean = false;
  // 原始控制台方法
  private originalConsole: OriginalConsoleMethods;
  // Obsidian应用实例
  private app?: App;
  // 日志文件路径 - 使用getter而不是硬编码路径
  private get logFilePath(): string {
    // 如果app可用并且已初始化，使用configDir
    if (this.app?.vault?.configDir) {
      return `${this.app.vault.configDir}/plugins/cloud-sync/logs/cloud-sync.log`;
    }
    // 否则回退到默认值
    return 'plugins/cloud-sync/logs/cloud-sync.log';
  }
  // 最大日志文件大小（5MB）
  private readonly MAX_LOG_FILE_SIZE = 5 * 1024 * 1024;
  // 保留的历史日志文件数量
  private readonly MAX_LOG_HISTORY_FILES = 10;

  /**
   * 构造函数
   * @param level 初始日志级别
   * @param app Obsidian应用实例（可选）
   */
  constructor(level: LogLevel = 'info', app?: App) {
    this.currentLevel = level;
    this.app = app;
    
    // 保存原始控制台方法
    this.originalConsole = {
      log: console.log,
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error
    };
    
    // 记录初始化日志
    this.info('日志服务已初始化', { level: this.currentLevel });
  }

  /**
   * 拦截控制台输出
   * 确保所有console输出也被记录到日志系统
   */
  interceptConsole(): void {
    if (this.consoleIntercepted) {
      return;
    }
    
    const self = this;
    
    // 覆盖控制台方法
    console.log = function(...args: any[]) {
      self.captureConsoleOutput('info', args);
      self.originalConsole.log.apply(console, args);
    };
    
    console.debug = function(...args: any[]) {
      self.captureConsoleOutput('debug', args);
      self.originalConsole.debug.apply(console, args);
    };
    
    console.info = function(...args: any[]) {
      self.captureConsoleOutput('info', args);
      self.originalConsole.info.apply(console, args);
    };
    
    console.warn = function(...args: any[]) {
      self.captureConsoleOutput('warning', args);
      self.originalConsole.warn.apply(console, args);
    };
    
    console.error = function(...args: any[]) {
      self.captureConsoleOutput('error', args);
      self.originalConsole.error.apply(console, args);
    };
    
    this.consoleIntercepted = true;
    this.info('控制台输出已拦截');
  }

  /**
   * 恢复原始控制台方法
   */
  restoreConsole(): void {
    if (!this.consoleIntercepted) {
      return;
    }
    
    // 恢复原始方法
    console.log = this.originalConsole.log;
    console.debug = this.originalConsole.debug;
    console.info = this.originalConsole.info;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    
    this.consoleIntercepted = false;
    this.info('控制台输出拦截已还原');
  }

  /**
   * 捕获控制台输出
   * @param level 日志级别
   * @param args 控制台参数
   */
  private captureConsoleOutput(level: LogLevel, args: any[]): void {
    if (args.length === 0) {
      return;
    }
    
    // 处理控制台输出格式
    let message = '';
    let data = undefined;
    
    if (typeof args[0] === 'string') {
      message = args[0];
      
      // 如果有多个参数，将剩余参数作为数据
      if (args.length > 1) {
        data = args.slice(1);
      }
    } else {
      // 如果第一个参数不是字符串，尝试转换所有参数
      try {
        message = args.map(arg => {
          if (typeof arg === 'object') {
            return JSON.stringify(arg);
          }
          return String(arg);
        }).join(' ');
      } catch (e) {
        message = '[无法转换的控制台输出]';
        data = args;
      }
    }
    
    // 记录到日志
    this.log(level, message, data);
  }

  /**
   * 设置日志级别
   * @param level 日志级别
   */
  setLogLevel(level: LogLevel): void {
    this.currentLevel = level;
    this.info('日志级别已更改', { level });
  }

  /**
   * 获取当前日志级别
   * @returns 当前日志级别
   */
  getLogLevel(): LogLevel {
    return this.currentLevel;
  }

  /**
   * 设置Obsidian应用实例
   * @param app Obsidian应用实例
   */
  setApp(app: App): void {
    this.app = app;
  }

  /**
   * 获取模块化日志记录器
   * @param module 模块名称
   * @returns 模块化日志记录器
   */
  getModuleLogger(module: string): ModuleLogger {
    return new ModuleLogger(this, module);
  }
  
  /**
   * 记录带有模块信息的日志
   * @param level 日志级别
   * @param module 模块名称
   * @param message 日志消息
   * @param data 附加数据（可选）
   */
  logWithModule(level: LogLevel, module: string, message: string, data?: any): void {
    this.log(level, `[${module}] ${message}`, data);
  }

  /**
   * 记录调试级别日志
   * @param message 日志消息
   * @param data 附加数据（可选）
   */
  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  /**
   * 记录信息级别日志
   * @param message 日志消息
   * @param data 附加数据（可选）
   */
  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  /**
   * 记录警告级别日志
   * @param message 日志消息
   * @param data 附加数据（可选）
   */
  warning(message: string, data?: any): void {
    this.log('warning', message, data);
  }

  /**
   * 记录错误级别日志
   * @param message 日志消息
   * @param data 附加数据（可选）
   */
  error(message: string, data?: any): void {
    this.log('error', message, data);
  }

  /**
   * 内部日志记录函数
   * @param level 日志级别
   * @param message 日志消息
   * @param data 附加数据（可选）
   */
  private log(level: LogLevel, message: string, data?: any): void {
    // 非调试模式下，只记录错误级别的日志
    // 使用更安全的方式检查 debugMode 设置
    let debugMode = false;
    try {
      // @ts-ignore - 忽略类型检查，因为我们需要访问插件实例
      debugMode = this.app?.plugins?.plugins['cloud-sync']?.settings?.debugMode || false;
    } catch (e) {
      // 如果出现错误，默认为非调试模式
    }
    
    if (!debugMode && level !== 'error') {
      return;
    }
    
    // 根据当前设置的日志级别过滤
    if (!this.shouldLog(level)) {
      return;
    }

    // 添加日志条目
    this.logs.push({
      timestamp: new Date(),
      level,
      message,
      data: data ? this.safeStringify(data) : undefined
    });

    // 如果超过最大日志条目数，移除最早的日志
    if (this.logs.length > this.MAX_LOG_ENTRIES) {
      this.logs.shift();
    }

    // 同时输出到控制台（如果未拦截）
    if (!this.consoleIntercepted) {
      const consoleMethod = this.getConsoleMethod(level);
      if (data !== undefined) {
        consoleMethod(`${message}:`, data);
      } else {
        consoleMethod(message);
      }
    }
    
    // 尝试保存到本地文件
    this.persistLogToFile();
  }

  /**
   * 获取控制台对应的日志方法
   * @param level 日志级别
   * @returns 控制台方法
   */
  private getConsoleMethod(level: LogLevel): (...args: any[]) => void {
    switch (level) {
      case 'debug': return this.originalConsole.debug;
      case 'info': return this.originalConsole.info;
      case 'warning': return this.originalConsole.warn;
      case 'error': return this.originalConsole.error;
      default: return this.originalConsole.log;
    }
  }

  /**
   * 根据日志级别判断是否应该记录日志
   * @param level 当前日志条目的级别
   * @returns 是否应该记录
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      'debug': 0,
      'info': 1,
      'warning': 2,
      'error': 3
    };

    return levels[level] >= levels[this.currentLevel];
  }

  /**
   * 安全地将对象转换为字符串
   * @param obj 要转换的对象
   * @returns 安全的字符串表示
   */
  private safeStringify(obj: any): string {
    try {
      return JSON.stringify(obj, (key, value) => {
        // 处理循环引用和其他特殊情况
        if (typeof value === 'object' && value !== null) {
          if (Object.keys(value).length > 100) {
            return '[大对象]';
          }
        }
        return value;
      }, 2);
    } catch (error) {
      return `[无法序列化: ${error.message}]`;
    }
  }

  /**
   * 清除日志
   */
  clear(): void {
    this.logs = [];
    this.info('日志已清除');
  }

  /**
   * 导出日志为字符串
   * @param levelFilter 可选的日志级别过滤器
   * @returns 格式化的日志字符串
   */
  export(levelFilter?: LogLevel): string {
    // 筛选日志
    const filteredLogs = levelFilter
      ? this.logs.filter(log => this.shouldExport(log.level, levelFilter))
      : this.logs;

    // 构建日志字符串
    let result = `=== Cloud Sync 日志 ===\n`;
    result += `导出时间: ${new Date().toISOString()}\n`;
    result += `日志级别: ${levelFilter || this.currentLevel}\n`;
    result += `日志条目数: ${filteredLogs.length}\n`;
    result += `================================================\n\n`;

    if (filteredLogs.length === 0) {
      result += '没有符合条件的日志数据\n';
      return result;
    }

    // 添加每条日志记录
    filteredLogs.forEach((log, index) => {
      const timeStr = log.timestamp.toISOString();
      const levelStr = this.formatLogLevel(log.level);
      
      result += `[${timeStr}] [${levelStr}] ${log.message}\n`;
      
      if (log.data) {
        result += `  数据: ${log.data}\n`;
      }
      
      if (index < filteredLogs.length - 1) {
        result += '\n';
      }
    });

    return result;
  }

  /**
   * 判断是否应该导出该级别的日志
   * @param logLevel 日志条目的级别
   * @param filterLevel 过滤级别
   * @returns 是否应该导出
   */
  private shouldExport(logLevel: LogLevel, filterLevel: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      'debug': 0,
      'info': 1,
      'warning': 2,
      'error': 3
    };

    return levels[logLevel] >= levels[filterLevel];
  }

  /**
   * 格式化日志级别文本
   * @param level 日志级别
   * @returns 格式化后的文本
   */
  private formatLogLevel(level: LogLevel): string {
    switch (level) {
      case 'debug': return '调试';
      case 'info': return '信息';
      case 'warning': return '警告';
      case 'error': return '错误';
      default: return level;
    }
  }

  /**
   * 将日志持久化到文件
   * 仅当app对象可用时执行
   */
  private async persistLogToFile(): Promise<void> {
    if (!this.app) {
      return;
    }

    try {
      // 检查是否处于调试模式
      let debugMode = false;
      try {
        // @ts-ignore - 忽略类型检查，因为我们需要访问插件实例
        debugMode = this.app?.plugins?.plugins['cloud-sync']?.settings?.debugMode || false;
      } catch (e) {
        // 如果出现错误，默认为非调试模式
      }
      
      // 获取最新日志条目
      if (this.logs.length === 0) {
        return;
      }
      
      const latestLog = this.logs[this.logs.length - 1];
      
      // 非调试模式下，只持久化错误日志
      if (!debugMode && latestLog.level !== 'error') {
        return;
      }

      // 确保日志目录存在
      const logDirPath = normalizePath(this.logFilePath.substring(0, this.logFilePath.lastIndexOf('/')));
      const adapter = this.app.vault.adapter;
      
      if (!await adapter.exists(logDirPath)) {
        await adapter.mkdir(logDirPath);
      }
      
      // 格式化日志条目
      const timeStr = latestLog.timestamp.toISOString();
      const levelStr = this.formatLogLevel(latestLog.level);
      
      let logLine = `[${timeStr}] [${levelStr}] ${latestLog.message}`;
      if (latestLog.data) {
        logLine += `\n  数据: ${latestLog.data}`;
      }
      logLine += '\n';
      
      // 检查日志文件大小并可能进行轮转
      let needRotation = false;
      
      if (await adapter.exists(this.logFilePath)) {
        const stat = await adapter.stat(this.logFilePath);
        if (stat && stat.size > this.MAX_LOG_FILE_SIZE) {
          needRotation = true;
        }
      }
      
      // 执行日志文件轮转
      if (needRotation) {
        await this.rotateLogFiles();
      }
      
      // 追加到日志文件
      if (await adapter.exists(this.logFilePath)) {
        const existingContent = await adapter.read(this.logFilePath);
        await adapter.write(this.logFilePath, existingContent + logLine);
      } else {
        const header = `=== Cloud Sync 日志 ===\n创建于: ${new Date().toISOString()}\n\n`;
        await adapter.write(this.logFilePath, header + logLine);
      }
    } catch (error) {
      // 不使用this.error避免递归
      if (!this.consoleIntercepted) {
        this.originalConsole.error('写入日志文件失败:', error);
      }
    }
  }
  
  /**
   * 执行日志文件轮转
   * 将当前日志文件移动为备份，并创建新的日志文件
   */
  private async rotateLogFiles(): Promise<void> {
    if (!this.app) {
      return;
    }
    
    const adapter = this.app.vault.adapter;
    const basePath = this.logFilePath;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = basePath.replace('.log', `-${timestamp}.log`);
    
    try {
      // 如果旧文件存在，重命名它
      if (await adapter.exists(basePath)) {
        await adapter.rename(basePath, rotatedPath);
        this.info(`日志文件已轮转: ${basePath} -> ${rotatedPath}`);
      }
      
      // 清理旧日志文件，保留最近的几个
      await this.cleanupOldLogFiles();
    } catch (error) {
      // 记录错误但继续执行
      if (!this.consoleIntercepted) {
        this.originalConsole.error('日志文件轮转失败:', error);
      }
    }
  }
  
  /**
   * 清理旧日志文件，保留最近的几个
   */
  private async cleanupOldLogFiles(): Promise<void> {
    if (!this.app) {
      return;
    }
    
    const adapter = this.app.vault.adapter;
    const logDirPath = normalizePath(this.logFilePath.substring(0, this.logFilePath.lastIndexOf('/')));
    const logFilePrefix = this.logFilePath.substring(this.logFilePath.lastIndexOf('/') + 1).replace('.log', '');
    
    try {
      // 列出日志目录中的所有文件
      const files = await adapter.list(logDirPath);
      
      // 过滤出轮转的日志文件
      const logFiles = files.files
        .filter(file => {
          const fileName = file.substring(file.lastIndexOf('/') + 1);
          return fileName.startsWith(logFilePrefix) && 
                 fileName !== logFilePrefix + '.log' &&
                 fileName.endsWith('.log');
        })
        .sort()
        .reverse(); // 最新的文件排在前面
      
      // 保留最近的日志文件，删除其余的
      if (logFiles.length > this.MAX_LOG_HISTORY_FILES) {
        for (let i = this.MAX_LOG_HISTORY_FILES; i < logFiles.length; i++) {
          try {
            await adapter.remove(logFiles[i]);
            this.info(`已删除旧日志文件: ${logFiles[i]}`);
          } catch (error) {
            // 忽略单个文件删除失败
            if (!this.consoleIntercepted) {
              this.originalConsole.error(`删除旧日志文件失败: ${logFiles[i]}`, error);
            }
          }
        }
      }
    } catch (error) {
      // 记录错误但继续执行
      if (!this.consoleIntercepted) {
        this.originalConsole.error('清理旧日志文件失败:', error);
      }
    }
  }
  
  /**
   * 将所有累积的日志保存到文件
   * @returns 是否成功保存
   */
  async saveAllLogsToFile(): Promise<boolean> {
    if (!this.app) {
      return false;
    }
    
    try {
      // 确保日志目录存在
      const logDirPath = normalizePath(this.logFilePath.substring(0, this.logFilePath.lastIndexOf('/')));
      const adapter = this.app.vault.adapter;
      
      if (!await adapter.exists(logDirPath)) {
        await adapter.mkdir(logDirPath);
      }
      
      // 导出所有日志，明确使用当前日志级别
      const logContent = this.export(this.currentLevel);
      
      // 检查文件大小是否需要轮转
      let needRotation = false;
      if (await adapter.exists(this.logFilePath)) {
        const stat = await adapter.stat(this.logFilePath);
        if (stat && stat.size > this.MAX_LOG_FILE_SIZE) {
          needRotation = true;
        }
      }
      
      // 执行日志文件轮转
      if (needRotation) {
        await this.rotateLogFiles();
      }
      
      // 写入文件
      await adapter.write(this.logFilePath, logContent);
      
      return true;
    } catch (error) {
      if (!this.consoleIntercepted) {
        this.originalConsole.error('保存所有日志到文件失败:', error);
      }
      return false;
    }
  }
} 