import { RequestUrlParam } from 'obsidian';
import { FileInfo, FileMetadata, QuotaInfo, StorageProviderError } from '@providers/common/storage-provider';
import { WebDAVClient } from './webdav-client';
import { parseFileInfoFromResponse, parseQuotaFromResponse } from './webdav-parsers';

/**
 * WebDAV操作类
 * 负责处理WebDAV的文件和文件夹操作
 * @author Bing
 */
export class WebDAVOperations {
  protected client: WebDAVClient;
  protected serverUrl: string;
  protected rootDir: string;
  
  /**
   * 构造函数
   * @param client WebDAV客户端
   * @param serverUrl 服务器URL
   * @param rootDir 根目录
   */
  constructor(client: WebDAVClient, serverUrl: string, rootDir: string) {
    this.client = client;
    
    // 确保URL格式正确
    this.serverUrl = client.formatUrl(serverUrl);
    
    // 处理根目录路径
    this.rootDir = rootDir.trim();
    // 确保根目录以/开头
    if (!this.rootDir.startsWith('/')) {
      this.rootDir = '/' + this.rootDir;
    }
    // 确保根目录以/结尾
    if (!this.rootDir.endsWith('/')) {
      this.rootDir += '/';
    }
    
    // 移除根目录中的多余斜杠
    this.rootDir = this.rootDir.replace(/\/+/g, '/');
  }
  
  /**
   * 获取文件的完整URL
   * @param path 文件路径
   * @returns 完整URL
   */
  getFullUrl(path: string): string {
    path = path.trim();
    
    // 确保路径以/开头
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    
    // 构建完整路径
    let fullPath = this.rootDir + path.slice(1);
    // 移除多余斜杠
    fullPath = fullPath.replace(/\/+/g, '/');
    
    // 返回完整URL
    return this.serverUrl + fullPath.slice(1);
  }
  
