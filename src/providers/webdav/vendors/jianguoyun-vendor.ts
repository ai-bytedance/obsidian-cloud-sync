import { App, RequestUrlParam, requestUrl } from 'obsidian';
import { WebDAVSettings } from '@models/plugin-settings';
import { GenericWebDAVVendor } from './generic-vendor';
import { ConnectionStatus, StorageProviderError } from '@providers/common/storage-provider';

/**
 * 坚果云WebDAV提供商
 * 为坚果云提供特定优化和处理
 * @author Bing
 */
export class JianguoyunWebDAVVendor extends GenericWebDAVVendor {
  private readonly name = '坚果云';
  private isPaidUser: boolean;
  private requestDelay: number;
  
  /**
   * 创建坚果云WebDAV提供商实例
   * @param config WebDAV配置
   * @param app Obsidian应用实例
   * @author Bing
   */
  constructor(config: WebDAVSettings, app: App) {
    super(config, app);
    
    // 特定坚果云配置
    this.isPaidUser = config.isPaidUser || false;
    
    // 根据用户类型和设置确定请求延迟
    this.requestDelay = this.calculateRequestDelay(config);
  }
  
  /**
   * 获取提供商名称
   * @returns 名称
   * @author Bing
   */
  getName(): string {
    return this.name;
  }
  
  /**
   * 计算请求延迟时间
   * 根据用户类型和设置确定API请求之间的延迟
   * @param config WebDAV配置
   * @returns 延迟毫秒数
   */
  private calculateRequestDelay(config: WebDAVSettings): number {
    // 免费用户有API请求限制
    if (!this.isPaidUser) {
      // 用户自定义延迟级别
      if (config.requestDelay) {
        switch(config.requestDelay) {
          case 'slow': return 2000; // 慢速 - 2秒
          case 'very-slow': return 5000; // 非常慢 - 5秒
          case 'normal':
          default: return 1000; // 普通 - 1秒
        }
      }
      return 1000; // 默认1秒
    }
    
    // 付费用户无需严格限制，但仍保持一定间隔避免被拦截
    return 300;
  }
  
  /**
   * 检查当前服务是否为坚果云
   * @returns 是否为坚果云
   * @author Bing
   */
  protected isJianGuoYun(): boolean {
    return true;
  }
  
