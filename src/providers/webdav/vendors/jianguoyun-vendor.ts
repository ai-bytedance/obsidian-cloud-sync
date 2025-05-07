import { App, RequestUrlParam, requestUrl } from 'obsidian';
import { WebDAVSettings, RequestDelayLevel } from '@models/plugin-settings';
import { GenericWebDAVVendor } from './generic-vendor';
import { ConnectionStatus, StorageProviderError } from '@providers/common/storage-provider';
import CloudSyncPlugin from '@main';

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
   * @param plugin 可选，插件实例，用于获取日志服务
   * @author Bing
   */
  constructor(config: WebDAVSettings, app: App, plugin?: CloudSyncPlugin) {
    super(config, app, plugin);
    
    if (plugin && plugin.logService && !this.logger) {
      this.logger = plugin.logService.getModuleLogger('JianguoyunWebDAVVendor');
    }
    
    // 特定坚果云配置
    this.isPaidUser = config.isPaidUser || false;
    // 如果配置中有isPaidUser字段，视为用户已定义
    this.userDefinedAccountType = config.isPaidUser !== undefined;
    
    // 根据用户类型和设置确定请求延迟
    this.requestDelay = this.calculateRequestDelay(config);
    
    this.logger?.info(`坚果云WebDAV提供商初始化完成 (账户类型: ${this.isPaidUser ? '付费用户' : '免费用户'}, 请求延迟: ${this.requestDelay}ms)`);
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
      this.logger?.info(`计算延迟 (付费用户)：无视配置级别 "${config.requestDelay || 'normal'}"，固定使用 ${newDelay}ms`);
    } else {
      // 免费用户基于UI设置应用不同延迟
      if (config.requestDelay) {
        switch(config.requestDelay) {
          case 'slow':
            newDelay = 500;
            this.logger?.info(`计算延迟 (免费用户)：配置级别 "${config.requestDelay}" => ${newDelay}ms`);
            break;
          case 'very-slow':
            newDelay = 1000;
            this.logger?.info(`计算延迟 (免费用户)：配置级别 "${config.requestDelay}" => ${newDelay}ms`);
            break;
          case 'normal':
          default:
            newDelay = 200;
            this.logger?.info(`计算延迟 (免费用户)：配置级别 "${config.requestDelay || 'normal'}" => ${newDelay}ms`);
            break;
        }
      } else {
        // 无延迟设置，使用默认值
        newDelay = 200; // 默认200毫秒
        this.logger?.info(`计算延迟 (免费用户)：无配置级别，使用默认 ${newDelay}ms`);
      }
    }
    
    // 如果与旧值不同，记录变化
    if (oldDelay !== undefined && newDelay !== oldDelay) {
      this.logger?.info(`延迟值已更新: ${oldDelay}ms -> ${newDelay}ms (账户类型: ${this.isPaidUser ? '付费' : '免费'}, 级别: ${config.requestDelay || 'normal'})`);
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
      this.logger?.info('开始连接到坚果云WebDAV服务器...');
      this.status = ConnectionStatus.CONNECTING;
      
      // 检查配置合法性
      if (!this.config || !this.config.username || !this.config.password) {
        this.logger?.error('坚果云WebDAV配置不完整，缺少用户名或密码');
        this.status = ConnectionStatus.ERROR;
        throw new StorageProviderError('坚果云WebDAV配置不完整，请检查用户名和密码', 'CONFIG_ERROR');
      }
      
      if (!this.config.serverUrl || this.config.serverUrl.trim() === '') {
        this.logger?.error('坚果云WebDAV配置不完整，缺少服务器URL');
        this.status = ConnectionStatus.ERROR;
        throw new StorageProviderError('坚果云WebDAV配置不完整，请检查服务器URL', 'CONFIG_ERROR');
      }
      
      // 检查URL是否为坚果云URL
      const url = this.config.serverUrl.toLowerCase().trim();
      if (!url.includes('dav.jianguoyun.com') && !url.includes('jianguoyun') && !url.includes('jgy')) {
        this.logger?.warning('提供的URL可能不是坚果云WebDAV地址');
      }
      
      // 尝试连接
      let success = false;
      let connectAttempts = 0;
      const maxConnectAttempts = 5; // 坚果云适用的最大重试次数
      let retryDelay = 3000; // 初始重试延迟3秒
      
      while (!success && connectAttempts < maxConnectAttempts) {
        try {
          connectAttempts++;
          this.logger?.info(`尝试连接到坚果云 (尝试 ${connectAttempts}/${maxConnectAttempts})...`);
          
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
            this.logger?.info('坚果云WebDAV连接成功');
            success = true;
            this.status = ConnectionStatus.CONNECTED;
            
            // 坚果云特定的连接后处理
            this.verifyAccountType();
          } else {
            this.logger?.warning(`坚果云WebDAV连接返回非成功状态码: ${response.status}`);
            this.status = ConnectionStatus.ERROR;
            throw new StorageProviderError(`连接失败，坚果云服务器返回状态码 ${response.status}`, 'HTTP_ERROR');
          }
        } catch (error) {
          this.logger?.warning(`坚果云WebDAV连接尝试 ${connectAttempts} 失败:`, error);
          
          // 检查特定坚果云错误
          if (error instanceof StorageProviderError) {
            if (error.code === 'AUTH_FAILED') {
              throw new StorageProviderError('坚果云认证失败，请检查用户名和密码，确认使用的是应用密码而非登录密码', 'AUTH_FAILED', error.originalError);
            }
          }
          
          // 增加重试延迟时间
          retryDelay = Math.min(retryDelay * 1.5, 30000); // 最大延迟30秒
          
          if (connectAttempts < maxConnectAttempts) {
            this.logger?.info(`将在 ${retryDelay/1000} 秒后重试连接坚果云...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            this.logger?.error('坚果云WebDAV连接失败，已达到最大重试次数');
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
          this.logger?.info(`账户类型自动检测结果(${newIsPaid ? '付费用户' : '免费用户'})与用户设置(${originalIsPaid ? '付费用户' : '免费用户'})不一致，保留用户设置`);
        } else {
          // 用户未明确设置，自动更新
          this.logger?.info(`账户类型自动检测变更: ${originalIsPaid ? '付费用户' : '免费用户'} -> ${newIsPaid ? '付费用户' : '免费用户'}`);
          this.isPaidUser = newIsPaid;
          
          // 如果配置对象存在，也更新它
          if (this.config) {
            this.config.isPaidUser = newIsPaid;
            
            // 更新请求延迟
            const newDelay = this.calculateRequestDelay(this.config);
            this.logger?.info(`账户类型变更导致延迟更新: ${originalDelay}ms -> ${newDelay}ms`);
            this.requestDelay = newDelay;
          }
        }
      }
      
      // 验证延迟值
      this.verifyRequestDelay();
    } catch (error) {
      this.logger?.warning('无法验证坚果云账户类型:', error);
    }
  }
  
  /**
   * 验证请求延迟设置
   * 确保当前使用的延迟值与配置一致
   */
  private verifyRequestDelay(): boolean {
    try {
      if (!this.config) return false;
      
      const expectedDelay = this.calculateRequestDelay(this.config);
      
      if (this.requestDelay !== expectedDelay) {
        this.logger?.warning(`请求延迟不一致: 当前=${this.requestDelay}ms, 期望=${expectedDelay}ms，正在更新...`);
        this.requestDelay = expectedDelay;
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger?.error('验证请求延迟设置时出错:', error);
      return false;
    }
  }
  
  /**
   * 获取请求延迟级别的描述
   * @param delayMs 延迟毫秒数
   * @param isPaid 是否是付费用户
   * @returns 描述字符串
   */
  private getDelayLevelDescription(delayMs: number, isPaid: boolean): string {
    if (isPaid) {
      return '付费用户模式 (固定较低延迟)';
    } else {
      if (delayMs >= 1000) {
        return '慢速模式 (降低请求频率避免超出API限制)';
      } else if (delayMs >= 500) {
        return '中速模式 (平衡请求速度和API限制)';
      } else {
        return '标准模式 (默认请求频率)';
      }
    }
  }
  
  /**
   * 添加请求延迟
   * 坚果云API有请求频率限制，需要在请求之间添加延迟
   */
  private async addRequestDelay(): Promise<void> {
    if (this.requestDelay && this.requestDelay > 0) {
      const description = this.getDelayLevelDescription(this.requestDelay, this.isPaidUser);
      this.logger?.debug(`添加API请求延迟: ${this.requestDelay}ms (${description})`);
      await new Promise(resolve => setTimeout(resolve, this.requestDelay));
    }
  }
  
  /**
   * 处理坚果云特定的错误
   * @param error 原始错误
   * @returns StorageProviderError
   */
  protected handleError(error: any): StorageProviderError {
    if (error instanceof StorageProviderError) {
      // 已经是处理过的错误，检查是否需要坚果云特定处理
      if (error.code === 'AUTH_FAILED') {
        this.logger?.error('坚果云认证失败，通常需要使用应用密码而非登录密码', error);
        return new StorageProviderError(
          '坚果云认证失败，请确认使用的是应用密码而非登录密码。请前往坚果云网页版->设置->安全->第三方应用管理->添加应用密码。',
          'AUTH_FAILED',
          error.originalError
        );
      } else if (error.code === 'NETWORK_ERROR') {
        this.logger?.error('连接坚果云服务器失败，请检查网络连接或代理设置', error);
      }
      
      return error;
    }
    
    // 调用父类处理通用错误
    return super.handleError(error);
  }
  
  /**
   * 获取针对坚果云优化的请求头
   * @returns 请求头对象
   */
  protected getHeaders(): Record<string, string> {
    this.logger?.debug('使用坚果云优化的请求头');
    return {
      'Authorization': this.getAuthHeader(),
      'Accept': '*/*',
      'Cache-Control': 'no-cache'
    };
  }
  
  /**
   * 上传文件到坚果云
   * @param localPath 本地路径
   * @param remotePath 远程路径
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    // 添加请求延迟
    await this.addRequestDelay();
    
    this.logger?.info(`上传文件到坚果云: ${localPath} -> ${remotePath}`);
    
    try {
      // 调用父类方法上传
      await super.uploadFile(localPath, remotePath);
    } catch (error) {
      this.logger?.error(`上传文件到坚果云失败: ${remotePath}`, error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 创建坚果云文件夹
   * @param path 文件夹路径
   */
  async createFolder(path: string): Promise<void> {
    // 添加请求延迟
    await this.addRequestDelay();
    
    this.logger?.info(`创建坚果云文件夹: ${path}`);
    
    try {
      // 调用父类方法创建文件夹
      await super.createFolder(path);
    } catch (error) {
      this.logger?.error(`创建坚果云文件夹失败: ${path}`, error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 更新请求延迟设置
   * @param delayLevel 延迟级别
   */
  public async updateRequestDelay(delayLevel: RequestDelayLevel): Promise<void> {
    this.logger?.info(`更新坚果云请求延迟级别: ${delayLevel}`);
    
    try {
      // 记录原始延迟值和设置
      const oldDelay = this.requestDelay;
      const oldRequestDelayLevel = this.config?.requestDelay;
      
      // 更新配置
      if (this.config) {
        this.config.requestDelay = delayLevel;
      } else {
        this.logger?.warning('配置对象不存在，仅更新内存中的请求延迟值');
      }
      
      // 计算新的延迟值
      const newDelay = this.calculateRequestDelay(this.config);
      this.requestDelay = newDelay;
      
      // 记录变化情况
      const description = this.getDelayLevelDescription(newDelay, this.isPaidUser);
      
      // 如果值发生变化，记录日志
      if (oldDelay !== newDelay || oldRequestDelayLevel !== delayLevel) {
        this.logger?.info(`坚果云请求延迟已更新: ${oldDelay}ms -> ${newDelay}ms (${description})`);
        if (this.isPaidUser) {
          this.logger?.info('注意: 付费用户模式下，延迟级别设置将被忽略，固定使用低延迟');
        }
      } else {
        this.logger?.info(`坚果云请求延迟保持不变: ${newDelay}ms (${description})`);
      }
    } catch (error) {
      this.logger?.error(`更新坚果云请求延迟设置失败: ${delayLevel}`, error);
      throw error;
    }
  }
  
  /**
   * 更新账户类型设置
   * @param isPaidUser 是否为付费用户
   */
  public async updateAccountType(isPaidUser: boolean): Promise<void> {
    this.logger?.info(`更新坚果云账户类型: ${isPaidUser ? '付费用户' : '免费用户'}`);
    
    try {
      // 记录原始值
      const oldIsPaid = this.isPaidUser;
      const oldDelay = this.requestDelay;
      
      // 更新配置和内存变量
      this.isPaidUser = isPaidUser;
      // 标记为用户明确设置
      this.userDefinedAccountType = true;
      
      if (this.config) {
        this.config.isPaidUser = isPaidUser;
      } else {
        this.logger?.warning('配置对象不存在，仅更新内存中的账户类型');
      }
      
      // 更新请求延迟
      const newDelay = this.calculateRequestDelay(this.config);
      this.requestDelay = newDelay;
      
      // 记录变化情况
      if (oldIsPaid !== isPaidUser) {
        this.logger?.info(`坚果云账户类型已更新: ${oldIsPaid ? '付费用户' : '免费用户'} -> ${isPaidUser ? '付费用户' : '免费用户'}`);
      } else {
        this.logger?.info(`坚果云账户类型保持不变: ${isPaidUser ? '付费用户' : '免费用户'}`);
      }
      
      if (oldDelay !== newDelay) {
        const description = this.getDelayLevelDescription(newDelay, isPaidUser);
        this.logger?.info(`账户类型变更导致请求延迟更新: ${oldDelay}ms -> ${newDelay}ms (${description})`);
      }
    } catch (error) {
      this.logger?.error(`更新坚果云账户类型设置失败: ${isPaidUser}`, error);
      throw error;
    }
  }
} 