  /**
   * 列出目录内容
   * @param path 目录路径
   * @returns 文件信息数组
   */
  async listFiles(path: string): Promise<FileInfo[]> {
    try {
      const url = this.getFullUrl(path);
      
      // 准备PROPFIND请求
      const params: RequestUrlParam = {
        url: url,
        method: 'PROPFIND',
        headers: {
          'Depth': '1', // 只获取当前目录下的内容，不递归
        },
        body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getlastmodified/>
    <D:getcontentlength/>
    <D:resourcetype/>
    <D:getcontenttype/>
    <D:getetag/>
  </D:prop>
</D:propfind>`
      };
      
      // 执行请求
      const response = await this.client.request(params);
      
      // 解析响应
      return parseFileInfoFromResponse(response.text, url, path);
    } catch (error) {
      console.error('列出目录内容失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 获取文件或目录信息
   * @param path 文件或目录路径
   * @returns 文件信息对象
   */
  async getFileInfo(path: string): Promise<FileInfo> {
    try {
      const url = this.getFullUrl(path);
      
      // 准备PROPFIND请求
      const params: RequestUrlParam = {
        url: url,
        method: 'PROPFIND',
        headers: {
          'Depth': '0', // 只获取当前文件/目录信息
        },
        body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getlastmodified/>
    <D:getcontentlength/>
    <D:resourcetype/>
    <D:getcontenttype/>
    <D:getetag/>
  </D:prop>
</D:propfind>`
      };
      
      // 执行请求
      const response = await this.client.request(params);
      
      // 解析响应
      const fileInfos = parseFileInfoFromResponse(response.text, url, path);
      
      // 应该只返回一个文件信息
      if (fileInfos.length === 0) {
        throw new StorageProviderError('找不到文件或目录', 'NOT_FOUND');
      }
      
      return fileInfos[0];
    } catch (error) {
      console.error('获取文件信息失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 下载文件
   * @param path 文件路径
   * @returns 文件内容和元数据
   */
  async downloadFile(path: string): Promise<{ content: ArrayBuffer; metadata: FileMetadata }> {
    try {
      const url = this.getFullUrl(path);
      
      // 准备GET请求
      const params: RequestUrlParam = {
        url: url,
        method: 'GET',
      };
      
      // 执行请求
      const response = await this.client.request(params);
      
      // 获取文件信息，以便返回准确的元数据
      const fileInfo = await this.getFileInfo(path);
      
      return {
        content: response.arrayBuffer,
        metadata: {
          path: path,
          name: fileInfo.name,
          isFolder: fileInfo.isFolder,
          size: fileInfo.size,
          modifiedTime: fileInfo.modifiedTime,
          etag: fileInfo.etag
        }
      };
    } catch (error) {
      console.error('下载文件失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 上传文件
   * @param path 文件路径
   * @param content 文件内容
   * @param options 上传选项
   * @returns 文件元数据
   */
  async uploadFile(path: string, content: ArrayBuffer, options?: { overwrite?: boolean }): Promise<FileMetadata> {
    try {
      const url = this.getFullUrl(path);
      const overwrite = options?.overwrite !== false; // 默认为true
      
      // 如果不允许覆盖，先检查文件是否存在
      if (!overwrite) {
        try {
          await this.getFileInfo(path);
          // 如果文件存在且不允许覆盖，则抛出错误
          throw new StorageProviderError('文件已存在，无法覆盖', 'FILE_EXISTS');
        } catch (error) {
          // 如果是NOT_FOUND错误，说明文件不存在，可以继续上传
          if (!(error instanceof StorageProviderError) || error.code !== 'NOT_FOUND') {
            throw error;
          }
        }
      }
      
      // 确保父目录存在
      await this.ensureDirectoryExists(this.getParentPath(path));
      
      // 准备PUT请求
      const params: RequestUrlParam = {
        url: url,
        method: 'PUT',
        body: content
      };
      
      // 执行请求
      await this.client.request(params);
      
      // 获取更新后的文件信息
      const fileInfo = await this.getFileInfo(path);
      
      return {
        path: path,
        name: fileInfo.name,
        isFolder: fileInfo.isFolder,
        size: fileInfo.size,
        modifiedTime: fileInfo.modifiedTime,
        etag: fileInfo.etag
      };
    } catch (error) {
      console.error('上传文件失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 获取父目录路径
   * @param path 文件路径
   * @returns 父目录路径
   */
  getParentPath(path: string): string {
    path = path.trim();
    
    // 确保路径以/开头
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    
    // 如果路径是根目录，返回根目录
    if (path === '/' || path === '') {
      return '/';
    }
    
    // 移除末尾的斜杠
    if (path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    
    // 找到最后一个斜杠的位置
    const lastSlashIndex = path.lastIndexOf('/');
    
    // 如果没有找到斜杠，返回根目录
    if (lastSlashIndex === -1) {
      return '/';
    }
    
    // 返回父目录路径
    return path.slice(0, lastSlashIndex + 1);
  }
  
  /**
   * 确保目录存在
   * @param path 目录路径
   */
  async ensureDirectoryExists(path: string): Promise<void> {
    try {
      // 如果是根目录，直接返回
      if (path === '/' || path === '') {
        return;
      }
      
      // 尝试获取目录信息
      try {
        const fileInfo = await this.getFileInfo(path);
        
        // 如果获取成功，检查是否为目录
        if (!fileInfo.isFolder) {
          throw new StorageProviderError('路径存在但不是目录', 'NOT_A_DIRECTORY');
        }
        
        // 目录已存在，无需创建
        return;
      } catch (error) {
        // 如果是NOT_FOUND错误，说明目录不存在，需要创建
        if (!(error instanceof StorageProviderError) || error.code !== 'NOT_FOUND') {
          throw error;
        }
      }
      
      // 确保父目录存在
      const parentPath = this.getParentPath(path);
      await this.ensureDirectoryExists(parentPath);
      
      // 创建当前目录
      await this.createDirectory(path);
    } catch (error) {
      console.error('确保目录存在失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 创建目录
   * @param path 目录路径
   */
  async createDirectory(path: string): Promise<void> {
    try {
      const url = this.getFullUrl(path);
      
      // 准备MKCOL请求
      const params: RequestUrlParam = {
        url: url,
        method: 'MKCOL'
      };
      
      // 执行请求
      await this.client.request(params);
    } catch (error) {
      console.error('创建目录失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 删除文件
   * @param path 文件路径
   */
  async deleteFile(path: string): Promise<void> {
    try {
      const url = this.getFullUrl(path);
      
      // 准备DELETE请求
      const params: RequestUrlParam = {
        url: url,
        method: 'DELETE'
      };
      
      // 执行请求
      await this.client.request(params);
    } catch (error) {
      console.error('删除文件失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 删除目录
   * @param path 目录路径
   * @param recursive 是否递归删除
   */
  async deleteDirectory(path: string, recursive: boolean = true): Promise<void> {
    try {
      // 如果需要递归删除，先列出目录内容
      if (recursive) {
        try {
          const files = await this.listFiles(path);
          
          // 逐个删除目录内容
          for (const file of files) {
            // 跳过当前目录
            if (file.path === path) {
              continue;
            }
            
            if (file.isFolder) {
              await this.deleteDirectory(file.path, true);
            } else {
              await this.deleteFile(file.path);
            }
          }
        } catch (error) {
          // 如果是NOT_FOUND错误，说明目录不存在，直接返回
          if (error instanceof StorageProviderError && error.code === 'NOT_FOUND') {
            return;
          }
          throw error;
        }
      }
      
      // 删除目录本身
      const url = this.getFullUrl(path);
      
      // 准备DELETE请求
      const params: RequestUrlParam = {
        url: url,
        method: 'DELETE'
      };
      
      // 执行请求
      await this.client.request(params);
    } catch (error) {
      console.error('删除目录失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 重命名/移动文件或目录
   * @param sourcePath 源路径
   * @param targetPath 目标路径
   * @param options 选项
   */
  async moveFile(sourcePath: string, targetPath: string, options?: { overwrite?: boolean }): Promise<void> {
    try {
      const sourceUrl = this.getFullUrl(sourcePath);
      const targetUrl = this.getFullUrl(targetPath);
      const overwrite = options?.overwrite !== false; // 默认为true
      
      // 如果源路径与目标路径相同，无需移动
      if (sourcePath === targetPath) {
        return;
      }
      
      // 确保目标路径的父目录存在
      await this.ensureDirectoryExists(this.getParentPath(targetPath));
      
      // 准备MOVE请求
      const params: RequestUrlParam = {
        url: sourceUrl,
        method: 'MOVE',
        headers: {
          'Destination': targetUrl,
          'Overwrite': overwrite ? 'T' : 'F'
        }
      };
      
      // 执行请求
      await this.client.request(params);
    } catch (error) {
      console.error('移动文件/目录失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 复制文件或目录
   * @param sourcePath 源路径
   * @param targetPath 目标路径
   * @param options 选项
   */
  async copyFile(sourcePath: string, targetPath: string, options?: { overwrite?: boolean }): Promise<void> {
    try {
      const sourceUrl = this.getFullUrl(sourcePath);
      const targetUrl = this.getFullUrl(targetPath);
      const overwrite = options?.overwrite !== false; // 默认为true
      
      // 如果源路径与目标路径相同，无需复制
      if (sourcePath === targetPath) {
        return;
      }
      
      // 确保目标路径的父目录存在
      await this.ensureDirectoryExists(this.getParentPath(targetPath));
      
      // 准备COPY请求
      const params: RequestUrlParam = {
        url: sourceUrl,
        method: 'COPY',
        headers: {
          'Destination': targetUrl,
          'Overwrite': overwrite ? 'T' : 'F',
          'Depth': 'infinity' // 递归复制所有文件和子目录
        }
      };
      
      // 执行请求
      await this.client.request(params);
    } catch (error) {
      console.error('复制文件/目录失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 获取存储配额信息
   * @returns 配额信息
   */
  async getQuota(): Promise<QuotaInfo> {
    try {
      const url = this.serverUrl;
      
      // 准备PROPFIND请求
      const params: RequestUrlParam = {
        url: url,
        method: 'PROPFIND',
        headers: {
          'Depth': '0'
        },
        body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:quota-available-bytes/>
    <D:quota-used-bytes/>
  </D:prop>
</D:propfind>`
      };
      
      // 执行请求
      const response = await this.client.request(params);
      
      // 解析配额信息
      return parseQuotaFromResponse(response.text);
    } catch (error) {
      console.error('获取配额信息失败:', error);
      // 如果获取配额信息失败，返回默认值
      return {
        available: -1,
        used: -1,
        total: -1
      };
    }
  }
} 