  /**
   * 连接到坚果云WebDAV服务器
   * 包含坚果云特定的连接逻辑
   * @returns 连接是否成功
   * @author Bing
   */
  async connect(): Promise<boolean> {
    try {
      console.log('开始连接到坚果云WebDAV服务器...');
      this.status = ConnectionStatus.CONNECTING;
      
      // 检查配置合法性
      if (!this.config || !this.config.username || !this.config.password) {
        console.error('坚果云WebDAV配置不完整，缺少用户名或密码');
        this.status = ConnectionStatus.ERROR;
        throw new StorageProviderError('坚果云WebDAV配置不完整，请检查用户名和密码', 'CONFIG_ERROR');
      }
      
      if (!this.config.serverUrl || this.config.serverUrl.trim() === '') {
        console.error('坚果云WebDAV配置不完整，缺少服务器URL');
        this.status = ConnectionStatus.ERROR;
        throw new StorageProviderError('坚果云WebDAV配置不完整，请检查服务器URL', 'CONFIG_ERROR');
      }
      
      // 检查URL是否为坚果云URL
      const url = this.config.serverUrl.toLowerCase().trim();
      if (!url.includes('dav.jianguoyun.com') && !url.includes('jianguoyun') && !url.includes('jgy')) {
        console.warn('提供的URL可能不是坚果云WebDAV地址');
      }
      
      // 尝试连接
      let success = false;
      let connectAttempts = 0;
      const maxConnectAttempts = 5; // 坚果云适用的最大重试次数
      let retryDelay = 3000; // 初始重试延迟3秒
      
      while (!success && connectAttempts < maxConnectAttempts) {
        try {
          connectAttempts++;
          console.log(`尝试连接到坚果云 (尝试 ${connectAttempts}/${maxConnectAttempts})...`);
          
          // 格式化URL并构建请求参数
          const url = this.formatUrl(this.config.serverUrl);
          
          // 针对坚果云优化的请求参数
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
            console.log('坚果云WebDAV连接成功');
            success = true;
            this.status = ConnectionStatus.CONNECTED;
            
            // 坚果云特定的连接后处理
            this.verifyAccountType();
          } else {
            console.warn(`坚果云WebDAV连接返回非成功状态码: ${response.status}`);
            this.status = ConnectionStatus.ERROR;
            throw new StorageProviderError(`连接失败，坚果云服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
          }
        } catch (error) {
          console.warn(`坚果云WebDAV连接尝试 ${connectAttempts} 失败:`, error);
          
          // 检查特定坚果云错误
          if (error instanceof StorageProviderError) {
            if (error.code === 'AUTH_FAILED') {
              throw new StorageProviderError('坚果云认证失败，请检查用户名和密码，确认使用的是应用密码而非登录密码', 'AUTH_FAILED', error.originalError);
            }
          }
          
          // 增加重试延迟时间
          retryDelay = Math.min(retryDelay * 1.5, 30000); // 最大延迟30秒
          
          if (connectAttempts < maxConnectAttempts) {
            console.log(`将在 ${retryDelay/1000} 秒后重试连接坚果云...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            console.error('坚果云WebDAV连接失败，已达到最大重试次数');
            this.status = ConnectionStatus.ERROR;
            throw new StorageProviderError(`坚果云WebDAV连接失败，已尝试 ${maxConnectAttempts} 次，请稍后再试或检查网络连接`, 'CONNECTION_FAILED', error);
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
   * 验证坚果云账户类型
   * 检查用户是否为付费用户
   */
  private async verifyAccountType() {
    try {
      // 获取配额信息
      const quota = await this.getQuota();
      
      // 根据配额判断用户类型
      // 坚果云免费用户通常有1GB空间限制
      if (quota.total > 1.1 * 1024 * 1024 * 1024) { // 超过1.1GB，可能是付费用户
        console.log('检测到坚果云付费用户账户');
        this.isPaidUser = true;
        
        // 更新请求延迟
        this.requestDelay = this.calculateRequestDelay(this.config);
      } else {
        console.log('检测到坚果云免费用户账户');
        this.isPaidUser = false;
      }
    } catch (error) {
      console.warn('无法验证坚果云账户类型:', error);
      // 错误不影响核心功能，继续使用当前设置
    }
  }
  
  /**
   * 处理坚果云特定错误
   * @param error 原始错误
   * @returns StorageProviderError
   * @author Bing
   */
  protected handleError(error: any): StorageProviderError {
    // 如果错误已经是StorageProviderError类型，直接返回
    if (error instanceof StorageProviderError) {
      return error;
    }
    
    // 尝试从错误中获取状态码
    const statusCode = error && typeof error === 'object' && 'status' in error ? error.status as number : 0;
    
    // 坚果云特定错误处理
    if (statusCode === 401 || statusCode === 403) {
      return new StorageProviderError('坚果云认证失败，请检查用户名和密码，确认使用的是应用密码而非登录密码', 'AUTH_FAILED', error);
    } else if (statusCode === 405) {
      return new StorageProviderError('坚果云不支持此操作，可能需要升级账户或调整权限', 'OPERATION_NOT_ALLOWED', error);
    } else if (statusCode === 429) {
      return new StorageProviderError('坚果云请求次数过多，请稍后重试', 'RATE_LIMITED', error);
    } else if (statusCode === 507) {
      return new StorageProviderError('坚果云存储空间不足，请清理空间或升级账户', 'INSUFFICIENT_STORAGE', error);
    }
    
    // 对于其他错误，使用基类处理
    return super.handleError(error);
  }
  
  /**
   * 获取针对坚果云的请求头
   * @returns 请求头对象
   * @author Bing
   */
  protected getHeaders(): Record<string, string> {
    // 坚果云特定请求头
    return {
      'Authorization': this.getAuthHeader(),
      'Accept': '*/*',
      'Cache-Control': 'no-cache'
    };
  }
  
  /**
   * 上传文件到坚果云
   * 包含针对坚果云的请求限制处理
   * @param localPath 本地路径
   * @param remotePath 远程路径
   * @author Bing
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    // 坚果云免费用户需要添加延迟避免请求过快
    if (!this.isPaidUser && this.requestDelay > 0) {
      await this.addRequestDelay();
    }
    
    // 调用基类方法执行上传
    return super.uploadFile(localPath, remotePath);
  }
  
  /**
   * 添加请求延迟
   * 避免坚果云API请求过快导致限流
   */
  private async addRequestDelay(): Promise<void> {
    if (this.requestDelay > 0) {
      console.log(`添加坚果云请求延迟: ${this.requestDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, this.requestDelay));
    }
  }
  
  /**
   * 创建坚果云文件夹
   * 包含针对坚果云的请求限制处理
   * @param path 路径
   * @author Bing
   */
  async createFolder(path: string): Promise<void> {
    try {
      // 坚果云免费用户需要添加延迟避免请求过快
      if (!this.isPaidUser && this.requestDelay > 0) {
        await this.addRequestDelay();
      }
      
      // 调用基类方法执行创建
      return super.createFolder(path);
    } catch (error) {
      console.error(`无法创建坚果云文件夹"${path}"`, error);
      throw new StorageProviderError(`无法创建坚果云文件夹"${path}"，请检查WebDAV权限、应用访问限制或网络连接`, 'FOLDER_CREATE_ERROR', error instanceof Error ? error : undefined);
    }
  }
} 