import { RequestUrlParam } from 'obsidian';
import { FileInfo, FileMetadata, QuotaInfo, StorageProviderError } from '@providers/common/storage-provider';
import { WebDAVClient } from './webdav-client';
import { parseFileInfoFromResponse, parseQuotaFromResponse } from './webdav-parsers';
import { ModuleLogger } from '@services/log/log-service';
import CloudSyncPlugin from '@main';

/**
 * WebDAV操作类
 * 负责处理WebDAV的文件和文件夹操作
 * @author Bing
 */
export class WebDAVOperations {
  protected client: WebDAVClient;
  protected serverUrl: string;
  protected rootDir: string;
  protected logger: ModuleLogger | null = null;
  
  /**
   * 构造函数
   * @param client WebDAV客户端
   * @param serverUrl 服务器URL
   * @param rootDir 根目录
   * @param plugin 可选，插件实例，用于获取日志服务
   */
  constructor(client: WebDAVClient, serverUrl: string, rootDir: string, plugin?: CloudSyncPlugin) {
    this.client = client;
    
    if (plugin && plugin.logService) {
      this.logger = plugin.logService.getModuleLogger('WebDAVOperations');
      this.logger.info('WebDAV操作类初始化');
    }
    
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
    
    this.logger?.info(`WebDAV操作类初始化完成, 服务器URL: ${this.serverUrl}, 根目录: ${this.rootDir}`);
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
      this.logger?.info(`列出WebDAV目录内容: ${path}`);
      const url = this.getFullUrl(path);
      this.logger?.debug(`完整URL: ${url}`);
      
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
      const fileInfos = parseFileInfoFromResponse(response.text, url, path);
      this.logger?.info(`列出目录内容成功, 文件数量: ${fileInfos.length}`);
      return fileInfos;
    } catch (error) {
      this.logger?.error('列出目录内容失败:', error);
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
      this.logger?.info(`获取WebDAV文件信息: ${path}`);
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
        this.logger?.warning(`未找到文件或目录: ${path}`);
        throw new StorageProviderError('找不到文件或目录', 'NOT_FOUND');
      }
      
