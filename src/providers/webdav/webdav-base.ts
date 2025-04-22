import { 
  ConnectionStatus, 
  StorageProvider, 
  StorageProviderError,
  FileInfo,
  FileMetadata,
  QuotaInfo
} from '@providers/common/storage-provider';
import { App } from 'obsidian';
import { WebDAVSettings } from '@models/plugin-settings';

/**
 * WebDAV提供者基类
 * @author Bing
 */
export abstract class WebDAVBase implements StorageProvider {
  /**
   * 配置
   */
  protected config: WebDAVSettings;
  
  /**
   * Obsidian应用实例
   */
  protected app: App;
  
  /**
   * 连接状态
   */
  protected status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  
  /**
   * 创建WebDAV提供者实例
   * @param config WebDAV配置
   * @param app Obsidian应用实例
   * @author Bing
   */
  constructor(config: WebDAVSettings, app: App) {
    this.config = config;
    this.app = app;
  }
  
  /**
   * 获取提供商名称
   * @returns 名称
   * @author Bing
   */
  getName(): string {
    return 'WebDAV';
  }
  
  /**
   * 获取提供商类型
   * @returns 类型
   * @author Bing
   */
  getType(): string {
    return 'webdav';
  }
  
  /**
   * 获取连接状态
   * @returns 连接状态
   * @author Bing
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }
  
  /**
   * 连接到WebDAV服务器
   * @returns 连接是否成功
   * @author Bing
   */
  abstract connect(): Promise<boolean>;
  
  /**
   * 断开与WebDAV服务器的连接
   * @author Bing
   */
  abstract disconnect(): Promise<void>;
  
  /**
   * 测试连接
   * @returns 连接是否成功
   * @author Bing
   */
  abstract testConnection(): Promise<boolean>;
  
  /**
   * 列出指定路径下的文件
   * @param path 路径
   * @returns 文件列表
   * @author Bing
   */
  abstract listFiles(path?: string): Promise<any[]>;
  
  /**
   * 下载文件
   * @param remotePath 远程路径
   * @param localPath 本地路径
   * @author Bing
   */
  abstract downloadFile(remotePath: string, localPath: string): Promise<void>;
  
  /**
   * 下载文件内容
   * @param remotePath 远程路径
   * @returns 文件内容（字符串或二进制数据）
   * @author Bing
   */
  abstract downloadFileContent(remotePath: string): Promise<string | ArrayBuffer>;
  
  /**
   * 上传文件
   * @param source 本地文件路径或文件内容
   * @param remotePath 远程路径
   * @author Bing
   */
  abstract uploadFile(source: string | ArrayBuffer, remotePath: string): Promise<void>;
  
  /**
   * 删除文件
   * @param remotePath 远程路径
   * @author Bing
   */
  abstract deleteFile(remotePath: string): Promise<void>;
  
  /**
   * 移动文件
   * @param oldPath 原路径
   * @param newPath 新路径
   * @author Bing
   */
  abstract moveFile(oldPath: string, newPath: string): Promise<void>;
  
  /**
   * 创建文件夹
   * @param path 路径
   * @author Bing
   */
  abstract createFolder(path: string): Promise<void>;
  
  /**
   * 删除文件夹
   * @param path 路径
   * @author Bing
   */
  abstract deleteFolder(path: string): Promise<void>;
  
  /**
   * 检查文件夹是否存在
   * @param path 路径
   * @returns 文件夹是否存在
   * @author Bing
   */
  abstract folderExists(path: string): Promise<boolean>;
  
  /**
   * 获取文件元数据
   * @param path 路径
   * @returns 文件元数据
   * @author Bing
   */
  abstract getFileMetadata(path: string): Promise<any>;
  
  /**
   * 获取配额信息
   * @returns 配额信息
   * @author Bing
   */
  abstract getQuota(): Promise<any>;
} 