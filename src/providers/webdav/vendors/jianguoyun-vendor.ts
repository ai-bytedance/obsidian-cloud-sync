import { App, RequestUrlParam, requestUrl } from 'obsidian';
import { WebDAVSettings, RequestDelayLevel } from '@models/plugin-settings';
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
  private userDefinedAccountType: boolean = false; // 跟踪用户是否明确设置了账户类型
  
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
    // 如果配置中有isPaidUser字段，视为用户已定义
    this.userDefinedAccountType = config.isPaidUser !== undefined;
    
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
    // 先保存原始延迟值用于日志记录
    const oldDelay = this.requestDelay;
    
    let newDelay: number;
    
    // 分离付费用户和免费用户的逻辑，确保互不干扰
    if (this.isPaidUser) {
      // 付费用户固定使用较低延迟，无论UI选择什么延迟级别
      newDelay = 100; // 付费用户固定100毫秒
      console.log(`计算延迟 (付费用户)：无视配置级别 "${config.requestDelay || 'normal'}"，固定使用 ${newDelay}ms`);
    } else {
      // 免费用户基于UI设置应用不同延迟
      if (config.requestDelay) {
        switch(config.requestDelay) {
          case 'slow':
            newDelay = 500;
            console.log(`计算延迟 (免费用户)：配置级别 "${config.requestDelay}" => ${newDelay}ms`);
            break;
          case 'very-slow':
            newDelay = 1000;
            console.log(`计算延迟 (免费用户)：配置级别 "${config.requestDelay}" => ${newDelay}ms`);
            break;
          case 'normal':
          default:
            newDelay = 200;
            console.log(`计算延迟 (免费用户)：配置级别 "${config.requestDelay || 'normal'}" => ${newDelay}ms`);
            break;
        }
      } else {
        // 无延迟设置，使用默认值
        newDelay = 200; // 默认200毫秒
        console.log(`计算延迟 (免费用户)：无配置级别，使用默认 ${newDelay}ms`);
      }
    }
    
    // 如果与旧值不同，记录变化
    if (oldDelay !== undefined && newDelay !== oldDelay) {
      console.log(`延迟值已更新: ${oldDelay}ms -> ${newDelay}ms (账户类型: ${this.isPaidUser ? '付费' : '免费'}, 级别: ${config.requestDelay || 'normal'})`);
    }
    
    return newDelay;
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
      // 保存原始账户类型和延迟值用于比较
      const originalIsPaid = this.isPaidUser;
      const originalDelay = this.requestDelay;
      
      // 获取配额信息
      const quota = await this.getQuota();
      
      // 根据配额判断用户类型
      // 坚果云免费用户通常有1GB空间限制
      const newIsPaid = quota.total > 1.1 * 1024 * 1024 * 1024; // 超过1.1GB，可能是付费用户
      
      if (newIsPaid !== originalIsPaid) {
        // 检查用户是否已明确设置账户类型
        if (this.userDefinedAccountType) {
          // 用户已明确设置，仅记录不一致但不更改设置
          console.log(`账户类型自动检测结果(${newIsPaid ? '付费用户' : '免费用户'})与用户设置(${originalIsPaid ? '付费用户' : '免费用户'})不一致，保留用户设置`);
        } else {
          // 用户未明确设置，自动更新
          console.log(`账户类型自动检测变更: ${originalIsPaid ? '付费用户' : '免费用户'} -> ${newIsPaid ? '付费用户' : '免费用户'}`);
          this.isPaidUser = newIsPaid;
          
          // 如果配置对象存在，也更新它
          if (this.config) {
            this.config.isPaidUser = newIsPaid;
            
            // 更新请求延迟
            const newDelay = this.calculateRequestDelay(this.config);
            console.log(`账户类型变更导致延迟更新: ${originalDelay}ms -> ${newDelay}ms`);
            this.requestDelay = newDelay;
          }
        }
      }
      
      // 验证延迟值
      this.verifyRequestDelay();
    } catch (error) {
      console.warn('无法验证坚果云账户类型:', error);
    }
  }
  
  /**
   * 验证请求延迟值是否符合预期
   * 如果不符合预期，记录警告并返回应该使用的值
   * @returns true如果延迟值符合预期，false如果不符合
   */
  private verifyRequestDelay(): boolean {
    // 计算预期的延迟值
    let expectedDelay: number;
    
    if (this.isPaidUser) {
      expectedDelay = 100; // 付费用户固定100ms
    } else if (this.config?.requestDelay) {
      // 免费用户基于设置
      switch(this.config.requestDelay) {
        case 'slow': expectedDelay = 500; break;
        case 'very-slow': expectedDelay = 1000; break;
        case 'normal':
        default: expectedDelay = 200; break;
      }
    } else {
      // 默认值
      expectedDelay = 200;
    }
    
    // 检查当前值与预期值是否一致
    if (this.requestDelay !== expectedDelay) {
      console.warn(`坚果云请求延迟验证失败: 当前=${this.requestDelay}ms, 预期=${expectedDelay}ms`);
      return false;
    }
    
    return true;
  }
  
  /**
   * 获取延迟级别描述
   */
  private getDelayLevelDescription(delayMs: number, isPaid: boolean): string {
    if (isPaid) {
      return "付费用户 (固定100ms)";
    }
    
    switch(delayMs) {
      case 200: return "normal (200ms)";
      case 500: return "slow (500ms)";
      case 1000: return "very-slow (1000ms)";
      default: return `未知 (${delayMs}ms)`;
    }
  }

  /**
   * 添加请求延迟
   * 避免坚果云API请求过快导致限流
   */
  private async addRequestDelay(): Promise<void> {
    // 验证延迟值，如有问题尝试修复
    if (!this.verifyRequestDelay() && this.config) {
      this.requestDelay = this.calculateRequestDelay(this.config);
    }
    
    if (this.requestDelay > 0) {
      // 根据当前延迟值确定对应的级别描述
      let levelDesc = this.getDelayLevelDescription(this.requestDelay, this.isPaidUser);
      console.log(`添加坚果云请求延迟: ${this.requestDelay}ms (账户类型: ${this.isPaidUser ? '付费' : '免费'}, 级别: ${levelDesc})`);
      await new Promise(resolve => setTimeout(resolve, this.requestDelay));
    } else {
      console.warn(`警告: 请求延迟值异常 (${this.requestDelay}ms)`);
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
    // 坚果云请求限制处理 - 不再区分用户类型，统一使用延迟以简化逻辑
    // 根据当前设置的延迟值添加合适的延迟
    await this.addRequestDelay();
    
    // 调用基类方法执行上传
    return super.uploadFile(localPath, remotePath);
  }
  
  /**
   * 创建坚果云文件夹
   * 包含针对坚果云的请求限制处理
   * @param path 路径
   * @author Bing
   */
  async createFolder(path: string): Promise<void> {
    try {
      // 坚果云请求限制处理 - 统一使用请求延迟
      await this.addRequestDelay();
      
      // 调用基类方法执行创建
      return super.createFolder(path);
    } catch (error) {
      console.error(`无法创建坚果云文件夹"${path}"`, error);
      throw new StorageProviderError(`无法创建坚果云文件夹"${path}"，请检查WebDAV权限、应用访问限制或网络连接`, 'FOLDER_CREATE_ERROR', error instanceof Error ? error : undefined);
    }
  }
  
  /**
   * 更新请求延迟设置
   * 当用户在UI中更改延迟设置时调用
   * @param delayLevel 新的延迟级别
   */
  public async updateRequestDelay(delayLevel: RequestDelayLevel): Promise<void> {
    if (!this.config) {
      this.config = {
        enabled: true,
        username: '',
        password: '',
        serverUrl: '',
        syncPath: ''
      };
    }
    
    // 记录当前值以便对比
    const oldDelayLevel = this.config.requestDelay;
    const oldDelay = this.requestDelay;
    
    // 更新配置中的延迟级别
    this.config.requestDelay = delayLevel;
    
    // 重新计算实际延迟值
    this.requestDelay = this.calculateRequestDelay(this.config);
    
    // 确认是否符合预期值
    let expectedDelay = 0;
    if (this.isPaidUser) {
      expectedDelay = 100;
    } else {
      switch(delayLevel) {
        case 'normal': expectedDelay = 200; break;
        case 'slow': expectedDelay = 500; break;
        case 'very-slow': expectedDelay = 1000; break;
      }
    }
    
    if (this.requestDelay !== expectedDelay) {
      console.warn(`坚果云请求延迟不一致: 预期${expectedDelay}ms, 实际${this.requestDelay}ms (级别: ${delayLevel}, 付费用户: ${this.isPaidUser})`);
      this.requestDelay = expectedDelay;
    }
    
    console.log(`坚果云请求延迟更新: ${oldDelay}ms -> ${this.requestDelay}ms (级别: ${oldDelayLevel} -> ${delayLevel})`);
  }
  
  /**
   * 更新账户类型设置
   * 当用户在UI中更改账户类型设置时调用
   * @param isPaidUser 是否为付费用户
   */
  public async updateAccountType(isPaidUser: boolean): Promise<void> {
    if (!this.config) {
      this.config = {
        enabled: true,
        username: '',
        password: '',
        serverUrl: '',
        syncPath: ''
      };
    }
    
    // 记录当前状态
    const oldValue = this.isPaidUser;
    const oldDelay = this.requestDelay;
    
    // 更新实例中的账户类型和配置对象
    this.isPaidUser = isPaidUser;
    this.config.isPaidUser = isPaidUser;
    
    // 标记为用户明确设置
    this.userDefinedAccountType = true;
    
    // 记录账户类型变更
    console.log(`坚果云账户类型更新: ${oldValue ? '付费用户' : '免费用户'} -> ${isPaidUser ? '付费用户' : '免费用户'}`);
    
    // 根据新的账户类型重新计算请求延迟
    this.requestDelay = this.calculateRequestDelay(this.config);
    
    // 确认是否符合预期值
    let expectedDelay = 0;
    if (isPaidUser) {
      expectedDelay = 100;
    } else {
      switch(this.config.requestDelay) {
        case 'normal': expectedDelay = 200; break;
        case 'slow': expectedDelay = 500; break;
        case 'very-slow': expectedDelay = 1000; break;
        default: expectedDelay = 200; // 默认
      }
    }
    
    if (this.requestDelay !== expectedDelay) {
      console.warn(`账户类型更新后延迟不一致: 预期${expectedDelay}ms, 实际${this.requestDelay}ms (级别: ${this.config.requestDelay || 'normal'})`);
      this.requestDelay = expectedDelay;
    }
    
    // 记录延迟变更
    console.log(`账户类型变更导致请求延迟更新: ${oldDelay}ms -> ${this.requestDelay}ms`);
  }
} 