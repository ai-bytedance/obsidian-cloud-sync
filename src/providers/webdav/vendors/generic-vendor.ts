import { ConnectionStatus, FileInfo, FileMetadata, QuotaInfo, StorageProviderError } from '@providers/common/storage-provider';
import { App, RequestUrlParam, requestUrl } from 'obsidian';
import { WebDAVSettings } from '@models/plugin-settings';
import { WebDAVBase } from '@providers/webdav/webdav-base';
import { 
  formatPath, 
  isBinaryContentType, 
  isBinaryFileType, 
  isTextContentType, 
  parseFileInfoFromResponse, 
  parseQuotaFromResponse 
} from '@providers/webdav/webdav-parsers';

/**
 * 通用WebDAV提供商实现
 * @author Bing
 */
export class GenericWebDAVVendor extends WebDAVBase {
  /**
   * 创建WebDAV提供商实例
   * @param config WebDAV配置
   * @param app Obsidian应用实例
   * @author Bing
   */
  constructor(config: WebDAVSettings, app: App) {
    super(config, app);
  }

  /**
   * 连接到WebDAV服务器
   * @returns 连接是否成功
   * @author Bing
   */
  async connect(): Promise<boolean> {
    try {
      console.log('开始连接到WebDAV服务器...');
      this.status = ConnectionStatus.CONNECTING;
      
      // 检查配置合法性
      if (!this.config || !this.config.username || !this.config.password) {
        console.error('WebDAV配置不完整，缺少用户名或密码');
        this.status = ConnectionStatus.ERROR;
        throw new StorageProviderError('WebDAV配置不完整，请检查用户名和密码', 'CONFIG_ERROR');
      }
      
      if (!this.config.serverUrl || this.config.serverUrl.trim() === '') {
        console.error('WebDAV配置不完整，缺少服务器URL');
        this.status = ConnectionStatus.ERROR;
        throw new StorageProviderError('WebDAV配置不完整，请检查服务器URL', 'CONFIG_ERROR');
      }
      
      // 检查URL是否包含有效域名
      const urlToCheck = this.config.serverUrl.trim();
      if (!urlToCheck.includes('.') && !urlToCheck.includes('localhost')) {
        console.error(`URL缺少有效域名: ${urlToCheck}`);
        this.status = ConnectionStatus.ERROR;
        throw new StorageProviderError('WebDAV服务器URL缺少有效域名，请检查URL格式', 'CONFIG_ERROR');
      }
      
      // 使用 Obsidian 的 requestUrl API 测试连接
      let success = false;
      let connectAttempts = 0;
      const maxConnectAttempts = 8; // 增加最大重试次数
      let retryDelay = 3000; // 初始重试延迟3秒
      
      // 是否坚果云，需要特殊处理
      const isJianguoyun = this.isJianGuoYun();
      
      while (!success && connectAttempts < maxConnectAttempts) {
        try {
          connectAttempts++;
          console.log(`尝试连接到WebDAV服务器 (尝试 ${connectAttempts}/${maxConnectAttempts})...`);
          
          // 格式化URL并构建请求参数
          const url = this.formatUrl(this.config.serverUrl);
          
          // 准备请求参数
          const requestParams: RequestUrlParam = {
            url: url,
            method: "PROPFIND",
            headers: this.getHeaders(),
            body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`,
            throw: true // 允许抛出错误
          };
          
          // 执行请求
          const response = await requestUrl(requestParams);
          
          if (response.status >= 200 && response.status < 300) {
            console.log('WebDAV连接成功');
            success = true;
            this.status = ConnectionStatus.CONNECTED;
          } else {
            console.warn(`WebDAV连接返回非成功状态码: ${response.status}`);
            this.status = ConnectionStatus.ERROR;
            throw new StorageProviderError(`连接失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
          }
        } catch (error) {
          console.warn(`WebDAV连接尝试 ${connectAttempts} 失败:`, error);
          
          // 增加重试延迟时间
          retryDelay = Math.min(retryDelay * 1.5, 30000); // 最大延迟30秒
          
          if (connectAttempts < maxConnectAttempts) {
            console.log(`将在 ${retryDelay/1000} 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            console.error('WebDAV连接失败，已达到最大重试次数');
            this.status = ConnectionStatus.ERROR;
            throw this.handleError(error);
          }
        }
      }
      
      return success;
    } catch (error) {
      this.status = ConnectionStatus.ERROR;
      throw this.handleError(error);
    }
  }

  /**
   * 断开与WebDAV服务器的连接
   * @author Bing
   */
  async disconnect(): Promise<void> {
    this.status = ConnectionStatus.DISCONNECTED;
    console.log('已断开与WebDAV服务器的连接');
  }

  /**
   * 测试连接
   * @returns 连接是否成功
   * @author Bing
   */
  async testConnection(): Promise<boolean> {
    console.log('测试WebDAV连接...');
    
    try {
      // 原始状态
      const originalStatus = this.status;
      
      // 如果已连接，保持状态不变
      if (originalStatus === ConnectionStatus.CONNECTED) {
        console.log('WebDAV已经连接，跳过测试');
        return true;
      }
      
      // 尝试连接
      const success = await this.connect();
      
      // 如果连接成功，断开连接并恢复原始状态
      if (success) {
        await this.disconnect();
        this.status = originalStatus;
      }
      
      return success;
    } catch (error) {
      console.error('测试WebDAV连接失败:', error);
      return false;
    }
  }

  /**
   * 获取针对不同WebDAV服务的可能Headers
   * @returns 请求头对象
   * @author Bing
   */
  protected getHeaders(): Record<string, string> {
    // 针对坚果云的特殊处理
    if (this.isJianGuoYun()) {
      console.log('检测到坚果云WebDAV服务，使用特殊配置');
      return {
        'Authorization': this.getAuthHeader(),
        'Accept': '*/*',
        'Cache-Control': 'no-cache'
      };
    }
    
    // 其他WebDAV服务的通用头
    return {
      'Authorization': this.getAuthHeader(),
      'Content-Type': 'application/xml',
      'Accept': '*/*'
    };
  }

  /**
   * 编码认证信息
   * @returns 认证头部
   * @author Bing
   */
  protected getAuthHeader(): string {
    try {
      // 清理用户名和密码（去除前后空格）
      const username = this.config.username.trim();
      const password = this.config.password.trim();

      // 使用支持UTF-8的方式编码认证字符串
      const auth = `${username}:${password}`;
      return `Basic ${this.encodeAuthString(auth)}`;
    } catch (error) {
      console.error('生成认证头失败:', error);
      throw new Error('用户名或密码包含无法编码的字符');
    }
  }

  /**
   * 使用支持UTF-8编码的方式编码认证字符串
   * @param str 需要编码的字符串
   * @returns 编码后的Base64字符串
   * @author Bing
   */
  protected encodeAuthString(str: string): string {
    try {
      // 方法1: 使用TextEncoder（如果环境支持）
      if (typeof TextEncoder !== 'undefined') {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
      }
      
      // 方法2: 使用encodeURIComponent
      return btoa(
        encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, 
          (match, p1) => String.fromCharCode(parseInt(p1, 16))
        )
      );
    } catch (error) {
      // 如果上述方法都失败，尝试直接使用btoa（可能对非ASCII字符失败）
      console.warn('高级编码方法失败，尝试标准编码', error);
      try {
        return btoa(str);
      } catch (e) {
        console.error('所有认证编码方法均失败:', e);
        throw new Error('用户名或密码包含无法编码的特殊字符');
      }
    }
  }

  /**
   * 检查当前WebDAV服务是否为坚果云
   * @returns {boolean} 如果当前服务是坚果云则返回true
   * @author Bing
   */
  protected isJianGuoYun(): boolean {
    if (!this.config || !this.config.serverUrl || this.config.serverUrl.trim() === '') {
      return false;
    }
    
    const serverUrl = this.config.serverUrl.toLowerCase().trim();
    
    // 确保URL有效，防止错误匹配
    if (!serverUrl.includes('.') && !serverUrl.includes('localhost')) {
      console.warn(`isJianGuoYun: URL缺少有效域名: ${serverUrl}, 不会识别为坚果云`);
      return false;
    }
    
    return serverUrl.includes('dav.jianguoyun.com') || 
           serverUrl.includes('jianguoyun') || 
           serverUrl.includes('jgy');
  }

  /**
   * 格式化URL
   * @param url URL字符串
   * @returns 格式化后的URL
   */
  protected formatUrl(url: string): string {
    url = url.trim();
    
    // 确保URL以"/"结尾
    if (!url.endsWith('/')) {
      url += '/';
    }
    
    // 处理URL，确保协议正确
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      // 默认使用HTTPS协议
      url = 'https://' + url;
    }
    
    return url;
  }

  /**
   * 处理错误
   * @param error 原始错误
   * @returns StorageProviderError
   */
  protected handleError(error: any): StorageProviderError {
    // 如果已经是StorageProviderError，直接返回
    if (error instanceof StorageProviderError) {
      return error;
    }
    
    // 处理Obsidian请求错误
    if (error && typeof error === 'object' && 'status' in error) {
      const status = error.status as number;
      let errorCode = 'UNKNOWN_ERROR';
      let errorMessage = '未知错误';
      
      switch (status) {
        case 401:
          errorCode = 'AUTH_FAILED';
          errorMessage = '认证失败，请检查用户名和密码';
          break;
        case 403:
          errorCode = 'FORBIDDEN';
          errorMessage = '无权访问该资源';
          break;
        case 404:
          errorCode = 'NOT_FOUND';
          errorMessage = '资源不存在';
          break;
        case 405:
          errorCode = 'METHOD_NOT_ALLOWED';
          errorMessage = '请求方法不允许';
          break;
        case 409:
          errorCode = 'CONFLICT';
          errorMessage = '资源冲突';
          break;
        case 423:
          errorCode = 'LOCKED';
          errorMessage = '资源被锁定';
          break;
        case 500:
          errorCode = 'SERVER_ERROR';
          errorMessage = '服务器内部错误';
          break;
        case 502:
          errorCode = 'BAD_GATEWAY';
          errorMessage = '网关错误';
          break;
        case 503:
          errorCode = 'SERVICE_UNAVAILABLE';
          errorMessage = '服务不可用';
          break;
        case 507:
          errorCode = 'INSUFFICIENT_STORAGE';
          errorMessage = '存储空间不足';
          break;
        default:
          if (status >= 400 && status < 500) {
            errorCode = 'CLIENT_ERROR';
            errorMessage = `客户端错误: ${status}`;
          } else if (status >= 500) {
            errorCode = 'SERVER_ERROR';
            errorMessage = `服务器错误: ${status}`;
          }
      }
      
      return new StorageProviderError(errorMessage, errorCode, error);
    }
    
    // 处理网络错误
    if (error && typeof error === 'object' && 'name' in error) {
      if (error.name === 'NetworkError') {
        return new StorageProviderError('网络连接错误，请检查网络连接', 'NETWORK_ERROR', error);
      }
      
      // 处理超时错误
      if (error.name === 'AbortError') {
        return new StorageProviderError('请求超时', 'TIMEOUT', error);
      }
    }
    
    // 对于其他类型的错误，使用fromError方法创建标准错误
    return StorageProviderError.fromError(error);
  }

  /**
   * 列出指定路径下的文件
   * @param path 路径
   * @param recursive 是否递归列出子文件夹
   * @returns 文件列表
   * @author Bing
   */
  async listFiles(path: string = '', recursive: boolean = true): Promise<FileInfo[]> {
    try {
      console.log(`列出WebDAV目录内容: ${path}, 递归: ${recursive}`);
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        console.log('WebDAV未连接，尝试连接...');
        await this.connect();
      }
      
      // 规范化路径
      path = formatPath(path);
      
      // 如果路径为空，使用配置的同步路径
      if (!path && this.config.syncPath) {
        path = formatPath(this.config.syncPath);
      }
      
      // 初始目录列表
      const result: FileInfo[] = [];
      
      // 是否递归列出文件夹
      if (recursive) {
        console.log(`使用递归方式列出文件: ${path}`);
        return await this.listFilesManualRecursive(path);
      } else {
        // 单层列出
        const url = this.formatUrl(this.config.serverUrl) + (path.startsWith('/') ? path.slice(1) : path);
        
        // 准备PROPFIND请求
        const requestParams: RequestUrlParam = {
          url: url,
          method: "PROPFIND",
          headers: {
            ...this.getHeaders(),
            'Depth': '1' // 只获取当前目录
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
</D:propfind>`,
          throw: false // 不抛出错误，以便我们可以处理它
        };
        
        try {
          // 执行请求
          const response = await requestUrl(requestParams);
          
          if (response.status >= 200 && response.status < 300) {
            // 解析响应
            const fileInfos = parseFileInfoFromResponse(response.text, url, path);
            
            // 过滤掉当前目录本身
            const filteredInfos = fileInfos.filter(file => file.path !== path);
            
            // 添加到结果
            result.push(...filteredInfos);
          } else {
            console.warn(`列出目录内容失败，状态码: ${response.status}`);
            throw new StorageProviderError(`列出目录内容失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
          }
        } catch (error) {
          // 如果是404错误，返回空列表
          if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
            console.warn(`目录不存在: ${path}`);
            return [];
          }
          
          throw error;
        }
      }
      
      return result;
    } catch (error) {
      console.error('列出WebDAV目录内容失败:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 递归列出所有文件和文件夹
   * @param path 路径
   * @returns 文件列表
   */
  private async listFilesManualRecursive(path: string = ''): Promise<FileInfo[]> {
    console.log(`递归列出目录内容: ${path}`);
    
    // 用于暂存结果的文件列表
    let allFiles: FileInfo[] = [];
    
    // 创建集合，用于跟踪已访问的路径，防止循环递归
    const visitedPaths = new Set<string>();
    
    // 创建一个可重试的列出文件方法
    const retryableListFiles = async (currentPath: string, retryCount = 0): Promise<FileInfo[]> => {
      const maxRetries = 3;
      try {
        // 使用非递归方式列出当前目录内容
        return await this.listFiles(currentPath, false);
      } catch (error) {
        // 如果出错且还有重试次数，则重试
        if (retryCount < maxRetries) {
          console.warn(`列出目录 ${currentPath} 失败，重试 (${retryCount + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // 延迟2秒
          return retryableListFiles(currentPath, retryCount + 1);
        }
        throw error;
      }
    };
    
    // 递归函数定义
    const recursiveList = async (currentPath: string, depth: number = 0): Promise<FileInfo[]> => {
      // 防止过深的递归
      if (depth > 20) {
        console.warn(`目录递归深度超过20层，停止继续递归: ${currentPath}`);
        return [];
      }
      
      // 标准化当前路径，确保路径比较的一致性
      const normalizedPath = formatPath(currentPath);
      
      // 检查是否已访问此路径（循环检测）
      if (visitedPaths.has(normalizedPath)) {
        console.warn(`检测到递归循环，路径 "${normalizedPath}" 已经被访问过，跳过进一步递归`);
        console.warn(`已访问路径历史: ${Array.from(visitedPaths).join(', ')}`);
        return [];
      }
      
      // 将当前路径添加到已访问集合
      visitedPaths.add(normalizedPath);
      
      console.log(`递归列出目录 (深度 ${depth}): ${currentPath}`);
      
      // 用于存储结果
      const results: FileInfo[] = [];
      
      try {
        // 获取当前目录内容
        const files = await retryableListFiles(currentPath);
        
        // 如果当前目录为空，直接返回
        if (!files || files.length === 0) {
          return [];
        }
        
        // 添加当前目录的文件
        results.push(...files);
        
        // 递归处理子目录
        for (const file of files) {
          if (file.isFolder) {
            // 额外检查，确保不会递归处理当前目录或父目录
            const filePath = formatPath(file.path);
            if (
              filePath === normalizedPath || 
              filePath === '.' || 
              filePath === '..' ||
              filePath + '/' === normalizedPath || 
              normalizedPath + '/' === filePath ||
              normalizedPath.startsWith(filePath + '/')
            ) {
              console.warn(`跳过可能导致循环的目录: ${file.path} (当前路径: ${normalizedPath})`);
              continue;
            }
            
            // 递归获取子目录内容
            try {
              const subFiles = await recursiveList(file.path, depth + 1);
              results.push(...subFiles);
            } catch (error) {
              // 如果子目录出错，记录但继续处理其他目录
              console.warn(`无法递归列出目录 ${file.path}: ${error}`);
            }
          }
        }
      } catch (error) {
        console.warn(`列出目录内容失败 ${currentPath}: ${error}`);
        // 不阻止整个过程，返回已有结果
      }
      
      return results;
    };
    
    // 开始递归
    allFiles = await recursiveList(path);
    
    return allFiles;
  }

  /**
   * 下载文件
   * @param remotePath 远程路径
   * @param localPath 本地路径
   * @author Bing
   */
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    try {
      console.log(`下载WebDAV文件: ${remotePath} -> ${localPath}`);
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        await this.connect();
      }
      
      // 规范化路径
      remotePath = formatPath(remotePath);
      
      // 准备URL
      const url = this.formatUrl(this.config.serverUrl) + (remotePath.startsWith('/') ? remotePath.slice(1) : remotePath);
      
      // 准备GET请求
      const requestParams: RequestUrlParam = {
        url,
        method: "GET",
        headers: this.getHeaders()
      };
      
      // 执行请求
      const response = await requestUrl(requestParams);
      
      if (response.status >= 200 && response.status < 300) {
        // 获取响应内容
        const content = response.arrayBuffer;
        
        // 将内容保存到本地文件
        // 这里需要平台特定的文件保存逻辑
        // 在Obsidian中，通常会使用Vault API
        
        // 获取所需的子目录路径
        const pathParts = localPath.split('/').filter(part => part.length > 0);
        const fileName = pathParts.pop(); // 获取文件名
        
        if (!fileName) {
          throw new Error('无效的本地文件路径');
        }
        
        let currentPath = '';
        
        // 确保所有子目录存在
        for (const part of pathParts) {
          currentPath += '/' + part;
          // 如果目录不存在，创建它
          if (!(await this.app.vault.adapter.exists(currentPath))) {
            await this.app.vault.adapter.mkdir(currentPath);
          }
        }
        
        // 写入文件
        await this.app.vault.adapter.writeBinary(localPath, content);
        
        console.log(`文件下载成功: ${remotePath} -> ${localPath}`);
      } else {
        console.warn(`下载文件失败，状态码: ${response.status}`);
        throw new StorageProviderError(`下载文件失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
      }
    } catch (error) {
      console.error('下载WebDAV文件失败:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 下载文件内容
   * @param remotePath 远程路径
   * @returns 文件内容
   * @author Bing
   */
  async downloadFileContent(remotePath: string): Promise<string | ArrayBuffer> {
    try {
      console.log(`下载WebDAV文件内容: ${remotePath}`);
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        await this.connect();
      }
      
      // 规范化路径
      remotePath = formatPath(remotePath);
      
      // 准备URL
      const url = this.formatUrl(this.config.serverUrl) + (remotePath.startsWith('/') ? remotePath.slice(1) : remotePath);
      
      // 准备GET请求
      const requestParams: RequestUrlParam = {
        url,
        method: "GET",
        headers: this.getHeaders()
      };
      
      // 执行请求
      const response = await requestUrl(requestParams);
      
      if (response.status >= 200 && response.status < 300) {
        // 检查是否为二进制内容
        const contentType = response.headers['content-type'] || '';
        const extension = remotePath.split('.').pop() || '';
        
        if (this.isBinaryContentType(contentType) || this.isBinaryFileType(extension)) {
          console.log(`文件 ${remotePath} 被识别为二进制类型，返回ArrayBuffer`);
          return response.arrayBuffer;
        } else {
          console.log(`文件 ${remotePath} 被识别为文本类型，返回文本内容`);
          return response.text;
        }
      } else {
        console.warn(`下载文件内容失败，状态码: ${response.status}`);
        throw new StorageProviderError(`下载文件内容失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
      }
    } catch (error) {
      console.error('下载WebDAV文件内容失败:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 检查文件类型是否为二进制
   * @param fileExt 文件扩展名
   * @returns 是否为二进制文件
   */
  private isBinaryFileType(fileExt: string): boolean {
    return isBinaryFileType(fileExt);
  }
  
  /**
   * 检查内容类型是否为二进制
   * @param contentType 内容类型
   * @returns 是否为二进制内容
   */
  private isBinaryContentType(contentType: string): boolean {
    return isBinaryContentType(contentType);
  }
  
  /**
   * 检查内容类型是否为文本
   * @param contentType 内容类型
   * @returns 是否为文本内容
   */
  private isTextContentType(contentType: string): boolean {
    return isTextContentType(contentType);
  }

  /**
   * 上传文件
   * @param remotePath 远程路径
   * @param content 文件内容
   * @author Bing
   */
  async uploadFile(remotePath: string, content: string | ArrayBuffer): Promise<void> {
    try {
      console.log(`上传文件到WebDAV: ${remotePath}`);
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        await this.connect();
      }
      
      // 规范化路径
      remotePath = formatPath(remotePath);
      
      // 确保父目录存在
      await this.ensureDirectoryExists(this.getParentPath(remotePath));
      
      // 准备URL
      const url = this.formatUrl(this.config.serverUrl) + (remotePath.startsWith('/') ? remotePath.slice(1) : remotePath);
      
      // 准备请求头
      const headers = {
        ...this.getHeaders()
      };
      
      // 如果内容是字符串，添加合适的内容类型
      if (typeof content === 'string') {
        headers['Content-Type'] = 'text/plain;charset=UTF-8';
      }
      
      // 准备PUT请求
      const requestParams: RequestUrlParam = {
        url,
        method: "PUT",
        headers,
        body: content
      };
      
      // 执行请求
      const response = await requestUrl(requestParams);
      
      if (response.status >= 200 && response.status < 300) {
        console.log(`文件上传成功: ${remotePath}`);
      } else {
        console.warn(`上传文件失败，状态码: ${response.status}`);
        throw new StorageProviderError(`上传文件失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
      }
    } catch (error) {
      console.error('上传WebDAV文件失败:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 获取父目录路径
   * @param path 文件路径
   * @returns 父目录路径
   */
  private getParentPath(path: string): string {
    // 规范化路径
    path = formatPath(path);
    
    // 如果路径为根目录，返回根目录
    if (path === '/') {
      return '/';
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
   * @param recursionLevel 递归级别，用于防止过深递归
   * @author Bing
   */
  async ensureDirectoryExists(path: string, recursionLevel: number = 0): Promise<void> {
    try {
      // 防止无限递归
      if (recursionLevel > 10) {
        throw new Error('目录层级过深，超过最大递归深度');
      }
      
      // 如果是根目录，不需要创建
      if (path === '/' || path === '') {
        return;
      }
      
      try {
        // 检查目录是否存在
        const exists = await this.folderExists(path);
        
        if (exists) {
          // 目录已存在，无需创建
          return;
        }
      } catch (error) {
        // 如果检查失败（通常是因为目录不存在），继续创建
        console.warn(`检查目录 ${path} 是否存在时出错:`, error);
      }
      
      // 确保父目录存在
      const parentPath = this.getParentPath(path);
      await this.ensureDirectoryExists(parentPath, recursionLevel + 1);
      
      // 创建当前目录
      await this.createFolder(path, recursionLevel);
    } catch (error) {
      // 特殊处理冲突错误，可能是目录已经存在
      if (error instanceof StorageProviderError && error.code === 'CONFLICT') {
        console.log(`目录 ${path} 已经存在，无需创建`);
        return;
      }
      
      console.error(`确保目录 ${path} 存在时失败:`, error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 删除文件
   * @param remotePath 远程路径
   * @author Bing
   */
  async deleteFile(remotePath: string): Promise<void> {
    try {
      console.log(`从WebDAV删除文件: ${remotePath}`);
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        await this.connect();
      }
      
      // 规范化路径
      remotePath = formatPath(remotePath);
      
      // 准备URL
      const url = this.formatUrl(this.config.serverUrl) + (remotePath.startsWith('/') ? remotePath.slice(1) : remotePath);
      
      // 准备DELETE请求
      const requestParams: RequestUrlParam = {
        url,
        method: "DELETE",
        headers: this.getHeaders()
      };
      
      // 执行请求
      const response = await requestUrl(requestParams);
      
      if (response.status >= 200 && response.status < 300) {
        console.log(`文件删除成功: ${remotePath}`);
      } else if (response.status === 404) {
        // 文件不存在也算成功
        console.log(`文件不存在，无需删除: ${remotePath}`);
      } else {
        console.warn(`删除文件失败，状态码: ${response.status}`);
        throw new StorageProviderError(`删除文件失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
      }
    } catch (error) {
      // 如果是404错误，文件不存在，视为成功
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        console.log(`文件不存在，无需删除: ${remotePath}`);
        return;
      }
      
      console.error('删除WebDAV文件失败:', error);
      throw this.handleError(error);
    }
  }

  /**
   * 移动文件
   * @param oldPath 原路径
   * @param newPath 新路径
   * @author Bing
   */
  async moveFile(oldPath: string, newPath: string): Promise<void> {
    try {
      console.log(`移动WebDAV文件: ${oldPath} -> ${newPath}`);
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        await this.connect();
      }
      
      // 规范化路径
      oldPath = formatPath(oldPath);
      newPath = formatPath(newPath);
      
      // 如果源路径和目标路径相同，无需移动
      if (oldPath === newPath) {
        console.log('源路径和目标路径相同，无需移动');
        return;
      }
      
      // 确保目标文件的父目录存在
      await this.ensureDirectoryExists(this.getParentPath(newPath));
      
      // 准备URL
      const sourceUrl = this.formatUrl(this.config.serverUrl) + (oldPath.startsWith('/') ? oldPath.slice(1) : oldPath);
      const destinationUrl = this.formatUrl(this.config.serverUrl) + (newPath.startsWith('/') ? newPath.slice(1) : newPath);
      
      // 准备MOVE请求
      const requestParams: RequestUrlParam = {
        url: sourceUrl,
        method: "MOVE",
        headers: {
          ...this.getHeaders(),
          'Destination': destinationUrl,
          'Overwrite': 'T' // 覆盖目标文件（如果存在）
        }
      };
      
      // 执行请求
      const response = await requestUrl(requestParams);
      
      if (response.status >= 200 && response.status < 300) {
        console.log(`文件移动成功: ${oldPath} -> ${newPath}`);
      } else {
        console.warn(`移动文件失败，状态码: ${response.status}`);
        throw new StorageProviderError(`移动文件失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
      }
    } catch (error) {
      console.error('移动WebDAV文件失败:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 创建文件夹
   * @param path 路径
   * @param recursionLevel 递归级别，用于防止过深递归
   * @author Bing
   */
  async createFolder(path: string, recursionLevel: number = 0): Promise<void> {
    try {
      // 防止无限递归
      if (recursionLevel > 10) {
        throw new Error('目录层级过深，超过最大递归深度');
      }
      
      console.log(`在WebDAV创建文件夹: ${path}`);
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        await this.connect();
      }
      
      // 规范化路径
      path = formatPath(path);
      
      // 如果是根目录，不需要创建
      if (path === '/' || path === '') {
        return;
      }
      
      // 准备URL
      const url = this.formatUrl(this.config.serverUrl) + (path.startsWith('/') ? path.slice(1) : path);
      
      // 准备MKCOL请求
      const requestParams: RequestUrlParam = {
        url,
        method: "MKCOL",
        headers: this.getHeaders()
      };
      
      // 执行请求
      const response = await requestUrl(requestParams);
      
      if (response.status >= 200 && response.status < 300) {
        console.log(`文件夹创建成功: ${path}`);
      } else if (response.status === 405 || response.status === 409) {
        // 405或409通常表示目录已存在
        console.log(`文件夹已存在: ${path}`);
      } else {
        console.warn(`创建文件夹失败，状态码: ${response.status}`);
        throw new StorageProviderError(`创建文件夹失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
      }
    } catch (error) {
      // 特殊处理冲突错误，可能是目录已经存在
      if (error && typeof error === 'object' && 'status' in error && 
          (error.status === 405 || error.status === 409)) {
        console.log(`文件夹已存在: ${path}`);
        return;
      }
      
      console.error('创建WebDAV文件夹失败:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 删除文件夹
   * @param path 路径
   * @author Bing
   */
  async deleteFolder(path: string): Promise<void> {
    try {
      console.log(`从WebDAV删除文件夹: ${path}`);
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        await this.connect();
      }
      
      // 规范化路径
      path = formatPath(path);
      
      // 如果是根目录，不允许删除
      if (path === '/' || path === '') {
        throw new Error('不允许删除根目录');
      }
      
      // 准备URL
      const url = this.formatUrl(this.config.serverUrl) + (path.startsWith('/') ? path.slice(1) : path);
      
      // 准备DELETE请求
      const requestParams: RequestUrlParam = {
        url,
        method: "DELETE",
        headers: this.getHeaders()
      };
      
      // 执行请求
      const response = await requestUrl(requestParams);
      
      if (response.status >= 200 && response.status < 300) {
        console.log(`文件夹删除成功: ${path}`);
      } else if (response.status === 404) {
        // 文件夹不存在也算成功
        console.log(`文件夹不存在，无需删除: ${path}`);
      } else {
        console.warn(`删除文件夹失败，状态码: ${response.status}`);
        throw new StorageProviderError(`删除文件夹失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
      }
    } catch (error) {
      // 如果是404错误，文件夹不存在，视为成功
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        console.log(`文件夹不存在，无需删除: ${path}`);
        return;
      }
      
      console.error('删除WebDAV文件夹失败:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 检查文件夹是否存在
   * @param path 路径
   * @returns 文件夹是否存在
   * @author Bing
   */
  async folderExists(path: string): Promise<boolean> {
    try {
      console.log(`检查WebDAV文件夹是否存在: ${path}`);
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        await this.connect();
      }
      
      // 规范化路径
      path = formatPath(path);
      
      // 根目录总是存在
      if (path === '/' || path === '') {
        return true;
      }
      
      // 准备URL
      const url = this.formatUrl(this.config.serverUrl) + (path.startsWith('/') ? path.slice(1) : path);
      
      // 准备PROPFIND请求
      const requestParams: RequestUrlParam = {
        url,
        method: "PROPFIND",
        headers: {
          ...this.getHeaders(),
          'Depth': '0' // 只获取当前资源信息
        },
        body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`,
        throw: false // 不抛出错误，以便我们可以处理它
      };
      
      // 执行请求
      const response = await requestUrl(requestParams);
      
      if (response.status >= 200 && response.status < 300) {
        // 解析响应，获取资源类型
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(response.text, 'text/xml');
        
        // 检查是否为目录
        const resourceType = xmlDoc.querySelector('resourcetype');
        if (resourceType) {
          const collection = resourceType.querySelector('collection');
          return !!collection; // 如果包含collection元素，则是目录
        }
        
        return false; // 资源存在但不是目录
      } else if (response.status === 404) {
        // 资源不存在
        return false;
      } else {
        console.warn(`检查文件夹是否存在失败，状态码: ${response.status}`);
        throw new StorageProviderError(`检查文件夹是否存在失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
      }
    } catch (error) {
      // 如果是404错误，目录不存在
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        return false;
      }
      
      console.error('检查WebDAV文件夹是否存在失败:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 获取文件元数据
   * @param path 路径
   * @returns 文件元数据
   * @author Bing
   */
  async getFileMetadata(path: string): Promise<FileMetadata> {
    try {
      console.log(`获取WebDAV文件元数据: ${path}`);
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        await this.connect();
      }
      
      // 规范化路径
      path = formatPath(path);
      
      // 准备URL
      const url = this.formatUrl(this.config.serverUrl) + (path.startsWith('/') ? path.slice(1) : path);
      
      // 准备PROPFIND请求
      const requestParams: RequestUrlParam = {
        url,
        method: "PROPFIND",
        headers: {
          ...this.getHeaders(),
          'Depth': '0' // 只获取当前资源信息
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
      const response = await requestUrl(requestParams);
      
      if (response.status >= 200 && response.status < 300) {
        // 解析响应
        const fileInfos = parseFileInfoFromResponse(response.text, url, path);
        
        if (fileInfos.length === 0) {
          throw new StorageProviderError('无法获取文件元数据，服务器响应未包含文件信息', 'PARSE_ERROR');
        }
        
        const fileInfo = fileInfos[0];
        
        // 转换为FileMetadata
        return {
          path: fileInfo.path,
          name: fileInfo.name,
          isFolder: fileInfo.isFolder,
          size: fileInfo.size,
          modifiedTime: fileInfo.modifiedTime,
          etag: fileInfo.etag
        };
      } else if (response.status === 404) {
        throw new StorageProviderError('文件不存在', 'NOT_FOUND');
      } else {
        console.warn(`获取文件元数据失败，状态码: ${response.status}`);
        throw new StorageProviderError(`获取文件元数据失败，服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
      }
    } catch (error) {
      console.error('获取WebDAV文件元数据失败:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 获取配额信息
   * @returns 配额信息
   * @author Bing
   */
  async getQuota(): Promise<QuotaInfo> {
    try {
      console.log('获取WebDAV配额信息');
      
      // 确保连接状态
      if (this.status !== ConnectionStatus.CONNECTED) {
        await this.connect();
      }
      
      // 准备URL - 使用根目录
      const url = this.formatUrl(this.config.serverUrl);
      
      // 准备PROPFIND请求
      const requestParams: RequestUrlParam = {
        url,
        method: "PROPFIND",
        headers: {
          ...this.getHeaders(),
          'Depth': '0' // 只获取当前资源信息
        },
        body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:quota-available-bytes/>
    <D:quota-used-bytes/>
  </D:prop>
</D:propfind>`,
        throw: false // 不抛出错误，以便我们可以处理它
      };
      
      // 执行请求
      const response = await requestUrl(requestParams);
      
      if (response.status >= 200 && response.status < 300) {
        // 解析响应
        const quota = parseQuotaFromResponse(response.text);
        
        return {
          available: quota.available,
          used: quota.used,
          total: quota.available >= 0 && quota.used >= 0 ? quota.available + quota.used : -1
        };
      } else {
        console.warn(`获取配额信息失败，状态码: ${response.status}`);
        return {
          available: -1,
          used: -1,
          total: -1
        };
      }
    } catch (error) {
      console.error('获取WebDAV配额信息失败:', error);
      
      // 获取配额信息失败不应阻止其他操作，返回默认值
      return {
        available: -1,
        used: -1,
        total: -1
      };
    }
  }
} 