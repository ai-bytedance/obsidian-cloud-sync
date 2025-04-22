/**
 * 连接状态枚举
 * @author Bing
 */
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}

/**
 * 文件信息接口
 * @author Bing
 */
export interface FileInfo {
  path: string;
  name: string;
  isFolder: boolean;
  size: number;
  modifiedTime: Date;
  etag?: string;
}

/**
 * 文件元数据接口，扩展自文件信息
 * @author Bing
 */
export interface FileMetadata extends FileInfo {
  createdTime?: Date;
  contentType?: string;
  hash?: string;
}

/**
 * 配额信息接口
 * @author Bing
 */
export interface QuotaInfo {
  used: number;
  available: number;
  total: number;
}

/**
 * 存储提供者错误类
 * @author Bing
 */
export class StorageProviderError extends Error {
  /**
   * 创建存储提供者错误实例
   * @param message 错误消息
   * @param code 错误代码
   * @param originalError 原始错误（可选）
   * @author Bing
   */
  constructor(
    message: string,
    public readonly code: string = 'UNKNOWN_ERROR',
    public readonly originalError?: Error | any
  ) {
    super(message);
    this.name = 'StorageProviderError';
    
    // 确保正确的原型链
    Object.setPrototypeOf(this, StorageProviderError.prototype);
  }
  
  /**
   * 从其他错误创建StorageProviderError
   * @param error 原始错误
   * @param code 错误代码（可选，默认为'UNKNOWN_ERROR'）
   * @param messagePrefix 消息前缀（可选）
   * @returns StorageProviderError实例
   * @author Bing
   */
  static fromError(error: unknown, code?: string, messagePrefix?: string): StorageProviderError {
    // 如果已经是StorageProviderError，直接返回
    if (error instanceof StorageProviderError) {
      return error;
    }
    
    // 提取错误消息
    let errorMessage = '';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }
    
    // 添加前缀
    const message = messagePrefix ? `${messagePrefix}: ${errorMessage}` : errorMessage;
    
    // 使用推断的错误代码或默认代码
    const errorCode = (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') 
      ? error.code 
      : (code || 'UNKNOWN_ERROR');
    
    return new StorageProviderError(message, errorCode, error instanceof Error ? error : undefined);
  }
  
  /**
   * 检查错误是否为StorageProviderError
   * @param error 要检查的错误
   * @returns 是否为StorageProviderError
   * @author Bing
   */
  static isStorageProviderError(error: unknown): error is StorageProviderError {
    return error instanceof StorageProviderError;
  }
}

/**
 * 存储提供商接口
 * @author Bing
 */
export interface StorageProvider {
  /**
   * 获取提供商名称
   * @returns 名称
   * @author Bing
   */
  getName(): string;

  /**
   * 获取提供商类型
   * @returns 类型
   * @author Bing
   */
  getType(): string;

  /**
   * 获取连接状态
   * @returns 连接状态
   * @author Bing
   */
  getStatus(): ConnectionStatus;

  /**
   * 连接到存储服务
   * @returns 连接是否成功
   * @author Bing
   */
  connect(): Promise<boolean>;

  /**
   * 断开与存储服务的连接
   * @author Bing
   */
  disconnect(): Promise<void>;

  /**
   * 测试连接
   * @returns 连接是否成功
   * @author Bing
   */
  testConnection(): Promise<boolean>;

  /**
   * 列出指定路径下的文件
   * @param path 路径
   * @returns 文件列表
   * @author Bing
   */
  listFiles(path: string): Promise<FileInfo[]>;

  /**
   * 下载文件
   * @param remotePath 远程路径
   * @param localPath 本地路径
   * @author Bing
   */
  downloadFile(remotePath: string, localPath: string): Promise<void>;

  /**
   * 下载文件内容
   * @param remotePath 远程路径
   * @returns 文件内容（字符串或二进制数据）
   * @author Bing
   */
  downloadFileContent?(remotePath: string): Promise<string | ArrayBuffer>;

  /**
   * 上传文件
   * @param localPath 本地路径
   * @param remotePath 远程路径
   * @author Bing
   */
  uploadFile(localPath: string, remotePath: string): Promise<void>;

  /**
   * 删除文件
   * @param remotePath 远程路径
   * @author Bing
   */
  deleteFile(remotePath: string): Promise<void>;

  /**
   * 移动文件
   * @param oldPath 原路径
   * @param newPath 新路径
   * @author Bing
   */
  moveFile(oldPath: string, newPath: string): Promise<void>;

  /**
   * 创建文件夹
   * @param path 路径
   * @author Bing
   */
  createFolder(path: string): Promise<void>;

  /**
   * 删除文件夹
   * @param path 路径
   * @author Bing
   */
  deleteFolder(path: string): Promise<void>;

  /**
   * 检查文件夹是否存在
   * @param path 路径
   * @returns 文件夹是否存在
   * @author Bing
   */
  folderExists(path: string): Promise<boolean>;

  /**
   * 获取文件元数据
   * @param path 路径
   * @returns 文件元数据
   * @author Bing
   */
  getFileMetadata(path: string): Promise<FileMetadata>;

  /**
   * 获取配额信息
   * @returns 配额信息
   * @author Bing
   */
  getQuota(): Promise<QuotaInfo>;
} 