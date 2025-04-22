/**
 * 日志服务类
 * 负责收集、存储和导出日志信息
 * @author Chatbot
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
  // 日志文件路径
  private readonly LOG_FILE_PATH = '.obsidian/plugins/obsidian-cloud-sync/logs/cloud-sync.log';

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
      // 确保日志目录存在
      const logDirPath = normalizePath(this.LOG_FILE_PATH.substring(0, this.LOG_FILE_PATH.lastIndexOf('/')));
      const adapter = this.app.vault.adapter;
      
      if (!await adapter.exists(logDirPath)) {
        await adapter.mkdir(logDirPath);
      }
      
      // 格式化最新的日志条目
      if (this.logs.length === 0) {
        return;
      }
      
      const latestLog = this.logs[this.logs.length - 1];
      const timeStr = latestLog.timestamp.toISOString();
      const levelStr = this.formatLogLevel(latestLog.level);
      
      let logLine = `[${timeStr}] [${levelStr}] ${latestLog.message}`;
      if (latestLog.data) {
        logLine += `\n  数据: ${latestLog.data}`;
      }
      logLine += '\n';
      
      // 追加到日志文件
      if (await adapter.exists(this.LOG_FILE_PATH)) {
        const existingContent = await adapter.read(this.LOG_FILE_PATH);
        await adapter.write(this.LOG_FILE_PATH, existingContent + logLine);
      } else {
        const header = `=== Cloud Sync 日志 ===\n创建于: ${new Date().toISOString()}\n\n`;
        await adapter.write(this.LOG_FILE_PATH, header + logLine);
      }
    } catch (error) {
      // 不使用this.error避免递归
      if (!this.consoleIntercepted) {
        this.originalConsole.error('写入日志文件失败:', error);
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
      const logDirPath = normalizePath(this.LOG_FILE_PATH.substring(0, this.LOG_FILE_PATH.lastIndexOf('/')));
      const adapter = this.app.vault.adapter;
      
      if (!await adapter.exists(logDirPath)) {
        await adapter.mkdir(logDirPath);
      }
      
      // 导出所有日志，明确使用当前日志级别
      const logContent = this.export(this.currentLevel);
      
      // 写入文件
      await adapter.write(this.LOG_FILE_PATH, logContent);
      
      return true;
    } catch (error) {
      if (!this.consoleIntercepted) {
        this.originalConsole.error('保存所有日志到文件失败:', error);
      }
      return false;
    }
  }
} 