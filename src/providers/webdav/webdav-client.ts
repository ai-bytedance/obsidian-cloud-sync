import { App, RequestUrlParam, requestUrl } from 'obsidian';
import { StorageProviderError } from '@providers/common/storage-provider';
import { WebDAVSettings } from '@models/plugin-settings';

/**
 * WebDAV客户端类
 * 处理HTTP请求和认证
 * @author Bing
 */
export class WebDAVClient {
  protected config: WebDAVSettings;
  protected app: App;
  
  /**
   * 构造函数
   * @param config WebDAV配置
   * @param app Obsidian应用实例
   */
  constructor(config: WebDAVSettings, app: App) {
    this.config = config;
    this.app = app;
  }
  
  /**
   * 获取认证头
   * @returns 认证头字符串
   */
  getAuthHeader(): string {
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
  encodeAuthString(str: string): string {
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
  isJianGuoYun(): boolean {
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
   * 获取HTTP请求头
   * @returns 请求头对象
   */
  getHeaders(): Record<string, string> {
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
   * 格式化URL
   * @param url URL字符串
   * @returns 格式化后的URL
   */
  formatUrl(url: string): string {
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
  handleError(error: any): StorageProviderError {
    // 如果已经是StorageProviderError，直接返回
    if (error instanceof StorageProviderError) {
      return error;
    }
    
    let errorCode = 'UNKNOWN_ERROR';
    let errorMessage = '未知错误';
    
    // 处理Obsidian请求错误
    if (error && typeof error === 'object') {
      if ('status' in error) {
        const status = error.status as number;
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
        
        // 创建适当的错误消息
        return new StorageProviderError(errorMessage, errorCode, error);
      }
      
      // 处理网络错误
      if ('name' in error && error.name === 'NetworkError') {
        return new StorageProviderError('网络连接错误，请检查网络连接', 'NETWORK_ERROR', error);
      }
      
      // 处理超时错误
      if ('name' in error && error.name === 'AbortError') {
        return new StorageProviderError('请求超时', 'TIMEOUT', error);
      }
    }
    
    // 对于其他类型的错误，使用fromError方法创建标准错误
    return StorageProviderError.fromError(error);
  }
  
  /**
   * 执行WebDAV请求
   * @param params 请求参数
   * @returns 响应对象
   */
  async request(params: RequestUrlParam): Promise<any> {
    try {
      // 确保有headers
      if (!params.headers) {
        params.headers = this.getHeaders();
      }
      
      // 注意：RequestUrlParam目前不支持timeout配置，
      // 如需超时控制，可考虑在应用层实现
      
      // 执行请求
      const response = await requestUrl(params);
      return response;
    } catch (error) {
      throw this.handleError(error);
    }
  }
} 