/**
 * 连接状态枚举
 */
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}

/**
 * 文件信息接口
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
 */
export interface FileMetadata extends FileInfo {
  createdTime?: Date;
  contentType?: string;
  hash?: string;
}

/**
 * 配额信息接口
 */
export interface QuotaInfo {
  used: number;
  available: number;
  total: number;
}

/**
 * 存储提供商错误
 */
export class StorageProviderError extends Error {
  public readonly code: string;
  public readonly originalError?: Error;

  constructor(message: string, code: string, originalError?: Error) {
    super(message);
    this.name = 'StorageProviderError';
    this.code = code;
    this.originalError = originalError;

    // 确保正确的原型链
    Object.setPrototypeOf(this, StorageProviderError.prototype);
  }
}

/**
 * 存储提供商接口
 */
export interface StorageProvider {
  /**
   * 获取提供商名称
   * @returns 名称
   */
  getName(): string;

  /**
   * 获取提供商类型
   * @returns 类型
   */
  getType(): string;

  /**
   * 获取连接状态
   * @returns 连接状态
   */
  getStatus(): ConnectionStatus;

  /**
   * 连接到存储服务
   * @returns 连接是否成功
   */
  connect(): Promise<boolean>;

  /**
   * 断开与存储服务的连接
   */
  disconnect(): Promise<void>;

  /**
   * 测试连接
   * @returns 连接是否成功
   */
  testConnection(): Promise<boolean>;

  /**
   * 列出指定路径下的文件
   * @param path 路径
   * @returns 文件列表
   */
  listFiles(path: string): Promise<FileInfo[]>;

  /**
   * 下载文件
   * @param remotePath 远程路径
   * @param localPath 本地路径
   */
  downloadFile(remotePath: string, localPath: string): Promise<void>;

  /**
   * 下载文件内容
   * @param remotePath 远程路径
   * @returns 文件内容（字符串或二进制数据）
   */
  downloadFileContent?(remotePath: string): Promise<string | ArrayBuffer>;

  /**
   * 上传文件
   * @param localPath 本地路径
   * @param remotePath 远程路径
   */
  uploadFile(localPath: string, remotePath: string): Promise<void>;

  /**
   * 删除文件
   * @param remotePath 远程路径
   */
  deleteFile(remotePath: string): Promise<void>;

  /**
   * 移动文件
   * @param oldPath 原路径
   * @param newPath 新路径
   */
  moveFile(oldPath: string, newPath: string): Promise<void>;

  /**
   * 创建文件夹
   * @param path 路径
   */
  createFolder(path: string): Promise<void>;

  /**
   * 删除文件夹
   * @param path 路径
   */
  deleteFolder(path: string): Promise<void>;

  /**
   * 检查文件夹是否存在
   * @param path 路径
   * @returns 文件夹是否存在
   */
  folderExists(path: string): Promise<boolean>;

  /**
   * 获取文件元数据
   * @param path 路径
   * @returns 文件元数据
   */
  getFileMetadata(path: string): Promise<FileMetadata>;

  /**
   * 获取配额信息
   * @returns 配额信息
   */
  getQuota(): Promise<QuotaInfo>;
} 
