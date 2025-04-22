import { App } from 'obsidian';
import { StorageProvider, FileInfo, FileMetadata, QuotaInfo } from '@providers/common/storage-provider';
import { WebDAVSettings } from '@models/plugin-settings';
import { WebDAVFactory } from './webdav-factory';

/**
 * WebDAV提供商类
 * 向下兼容的包装器，保持与原WebDAVProvider接口兼容
 * @author Bing
 */
export class WebDAVProvider implements StorageProvider {
  private provider: StorageProvider;
  
  /**
   * 创建WebDAV提供商实例
   * @param config WebDAV配置
   * @param app Obsidian应用实例
   * @author Bing
   */
  constructor(config: WebDAVSettings, app: App) {
    this.provider = WebDAVFactory.createProvider(config, app);
  }
  
  /**
   * 获取提供商名称
   * @returns 名称
   * @author Bing
   */
  getName(): string {
    return this.provider.getName();
  }
  
  /**
   * 获取提供商类型
   * @returns 类型
   * @author Bing
   */
  getType(): string {
    return this.provider.getType();
  }
  
  /**
   * 获取连接状态
   * @returns 连接状态
   * @author Bing
   */
  getStatus() {
    return this.provider.getStatus();
  }
  
  /**
   * 连接到WebDAV服务器
   * @returns 连接是否成功
   * @author Bing
   */
  async connect(): Promise<boolean> {
    return this.provider.connect();
  }
  
  /**
   * 断开与WebDAV服务器的连接
   * @author Bing
   */
  async disconnect(): Promise<void> {
    return this.provider.disconnect();
  }
  
  /**
   * 测试连接
   * @returns 连接是否成功
   * @author Bing
   */
  async testConnection(): Promise<boolean> {
    return this.provider.testConnection();
  }
  
  /**
   * 列出指定路径下的文件
   * @param path 路径
   * @returns 文件列表
   * @author Bing
   */
  async listFiles(path: string): Promise<FileInfo[]> {
    return this.provider.listFiles(path);
  }
  
  /**
   * 下载文件
   * @param remotePath 远程路径
   * @param localPath 本地路径
   * @author Bing
   */
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    return this.provider.downloadFile(remotePath, localPath);
  }
  
  /**
   * 下载文件内容
   * @param remotePath 远程路径
   * @returns 文件内容（字符串或二进制数据）
   * @author Bing
   */
  async downloadFileContent(remotePath: string): Promise<string | ArrayBuffer> {
    if (this.provider.downloadFileContent) {
      return this.provider.downloadFileContent(remotePath);
    } else {
      throw new Error('当前提供商不支持下载文件内容');
    }
  }
  
  /**
   * 上传文件
   * @param localPath 本地路径
   * @param remotePath 远程路径
   * @author Bing
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    return this.provider.uploadFile(localPath, remotePath);
  }
  
  /**
   * 删除文件
   * @param remotePath 远程路径
   * @author Bing
   */
  async deleteFile(remotePath: string): Promise<void> {
    return this.provider.deleteFile(remotePath);
  }
  
  /**
   * 移动文件
   * @param oldPath 原路径
   * @param newPath 新路径
   * @author Bing
   */
  async moveFile(oldPath: string, newPath: string): Promise<void> {
    return this.provider.moveFile(oldPath, newPath);
  }
  
  /**
   * 创建文件夹
   * @param path 路径
   * @author Bing
   */
  async createFolder(path: string): Promise<void> {
    return this.provider.createFolder(path);
  }
  
  /**
   * 删除文件夹
   * @param path 路径
   * @author Bing
   */
  async deleteFolder(path: string): Promise<void> {
    return this.provider.deleteFolder(path);
  }
  
  /**
   * 检查文件夹是否存在
   * @param path 路径
   * @returns 文件夹是否存在
   * @author Bing
   */
  async folderExists(path: string): Promise<boolean> {
    return this.provider.folderExists(path);
  }
  
  /**
   * 获取文件元数据
   * @param path 路径
   * @returns 文件元数据
   * @author Bing
   */
  async getFileMetadata(path: string): Promise<FileMetadata> {
    return this.provider.getFileMetadata(path);
  }
  
  /**
   * 获取配额信息
   * @returns 配额信息
   * @author Bing
   */
  async getQuota(): Promise<QuotaInfo> {
    return this.provider.getQuota();
  }
} 