      this.logger?.info(`获取文件信息成功: ${path}`);
      return fileInfos[0];
    } catch (error) {
      this.logger?.error('获取文件信息失败:', error);
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
      this.logger?.info(`下载WebDAV文件: ${path}`);
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
      
      this.logger?.info(`文件下载成功: ${path}, 大小: ${response.arrayBuffer.byteLength} 字节`);
      
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
      this.logger?.error('下载文件失败:', error);
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
      this.logger?.info(`上传文件到WebDAV: ${path}, 大小: ${content.byteLength} 字节, 覆盖: ${options?.overwrite !== false}`);
      const url = this.getFullUrl(path);
      const overwrite = options?.overwrite !== false; // 默认为true
      
      // 如果不允许覆盖，先检查文件是否存在
      if (!overwrite) {
        try {
          await this.getFileInfo(path);
          // 如果文件存在且不允许覆盖，则抛出错误
          this.logger?.warning(`文件已存在且不允许覆盖: ${path}`);
          throw new StorageProviderError('文件已存在，无法覆盖', 'FILE_EXISTS');
        } catch (error) {
          // 如果是NOT_FOUND错误，说明文件不存在，可以继续上传
          if (!(error instanceof StorageProviderError) || error.code !== 'NOT_FOUND') {
            throw error;
          }
          this.logger?.debug(`文件不存在，可以上传: ${path}`);
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
      
      this.logger?.info(`文件上传成功: ${path}`);
      
      return {
        path: path,
        name: fileInfo.name,
        isFolder: fileInfo.isFolder,
        size: fileInfo.size,
        modifiedTime: fileInfo.modifiedTime,
        etag: fileInfo.etag
      };
    } catch (error) {
      this.logger?.error('上传文件失败:', error);
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
    
    // 如果路径为根目录，返回根目录
    if (path === '/' || path === '') {
      return '/';
    }
    
    // 确保路径以/开头
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    
    // 找到最后一个斜杠的位置
    const lastSlashIndex = path.lastIndexOf('/');
    
    // 如果没有找到斜杠，或者只找到开头的斜杠，返回根目录
    if (lastSlashIndex <= 0) {
      return '/';
    }
    
    // 返回父目录路径
    return path.substring(0, lastSlashIndex);
  }
  
  /**
   * 确保目录存在
   * @param path 目录路径
   */
  async ensureDirectoryExists(path: string): Promise<void> {
    try {
      this.logger?.info(`确保WebDAV目录存在: ${path}`);
      
      // 如果路径为根目录，无需创建
      if (path === '/' || path === '') {
        this.logger?.debug('路径为根目录，无需创建');
        return;
      }
      
      // 检查目录是否存在
      try {
        const fileInfo = await this.getFileInfo(path);
        
        // 如果存在但不是目录，则抛出错误
        if (!fileInfo.isFolder) {
          this.logger?.warning(`路径存在但不是目录: ${path}`);
          throw new StorageProviderError('路径存在但不是目录', 'NOT_DIRECTORY');
        }
        
        // 如果是目录，则已经存在，无需创建
        this.logger?.debug(`目录已存在: ${path}`);
        return;
      } catch (error) {
        // 如果是NOT_FOUND错误，说明目录不存在，需要创建
        if (error instanceof StorageProviderError && error.code === 'NOT_FOUND') {
          this.logger?.debug(`目录不存在，需要创建: ${path}`);
          
          // 确保父目录存在
          const parentPath = this.getParentPath(path);
          
          // 如果父目录不是根目录，则递归确保父目录存在
          if (parentPath !== '/' && parentPath !== '') {
            await this.ensureDirectoryExists(parentPath);
          }
          
          // 创建当前目录
          await this.createDirectory(path);
        } else {
          // 如果是其他错误，则抛出
          throw error;
        }
      }
    } catch (error) {
      this.logger?.error('确保目录存在失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 创建目录
   * @param path 目录路径
   */
  async createDirectory(path: string): Promise<void> {
    try {
      this.logger?.info(`创建WebDAV目录: ${path}`);
      const url = this.getFullUrl(path);
      
      // 准备MKCOL请求
      const params: RequestUrlParam = {
        url: url,
        method: 'MKCOL'
      };
      
      // 执行请求
      await this.client.request(params);
      
      this.logger?.info(`目录创建成功: ${path}`);
    } catch (error) {
      this.logger?.error('创建目录失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 删除文件
   * @param path 文件路径
   */
  async deleteFile(path: string): Promise<void> {
    try {
      this.logger?.info(`删除WebDAV文件: ${path}`);
      const url = this.getFullUrl(path);
      
      // 准备DELETE请求
      const params: RequestUrlParam = {
        url: url,
        method: 'DELETE'
      };
      
      // 执行请求
      await this.client.request(params);
      
      this.logger?.info(`文件删除成功: ${path}`);
    } catch (error) {
      this.logger?.error('删除文件失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 删除目录
   * @param path 目录路径
   * @param recursive 是否递归删除子目录和文件
   */
  async deleteDirectory(path: string, recursive: boolean = true): Promise<void> {
    try {
      this.logger?.info(`删除WebDAV目录: ${path}, 递归: ${recursive}`);
      
      // 如果路径为根目录，不允许删除
      if (path === '/' || path === '') {
        this.logger?.warning('不允许删除根目录');
        throw new StorageProviderError('不允许删除根目录', 'INVALID_OPERATION');
      }
      
      // 检查是否需要递归删除
      if (recursive) {
        // 获取目录内容
        const files = await this.listFiles(path);
        
        // 递归删除子目录和文件
        for (const file of files) {
          if (file.isFolder) {
            await this.deleteDirectory(file.path, true);
          } else {
            await this.deleteFile(file.path);
          }
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
      
      this.logger?.info(`目录删除成功: ${path}`);
    } catch (error) {
      this.logger?.error('删除目录失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 移动文件
   * @param sourcePath 源文件路径
   * @param targetPath 目标文件路径
   * @param options 移动选项
   */
  async moveFile(sourcePath: string, targetPath: string, options?: { overwrite?: boolean }): Promise<void> {
    try {
      const overwrite = options?.overwrite !== false; // 默认为true
      this.logger?.info(`移动WebDAV文件: ${sourcePath} -> ${targetPath}, 覆盖: ${overwrite}`);
      
      // 获取完整URL
      const sourceUrl = this.getFullUrl(sourcePath);
      const targetUrl = this.getFullUrl(targetPath);
      
      // 确保目标文件的父目录存在
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
      
      this.logger?.info(`文件移动成功: ${sourcePath} -> ${targetPath}`);
    } catch (error) {
      this.logger?.error('移动文件失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 复制文件
   * @param sourcePath 源文件路径
   * @param targetPath 目标文件路径
   * @param options 复制选项
   */
  async copyFile(sourcePath: string, targetPath: string, options?: { overwrite?: boolean }): Promise<void> {
    try {
      const overwrite = options?.overwrite !== false; // 默认为true
      this.logger?.info(`复制WebDAV文件: ${sourcePath} -> ${targetPath}, 覆盖: ${overwrite}`);
      
      // 获取完整URL
      const sourceUrl = this.getFullUrl(sourcePath);
      const targetUrl = this.getFullUrl(targetPath);
      
      // 确保目标文件的父目录存在
      await this.ensureDirectoryExists(this.getParentPath(targetPath));
      
      // 准备COPY请求
      const params: RequestUrlParam = {
        url: sourceUrl,
        method: 'COPY',
        headers: {
          'Destination': targetUrl,
          'Overwrite': overwrite ? 'T' : 'F'
        }
      };
      
      // 执行请求
      await this.client.request(params);
      
      this.logger?.info(`文件复制成功: ${sourcePath} -> ${targetPath}`);
    } catch (error) {
      this.logger?.error('复制文件失败:', error);
      throw this.client.handleError(error);
    }
  }
  
  /**
   * 获取配额信息
   * @returns 配额信息
   */
  async getQuota(): Promise<QuotaInfo> {
    try {
      this.logger?.info('获取WebDAV配额信息');
      const url = this.getFullUrl('/');
      
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
      
      // 解析响应
      const quota = parseQuotaFromResponse(response.text);
      
      this.logger?.info(`获取配额信息成功, 已用: ${quota.used}, 可用: ${quota.available}`);
      
      return {
        used: quota.used,
        available: quota.available,
        total: quota.used >= 0 && quota.available >= 0 ? quota.used + quota.available : -1
      };
    } catch (error) {
      this.logger?.error('获取配额信息失败:', error);
      
      // 获取配额信息失败不应该阻止后续操作，返回默认值
      return {
        used: -1,
        available: -1,
        total: -1
      };
    }
  }
} 