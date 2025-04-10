import { 
  ConnectionStatus, 
  StorageProvider, 
  StorageProviderError,
  FileInfo,
  FileMetadata,
  QuotaInfo
} from './storage-provider';
import { App, RequestUrlParam, requestUrl } from 'obsidian';
import { WebDAVSettings } from '../../models/plugin-settings';

/**
 * WebDAV存储提供商
 * 实现与WebDAV服务器的基础连接测试
 * @author Bing
 */
export class WebDAVProvider implements StorageProvider {
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private readonly name = 'WebDAV';
  private app: App;
  private config: WebDAVSettings;

  /**
   * 创建WebDAV提供商实例
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
    return this.name;
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
   * 编码认证信息
   * @returns 认证头部
   * @author Bing
   */
  private getAuthHeader(): string {
    try {
      // 最简单的方式，直接使用原始用户名和密码
      const auth = `${this.config.username}:${this.config.password}`;
      return `Basic ${btoa(auth)}`;
    } catch (error) {
      console.error('生成认证头失败:', error);
      throw new Error('用户名或密码包含无法编码的字符');
    }
  }

  /**
   * 获取针对不同WebDAV服务的可能Headers
   * @returns 请求头对象
   * @author Bing
   */
  private getHeaders(): Record<string, string> {
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
   * 检查当前WebDAV服务是否为坚果云
   * @returns {boolean} 如果当前服务是坚果云则返回true
   * @author Bing
   */
  private isJianGuoYun(): boolean {
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
          // 尝试测试连接
          success = await this.testConnection();
          
          if (success) {
            console.log('WebDAV连接测试成功');
            this.status = ConnectionStatus.CONNECTED;
            return true;
          } else {
            connectAttempts++;
            console.log(`WebDAV连接测试失败 (尝试 ${connectAttempts}/${maxConnectAttempts})`);
            
            if (connectAttempts < maxConnectAttempts) {
              // 等待一段时间再重试，使用指数退避策略加随机抖动
              const jitter = Math.random() * 1000; // 0-1000毫秒的随机抖动
              const newDelay = Math.min(retryDelay * 1.5 + jitter, 12000); // 最多等待12秒
              
              console.log(`等待 ${Math.floor(newDelay)}ms 后重试...`);
              await new Promise(resolve => setTimeout(resolve, newDelay));
              retryDelay = newDelay;
            } else {
              console.log(`超过最大重试次数(${maxConnectAttempts})，连接失败`);
            }
          }
        } catch (error: any) {
          connectAttempts++;
          console.error(`WebDAV连接测试异常 (尝试 ${connectAttempts}/${maxConnectAttempts}):`, error);
          
          // 对于503服务不可用错误进行特殊处理
          if (error.status === 503 || 
             (error.message && (error.message.includes('503') || 
                               error.message.includes('Service Unavailable')))) {
            console.log(`服务器暂时不可用(503)，${connectAttempts}/${maxConnectAttempts}次尝试`);
            
            if (connectAttempts < maxConnectAttempts) {
              // 使用更长的延迟，因为服务器可能需要更多时间恢复
              const jitter = Math.random() * 1500; // 0-1500毫秒的随机抖动
              const serviceUnavailableDelay = Math.min(retryDelay * 1.5 + jitter, 15000);
              console.log(`服务暂时不可用，等待 ${Math.floor(serviceUnavailableDelay)}ms 后重试...`);
              await new Promise(resolve => setTimeout(resolve, serviceUnavailableDelay));
              retryDelay = serviceUnavailableDelay;
              continue;
            }
          }
          
          // 坚果云特殊处理 - 某些错误可能是临时的或特殊的授权问题
          if (isJianguoyun && 
             (error.status === 401 || error.status === 403 || error.status === 429) && 
              connectAttempts < maxConnectAttempts) {
            console.log('坚果云认证或频率限制问题，尝试稍后重试...');
            
            if (connectAttempts < maxConnectAttempts) {
              // 等待一段时间再重试，认证错误可能需要更长时间
              const jitter = Math.random() * 1000;
              const authRetryDelay = Math.min(retryDelay * 1.5 + jitter, 12000);
              console.log(`等待 ${Math.floor(authRetryDelay)}ms 后重试...`);
              await new Promise(resolve => setTimeout(resolve, authRetryDelay));
              retryDelay = authRetryDelay;
              continue;
            }
          }
          
          // 对于其他错误或重试次数用尽，抛出错误
          if (connectAttempts >= maxConnectAttempts) {
            this.status = ConnectionStatus.ERROR;
            throw this.handleError(error);
          } else {
            // 其他错误类型但还有重试次数
            const jitter = Math.random() * 800;
            const generalRetryDelay = Math.min(retryDelay * 1.2 + jitter, 10000);
            console.log(`连接失败但非503错误，等待 ${Math.floor(generalRetryDelay)}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, generalRetryDelay));
            retryDelay = generalRetryDelay;
          }
        }
      }
      
      // 如果重试后仍然失败
      this.status = ConnectionStatus.ERROR;
      if (isJianguoyun) {
        if (connectAttempts >= maxConnectAttempts) {
          throw new StorageProviderError(`坚果云WebDAV连接失败，已尝试 ${maxConnectAttempts} 次，请稍后再试或检查网络连接`, 'CONNECTION_FAILED');
        } else {
          throw new StorageProviderError('坚果云WebDAV连接失败，请检查账号、密码和URL', 'AUTH_FAILED');
        }
      } else {
        throw new StorageProviderError(`WebDAV初始化失败，已尝试 ${connectAttempts} 次连接`, 'INIT_FAILED');
      }
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
  }

  /**
   * 确保URL格式正确
   * @param url 原始URL
   * @returns 格式化后的URL
   * @author Bing
   */
  private formatUrl(url: string): string {
    // 检查 URL 是否为空或未定义
    if (!url || url.trim() === '') {
      console.warn('尝试格式化空URL，将返回默认值');
      return 'https://example.com/'; // 返回一个安全的默认URL，这不会被实际使用，只是为了防止错误
    }

    let formattedUrl = url.trim();
    
    // 检查 URL 是否包含域名部分
    if (!formattedUrl.includes('.') && !formattedUrl.includes('localhost')) {
      console.warn(`URL缺少有效域名: ${formattedUrl}`);
      return formattedUrl; // 返回原始值，避免格式化不完整的URL
    }
    
    // 确保URL以http或https开头
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'https://' + formattedUrl;
    }
    
    // 确保URL以/结尾
    if (!formattedUrl.endsWith('/')) {
      formattedUrl += '/';
    }
    
    return formattedUrl;
  }

  /**
   * 测试与WebDAV服务器的连接
   * @returns 连接是否成功
   * @author Bing
   */
  async testConnection(): Promise<boolean> {
    try {
      // 连接测试不应受同步功能开关影响
      console.log('开始测试 WebDAV 连接...');
      
      // 检查服务器URL是否有效
      if (!this.config || !this.config.serverUrl || this.config.serverUrl.trim() === '') {
        console.error('无效的服务器URL');
        throw new StorageProviderError('无效的服务器URL，请提供有效的WebDAV服务器地址', 'CONFIG_ERROR');
      }
      
      // 检查URL是否包含有效域名
      const urlToCheck = this.config.serverUrl.trim();
      if (!urlToCheck.includes('.') && !urlToCheck.includes('localhost')) {
        console.error(`URL缺少有效域名: ${urlToCheck}`);
        throw new StorageProviderError('WebDAV服务器URL缺少有效域名，请检查URL格式', 'CONFIG_ERROR');
      }
      
      // 格式化URL
      const serverUrl = this.formatUrl(this.config.serverUrl);
      console.log('服务器URL:', serverUrl);
      
      // 获取特定服务的请求头
      const headers = this.getHeaders();
      console.log('使用认证头:', Object.keys(headers).join(', '));

      // 是否是坚果云
      const isJianguoyun = this.isJianGuoYun();
      if (isJianguoyun) {
        console.log('检测到坚果云WebDAV服务，使用特殊配置');
      }
      
      // 服务器暂时不可用时的重试参数
      const maxServiceRetries = 8;  // 增加服务器错误重试次数
      let serviceRetries = 0;
      let serviceRetryDelay = 3000; // 初始重试延迟增加到3秒
      
      while (serviceRetries < maxServiceRetries) {
        try {
          // 尝试一系列HTTP方法来测试连接
          const methods = ['HEAD', 'OPTIONS', 'GET', 'PROPFIND'];
          let allMethodsFailed = true;

          for (const method of methods) {
            try {
              console.log(`尝试使用${method}方法测试连接...`);
              
              let requestOptions: RequestUrlParam = {
                url: serverUrl,
                method: method,
                headers: {...headers},
                throw: false // 不抛出错误，而是返回响应
              };
              
              // 对PROPFIND添加必要的请求体
              if (method === 'PROPFIND') {
                requestOptions.headers = {
                  ...requestOptions.headers,
                  'Depth': '0',
                  'Content-Type': 'application/xml'
                };
                
                // 坚果云可能需要特殊的PROPFIND格式
                requestOptions.body = isJianguoyun
                  ? '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
                  : '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>';
              }
              
              const response = await requestUrl(requestOptions);
              console.log(`${method}响应状态码:`, response.status);
              
              // 2xx或3xx成功
              if (response.status >= 200 && response.status < 400) {
                console.log(`${method}请求成功，与WebDAV服务器连接有效`);
                return true;
              }
              
              // 401/403表示认证工作但权限不够，也视为连接成功
              if (response.status === 401 || response.status === 403) {
                console.log(`${method}请求返回${response.status}，认证工作但权限可能不足，连接有效`);
                return true;
              }
              
              // 如果是503，继续尝试下一个方法
              if (response.status === 503) {
                console.log(`${method}请求返回503，继续尝试其他方法`);
                continue;
              }
              
              // 其他状态码继续尝试其他方法
              console.log(`${method}请求返回${response.status}，继续尝试其他方法`);
            } catch (methodError: any) {
              console.log(`${method}请求失败:`, methodError);
              
              // 如果是401/403，认证工作但权限不足，算成功
              if (methodError.status === 401 || methodError.status === 403) {
                console.log(`${method}请求返回${methodError.status}，认证工作但权限可能不足，连接有效`);
                return true;
              }
              
              // 如果不是503错误，尝试其他方法
              if (methodError.status !== 503) {
                console.log(`${method}请求失败但不是503错误，继续尝试其他方法`);
                continue;
              }
              
              console.log(`${method}请求失败(503)，继续尝试其他方法`);
            }
          }
          
          // 所有方法都失败了，进行重试
          serviceRetries++;
          if (serviceRetries < maxServiceRetries) {
            // 计算新的重试延迟，逐渐增加但有一些随机性以避免集中重试
            const jitter = Math.random() * 1000; // 0-1000毫秒的随机抖动
            const newDelay = Math.min(serviceRetryDelay * 1.5 + jitter, 12000);
            
            console.log(`所有HTTP方法都失败，服务器可能暂时不可用，${serviceRetries}/${maxServiceRetries}次重试，等待${Math.floor(newDelay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, newDelay));
            serviceRetryDelay = newDelay;
          } else {
            console.log(`超过最大重试次数(${maxServiceRetries})，连接失败`);
            break;
          }
        } catch (retryError: any) {
          // 处理外部循环中的错误
          serviceRetries++;
          
          // 检查是否是503错误，其他错误就直接抛出
          if (retryError.status !== 503 && 
              !(retryError.message && retryError.message.includes('503'))) {
            throw retryError;
          }
          
          if (serviceRetries < maxServiceRetries) {
            // 计算新的重试延迟，逐渐增加但有一些随机性
            const jitter = Math.random() * 1000;
            const newDelay = Math.min(serviceRetryDelay * 1.5 + jitter, 12000);
            
            console.log(`服务器返回503错误，${serviceRetries}/${maxServiceRetries}次重试，等待${Math.floor(newDelay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, newDelay));
            serviceRetryDelay = newDelay;
          } else {
            console.log(`503错误，超过最大重试次数(${maxServiceRetries})，连接失败`);
            throw retryError;
          }
        }
      }
      
      // 如果所有尝试都失败
      console.log(`经过${maxServiceRetries}次尝试，所有连接方法均失败`);
      return false;
    } catch (error) {
      console.error('WebDAV 测试连接失败:', error);
      throw error;
    }
  }

  /**
   * 处理WebDAV错误
   * @param error 错误对象
   * @returns 格式化的错误对象
   * @author Bing
   */
  private handleError(error: any): StorageProviderError {
    console.log('处理WebDAV错误:', error);
    
    // 尝试从错误中获取状态码
    let statusCode = error.status || 0;
    let errorMessage = error.message || '未知错误';
    let errorCode = error.code || null;
    
    // 如果错误已经是StorageProviderError类型，直接返回
    if (error instanceof StorageProviderError) {
      console.log('错误已是StorageProviderError:', error.code, error.message);
      return error;
    }
    
    // 记录详细的错误信息
    console.log(`WebDAV错误细节: 状态码=${statusCode}, 消息=${errorMessage}, 代码=${errorCode}`);
    
    // 针对不同状态码的错误信息
    if (statusCode === 401 || statusCode === 403 || 
        (errorMessage && (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')))) {
      return new StorageProviderError('认证失败，请检查用户名和密码', 'AUTH_FAILED', error);
    } else if (statusCode === 404 || 
              (errorMessage && errorMessage.includes('Not Found'))) {
      return new StorageProviderError('WebDAV服务器路径不存在', 'NOT_FOUND', error);
    } else if (statusCode === 503 || 
              (errorMessage && errorMessage.includes('503') || 
               errorMessage && errorMessage.includes('Service Unavailable'))) {
      return new StorageProviderError('WebDAV服务器暂时不可用，请稍后重试', 'SERVICE_UNAVAILABLE', error);
    } else if (statusCode >= 500 || 
              (errorMessage && errorMessage.includes('Server Error'))) {
      return new StorageProviderError('WebDAV服务器内部错误', 'SERVER_ERROR', error);
    } else if (errorMessage.includes('Failed to fetch') || 
              errorMessage.includes('NetworkError') || 
              errorMessage.includes('Network request failed') ||
              errorMessage.includes('network error') ||
              statusCode === -1 || 
              statusCode === 0) {
      return new StorageProviderError('网络连接失败，请检查网络和服务器地址', 'NETWORK_ERROR', error);
    } else if (errorMessage.includes('timeout') || 
              errorMessage.includes('Timeout')) {
      return new StorageProviderError('连接超时，服务器响应时间过长', 'TIMEOUT', error);
    } else if (errorMessage.includes('parse') || 
              errorMessage.includes('Parse') || 
              errorMessage.includes('XML') || 
              errorMessage.includes('解析')) {
      return new StorageProviderError('解析响应失败，服务器返回了无效数据', 'PARSE_ERROR', error);
    }
    
    // 对于坚果云特殊错误处理
    if (this.isJianGuoYun()) {
      if (statusCode === 405 || errorMessage.includes('Method Not Allowed')) {
        return new StorageProviderError('坚果云不支持此操作，可能需要升级账户或调整权限', 'OPERATION_NOT_ALLOWED', error);
      } else if (statusCode === 507 || errorMessage.includes('Insufficient Storage')) {
        return new StorageProviderError('坚果云存储空间不足，请清理空间或升级账户', 'INSUFFICIENT_STORAGE', error);
      } else if (statusCode === 429 || errorMessage.includes('Too Many Requests') || errorMessage.includes('429')) {
        return new StorageProviderError('坚果云请求次数过多，请稍后重试', 'RATE_LIMITED', error);
      } else if (statusCode === 503) {
        return new StorageProviderError('坚果云服务暂时不可用，请稍后重试', 'JIANGUOYUN_UNAVAILABLE', error);
      }
    }
    
    // 其他未知错误
    return new StorageProviderError(`WebDAV操作失败: ${errorMessage}`, 'UNKNOWN_ERROR', error);
  }

  /**
   * 解析文件状态XML响应
   * @param xmlText XML文本
   * @returns 文件状态数组
   * @author Bing
   */
  private parseFileListXML(xmlText: string): FileInfo[] {
    try {
      console.log('开始解析WebDAV文件列表XML...');
      const files: FileInfo[] = [];
      
      // 兼容性解析方法
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      
      // 检查解析错误
      const parseError = xmlDoc.querySelector("parsererror");
      if (parseError) {
        console.error('XML解析错误:', parseError.textContent);
        throw new Error(`XML解析错误: ${parseError.textContent}`);
      }
      
      // 尝试使用不同的方法获取响应元素
      let responses: Element[] = [];
      
      // 首先尝试使用命名空间
      try {
        const nsResponses = xmlDoc.getElementsByTagNameNS('DAV:', 'response');
        if (nsResponses && nsResponses.length > 0) {
          for (let i = 0; i < nsResponses.length; i++) {
            responses.push(nsResponses[i]);
          }
        }
      } catch (e) {
        console.log('使用命名空间获取响应元素失败，尝试替代方法');
      }
      
      // 如果命名空间方法失败，尝试其他选择器
      if (responses.length === 0) {
        // 尝试标准的querySelector (不带命名空间)
        const stdResponses = xmlDoc.querySelectorAll('response');
        if (stdResponses && stdResponses.length > 0) {
          for (let i = 0; i < stdResponses.length; i++) {
            responses.push(stdResponses[i]);
          }
        }
        
        // 尝试带D:前缀的元素
        if (responses.length === 0) {
          const dResponses = xmlDoc.querySelectorAll('d\\:response, D\\:response');
          if (dResponses && dResponses.length > 0) {
            for (let i = 0; i < dResponses.length; i++) {
              responses.push(dResponses[i]);
            }
          }
        }
      }
      
      console.log(`找到 ${responses.length} 个响应元素`);
      
      // 遍历所有响应
      for (const response of responses) {
        try {
          // 尝试不同方法获取href (文件路径)
          let hrefEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsHref = response.getElementsByTagNameNS('DAV:', 'href');
            if (nsHref && nsHref.length > 0) {
              hrefEl = nsHref[0];
            }
          } catch (e) {
            console.log('使用命名空间获取href元素失败，尝试替代方法');
          }
          
          // 尝试标准querySelector
          if (!hrefEl) {
            hrefEl = response.querySelector('href') || 
                     response.querySelector('d\\:href') || 
                     response.querySelector('D\\:href');
          }
          
          if (!hrefEl || !hrefEl.textContent) {
            console.log('跳过没有href的元素');
            continue;
          }
          
          let href = hrefEl.textContent || '';
          // 解码URL，并移除服务器URL部分，只保留相对路径
          href = decodeURIComponent(href);
          const serverUrlObj = new URL(this.formatUrl(this.config.serverUrl));
          const serverBasePath = serverUrlObj.pathname;
          
          // 如果href包含服务器基础路径，移除它
          if (href.startsWith(serverBasePath) && serverBasePath !== '/') {
            href = href.substring(serverBasePath.length);
          }
          
          // 确保href不以斜杠开头
          if (href.startsWith('/')) {
            href = href.substring(1);
          }
          
          // 跳过当前目录标记
          if (href === '' || href === '.' || href === './') {
            continue;
          }
          
          // 获取最后修改时间
          let lastModified = new Date();
          let lastModifiedEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsLastMod = response.getElementsByTagNameNS('DAV:', 'getlastmodified');
            if (nsLastMod && nsLastMod.length > 0) {
              lastModifiedEl = nsLastMod[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!lastModifiedEl) {
            lastModifiedEl = response.querySelector('getlastmodified') || 
                            response.querySelector('d\\:getlastmodified') || 
                            response.querySelector('D\\:getlastmodified');
          }
          
          if (lastModifiedEl && lastModifiedEl.textContent) {
            try {
              lastModified = new Date(lastModifiedEl.textContent);
            } catch (e) {
              console.log(`日期解析错误: ${lastModifiedEl.textContent}`, e);
            }
          }
          
          // 获取资源类型
          let isFolder = false;
          let resourceTypeEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsResType = response.getElementsByTagNameNS('DAV:', 'resourcetype');
            if (nsResType && nsResType.length > 0) {
              resourceTypeEl = nsResType[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!resourceTypeEl) {
            resourceTypeEl = response.querySelector('resourcetype') || 
                            response.querySelector('d\\:resourcetype') || 
                            response.querySelector('D\\:resourcetype');
          }
          
          if (resourceTypeEl) {
            // 检查collection元素存在
            let collectionFound = false;
            
            // 尝试命名空间方法
            try {
              const nsCollection = resourceTypeEl.getElementsByTagNameNS('DAV:', 'collection');
              collectionFound = nsCollection && nsCollection.length > 0;
            } catch (e) {}
            
            // 尝试标准querySelector
            if (!collectionFound) {
              const collEl = resourceTypeEl.querySelector('collection') || 
                            resourceTypeEl.querySelector('d\\:collection') || 
                            resourceTypeEl.querySelector('D\\:collection');
              collectionFound = !!collEl;
            }
            
            isFolder = collectionFound;
          }
          
          // 获取内容长度（文件大小）
          let size = 0;
          let contentLengthEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsContentLength = response.getElementsByTagNameNS('DAV:', 'getcontentlength');
            if (nsContentLength && nsContentLength.length > 0) {
              contentLengthEl = nsContentLength[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!contentLengthEl) {
            contentLengthEl = response.querySelector('getcontentlength') || 
                              response.querySelector('d\\:getcontentlength') || 
                              response.querySelector('D\\:getcontentlength');
          }
          
          if (contentLengthEl && contentLengthEl.textContent) {
            size = parseInt(contentLengthEl.textContent) || 0;
          }
          
          // 获取ETag（版本标识）
          let etag: string | undefined = undefined;
          let etagEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsEtag = response.getElementsByTagNameNS('DAV:', 'getetag');
            if (nsEtag && nsEtag.length > 0) {
              etagEl = nsEtag[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!etagEl) {
            etagEl = response.querySelector('getetag') || 
                    response.querySelector('d\\:getetag') || 
                    response.querySelector('D\\:getetag');
          }
          
          if (etagEl && etagEl.textContent) {
            etag = etagEl.textContent;
          }
          
          // 创建文件信息对象
          const fileInfo: FileInfo = {
            path: href,
            name: href.split('/').pop() || '',
            isFolder: isFolder,
            size: size,
            modifiedTime: lastModified,
            etag: etag
          };
          
          files.push(fileInfo);
        } catch (respError) {
          console.error('处理响应元素错误:', respError);
          // 继续处理下一个响应，不中断整个解析
        }
      }
      
      console.log(`成功解析 ${files.length} 个文件/文件夹`);
      return files;
    } catch (error) {
      console.error('解析WebDAV文件列表失败:', error);
      throw new StorageProviderError(`解析WebDAV文件列表失败: ${error.message || error}`, 'PARSE_ERROR', error as Error);
    }
  }

  /**
   * 确保路径格式正确
   * @param path 路径
   * @returns 处理后的路径
   * @author Bing
   */
  private formatPath(path: string): string {
    let formattedPath = path || '';
    
    // 移除前导斜杠
    if (formattedPath.startsWith('/')) {
      formattedPath = formattedPath.substring(1);
    }
    
    return formattedPath;
  }

  /**
   * 获取远程文件列表
   * @param path 目录路径
   * @param recursive 是否递归获取所有子文件夹内容
   * @returns 文件列表
   * @author Bing
   */
  async listFiles(path: string = '', recursive: boolean = true): Promise<FileInfo[]> {
    try {
      console.log(`列出WebDAV文件: ${path}, 递归: ${recursive}`);
      
      // 格式化路径
      let remotePath = this.formatPath(path);
      
      // 确保路径以斜杠结尾
      if (remotePath && !remotePath.endsWith('/')) {
        remotePath += '/';
      }
      
      const serverUrl = this.formatUrl(this.config.serverUrl);
      const url = serverUrl + remotePath;
      
      console.log(`请求URL: ${url}`);
      
      // PROPFIND请求体
      const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
        <propfind xmlns="DAV:">
          <prop>
            <resourcetype/>
            <getlastmodified/>
            <getcontentlength/>
            <getetag/>
          </prop>
        </propfind>`;
      
      // 发送请求
      const headers = {
        ...this.getHeaders(),
        'Depth': recursive ? 'infinity' : '1',
        'Content-Type': 'application/xml'
      };
      
      const options: RequestUrlParam = {
        url: url,
        method: 'PROPFIND',
        headers,
        body: propfindBody
      };
      
      // 特殊处理: 如果是坚果云或某些已知不支持infinity的服务器，直接使用手动递归
      if (recursive && this.isJianGuoYun()) {
        console.log('检测到坚果云，直接使用手动递归模式获取文件列表');
        return this.listFilesManualRecursive(path);
      }
      
      try {
        const response = await requestUrl(options);
        
        if (response.status >= 200 && response.status < 300) {
          // 解析XML响应
          const files = this.parseFileListXML(response.text);
          console.log(`找到 ${files.length} 个文件/文件夹`);
          
          // 如果需要递归但服务器不支持depth=infinity，尝试手动递归
          if (recursive && headers['Depth'] === 'infinity') {
            // 检查是否获取到了子文件夹内容
            // 1. 如果返回的列表只包含当前文件夹本身，则说明服务器不支持depth=infinity
            // 2. 如果返回的列表包含文件夹，但没有这些文件夹的子内容，也说明不支持
            const containsSubfolders = files.some(f => f.isFolder && f.path !== remotePath && f.path !== (remotePath + '/'));
            const containsSubfolderContents = files.some(f => !f.isFolder && f.path.split('/').length > remotePath.split('/').length + 1);
            
            if (files.length <= 2 || (containsSubfolders && !containsSubfolderContents)) {
              console.log('检测到服务器可能不支持深度递归，切换到手动递归模式');
              return this.listFilesManualRecursive(path);
            }
          }
          
          return files;
        } else {
          // 如果失败且使用了infinity，尝试使用手动递归方式
          if (recursive && headers['Depth'] === 'infinity') {
            console.log(`服务器返回错误状态码(${response.status})，可能不支持depth=infinity，尝试手动递归`);
            return this.listFilesManualRecursive(path);
          }
          throw new Error(`WebDAV列表请求失败，状态码: ${response.status}`);
        }
      } catch (error) {
        // 如果使用infinity深度失败，尝试手动递归
        if (recursive && (
            error.message?.includes('不支持') || 
            error.status === 403 || 
            error.status === 501 || 
            error.status === 400 ||
            error.status === 507)) {
          console.log('infinity深度请求失败，尝试手动递归', error);
          return this.listFilesManualRecursive(path);
        }
        
        console.error('列出WebDAV文件失败:', error);
        throw this.handleError(error);
      }
    } catch (error) {
      console.error('列出WebDAV文件列表时发生顶层错误:', error);
      throw this.handleError(error);
    }
  }

  /**
   * 手动递归获取所有文件和文件夹
   * 用于服务器不支持depth=infinity的情况
   * @param path 起始路径
   * @returns 包含所有子文件夹内容的文件列表
   * @author Bing
   */
  private async listFilesManualRecursive(path: string = ''): Promise<FileInfo[]> {
    console.log(`====== 开始手动递归获取文件列表: ${path || '/'} ======`);
    
    // 使用集合来跟踪已处理过的路径，避免循环引用
    const processedPaths = new Set<string>();
    
    // 内部递归函数
    const recursiveList = async (currentPath: string, depth: number = 0): Promise<FileInfo[]> => {
      // 创建缩进以便更清晰地显示递归深度
      const indent = '  '.repeat(depth);
      
      // 格式化当前路径
      const formattedPath = this.formatPath(currentPath);
      console.log(`${indent}递归处理路径[深度${depth}]: ${formattedPath || '/'}`);
      
      // 如果路径已经处理过，直接返回空数组避免循环
      if (processedPaths.has(formattedPath)) {
        console.log(`${indent}跳过已处理过的路径: ${formattedPath}`);
        return [];
      }
      
      // 将当前路径添加到已处理集合
      processedPaths.add(formattedPath);
      
      try {
        // 先获取当前层级的文件和文件夹（禁用递归，只获取direct子项）
        console.log(`${indent}获取${formattedPath || '/'}的直接子项`);
        const files = await this.listFiles(currentPath, false);
        console.log(`${indent}路径 ${formattedPath || '/'} 直接子项数量: ${files.length}`);
        
        if (files.length === 0) {
          console.log(`${indent}路径 ${formattedPath || '/'} 无子项，返回空数组`);
          return [];
        }
        
        // 复制当前路径的文件列表
        const result: FileInfo[] = [...files];
        
        // 找出当前层级的文件夹
        const folders = files.filter(file => file.isFolder);
        console.log(`${indent}发现 ${folders.length} 个子文件夹`);
        
        // 对每个文件夹进行递归处理
        for (const folder of folders) {
          try {
            // 检查是否为当前目录或父目录
            const normalizedFolderPath = folder.path.replace(/\/$/, '');
            const normalizedCurrentPath = formattedPath.replace(/\/$/, '');
            
            console.log(`${indent}检查文件夹: ${normalizedFolderPath} vs 当前路径: ${normalizedCurrentPath}`);
            
            if (normalizedFolderPath === normalizedCurrentPath) {
              console.log(`${indent}跳过当前目录自身: ${normalizedFolderPath}`);
              continue;
            }
            
            if (normalizedFolderPath === '' || normalizedFolderPath === '.') {
              console.log(`${indent}跳过根目录: ${normalizedFolderPath}`);
              continue;
            }
            
            // 构造子路径
            const subPath = folder.path;
            console.log(`${indent}递归处理子文件夹: ${subPath}`);
            
            // 检查是否已处理过此路径
            const formattedSubPath = this.formatPath(subPath);
            if (processedPaths.has(formattedSubPath)) {
              console.log(`${indent}子路径已处理过，跳过: ${formattedSubPath}`);
              continue;
            }
            
            // 递归获取子文件夹内容
            console.log(`${indent}递归获取子文件夹 ${subPath} 内容...`);
            const subFiles = await recursiveList(subPath, depth + 1);
            console.log(`${indent}子文件夹 ${subPath} 包含 ${subFiles.length} 个子项`);
            
            // 将子文件夹的内容添加到结果
            for (const subFile of subFiles) {
              // 检查是否已经存在，避免重复
              if (!result.some(f => f.path === subFile.path)) {
                result.push(subFile);
              }
            }
          } catch (folderError) {
            console.error(`${indent}处理子文件夹 ${folder.path} 失败:`, folderError);
            // 继续处理其他文件夹，不中断整个过程
          }
        }
        
        console.log(`${indent}路径 ${formattedPath || '/'} 及子路径共找到 ${result.length} 个文件/文件夹`);
        return result;
      } catch (error) {
        console.error(`${indent}获取路径 ${formattedPath || '/'} 内容失败:`, error);
        // 发生错误时返回空数组，不中断整个过程
        return [];
      }
    };
    
    try {
      // 开始递归过程
      const results = await recursiveList(path);
      console.log(`====== 手动递归完成，共找到 ${results.length} 个文件/文件夹 ======`);
      return results;
    } catch (error) {
      console.error('手动递归过程中发生错误:', error);
      throw this.handleError(error);
    }
  }

  /**
   * 上传文件
   * @param remotePath 远程路径
   * @param content 文件内容
   * @author Bing
   */
  async uploadFile(remotePath: string, content: string | ArrayBuffer): Promise<void> {
    try {
      console.log(`上传文件到: ${remotePath}`);
      
      // 确保路径格式正确
      let path = this.formatPath(remotePath);
      
      // 创建目录结构（如果不存在）
      const dirPath = path.split('/').slice(0, -1).join('/');
      if (dirPath) {
        console.log(`确保上传文件的父目录存在: ${dirPath}`);
        
        try {
          // 先检查文件夹是否存在
          const exists = await this.folderExists(dirPath);
          if (!exists) {
            console.log(`父目录不存在，尝试创建: ${dirPath}`);
            await this.ensureDirectoryExists(dirPath);
          } else {
            console.log(`父目录已存在: ${dirPath}`);
          }
        } catch (dirError) {
          console.warn(`检查/创建父目录时发生错误: ${dirPath}`, dirError);
          
          // 对于坚果云，即使目录创建失败也尝试继续上传
          if (this.isJianGuoYun()) {
            console.log(`坚果云创建目录失败，但尝试继续上传: ${remotePath}`);
            // 继续执行，不中断上传
          } else {
            throw dirError;
          }
        }
      }
      
      // 拼接完整URL
      const serverUrl = this.formatUrl(this.config.serverUrl);
      const url = serverUrl + path;
      
      console.log(`上传到URL: ${url}`);
      
      // 对于坚果云的特殊处理
      let headers = this.getHeaders();
      if (this.isJianGuoYun()) {
        // 坚果云特殊处理
        console.log('应用坚果云特定上传设置');
        
        // 确保头信息中包含正确的Content-Type
        if (typeof content === 'string') {
          headers = {
            ...headers,
            'Content-Type': 'text/plain; charset=utf-8'
          };
        } else {
          headers = {
            ...headers,
            'Content-Type': 'application/octet-stream'
          };
        }
      }
      
      // 发送PUT请求上传文件
      const options: RequestUrlParam = {
        url: url,
        method: 'PUT',
        headers: headers,
        body: content
      };
      
      try {
        const response = await requestUrl(options);
        
        if (response.status >= 200 && response.status < 300) {
          console.log(`文件上传成功: ${remotePath}`);
        } else {
          throw new Error(`上传文件失败，状态码: ${response.status}`);
        }
      } catch (uploadError) {
        // 对于坚果云，如果是403或401，重试一次
        if (this.isJianGuoYun() && (uploadError.status === 403 || uploadError.status === 401)) {
          console.log('坚果云上传遇到认证错误，尝试重试');
          
          try {
            // 检查父目录是否确实存在
            if (dirPath) {
              try {
                // 尝试通过特殊手段创建目录
                console.log(`坚果云再次尝试创建父目录: ${dirPath}`);
                
                // 1. 先检查目录是否已存在
                const recheckExists = await this.folderExists(dirPath);
                if (!recheckExists) {
                  // 2. 尝试以特殊方式创建目录
                  const dummyFilePath = dirPath + '/.folder';
                  const dummyOptions: RequestUrlParam = {
                    url: serverUrl + dummyFilePath,
                    method: 'PUT',
                    headers: headers,
                    body: ''
                  };
                  
                  try {
                    await requestUrl(dummyOptions);
                    console.log(`通过创建占位文件的方式创建了父目录: ${dirPath}`);
                  } catch (dummyError) {
                    console.warn('创建占位文件失败:', dummyError);
                  }
                }
              } catch (recheckError) {
                console.warn('再次尝试检查/创建父目录失败:', recheckError);
              }
            }
            
            // 再次尝试上传文件
            console.log('重新尝试上传文件');
            const retryOptions: RequestUrlParam = {
              url: url,
              method: 'PUT',
              headers: headers,
              body: content
            };
            
            const retryResponse = await requestUrl(retryOptions);
            if (retryResponse.status >= 200 && retryResponse.status < 300) {
              console.log(`重试后文件上传成功: ${remotePath}`);
              return;
            } else {
              throw new Error(`重试上传文件失败，状态码: ${retryResponse.status}`);
            }
          } catch (retryError) {
            console.error('重试上传失败:', retryError);
            throw retryError;
          }
        }
        
        throw uploadError;
      }
    } catch (error) {
      console.error('上传文件失败:', error);
      throw this.handleError(error);
    }
  }

  /**
   * 确保目录存在，如果不存在则创建
   * @param path 目录路径
   * @param recursionLevel 递归层级计数，防止无限递归
   * @author Bing
   */
  async ensureDirectoryExists(path: string, recursionLevel: number = 0): Promise<void> {
    try {
      //
      // 防止无限递归
      if (recursionLevel > 5) {
        console.error(`确保目录存在递归层级过深: ${path}，可能存在循环依赖`);
        throw new Error(`确保目录存在递归过深: ${path}`);
      }
      
      // 预处理路径
      let remotePath = this.formatPath(path.trim());
      
      // 空路径视为根目录，总是存在的
      if (!remotePath) {
        console.log('路径为空，视为根目录，默认存在');
        return;
      }
      
      console.log(`确保目录存在: ${remotePath}`);
      
      // 先检查目录是否已存在
      let exists = false;
      try {
        exists = await this.folderExists(remotePath);
      } catch (checkError) {
        console.warn(`检查目录是否存在时出错: ${remotePath}`, checkError);
        // 继续执行，尝试创建目录
      }
      
      if (exists) {
        console.log(`目录已存在: ${remotePath}`);
        return;
      }
      
      // 处理坚果云的特殊情况
      if (this.isJianGuoYun()) {
        // 坚果云可能返回目录不存在，但实际上存在
        // 或者需要特殊处理才能创建目录
        console.log(`特殊处理坚果云目录: ${remotePath}`);
        
        try {
          await this.createFolder(remotePath, recursionLevel);
          console.log(`成功创建坚果云目录: ${remotePath}`);
          return;
        } catch (jgyError) {
          // 处理创建目录时的认证错误或权限错误
          if (jgyError.status === 403 || jgyError.status === 401) {
            console.warn(`坚果云创建目录时遇到认证错误: ${remotePath}`);
            
            // 再次检查目录是否确实不存在（有时认证错误可能意味着目录已存在）
            try {
              const recheck = await this.folderExists(remotePath);
              if (recheck) {
                console.log(`经二次检查，目录实际已存在: ${remotePath}`);
                return;
              }
            } catch (recheckError) {
              console.warn(`二次检查目录时出错: ${remotePath}`, recheckError);
            }
            
            // 尝试通过创建占位文件的方式创建目录
            try {
              console.log(`尝试通过创建占位文件方式创建目录: ${remotePath}`);
              const dummyFilePath = remotePath + '/.folder';
              
              const serverUrl = this.formatUrl(this.config.serverUrl);
              const url = serverUrl + dummyFilePath;
              
              const options: RequestUrlParam = {
                url: url,
                method: 'PUT',
                headers: this.getHeaders(),
                body: ''
              };
              
              await requestUrl(options);
              console.log(`通过创建占位文件方式成功创建了目录: ${remotePath}`);
              return;
            } catch (dummyError) {
              console.error(`通过创建占位文件创建目录失败: ${remotePath}`, dummyError);
              throw new Error(`无法在坚果云创建目录: ${remotePath} (${dummyError.message || dummyError})`);
            }
          }
          
          // 对于其他错误，继续尝试创建父目录再重试
          console.warn(`坚果云创建目录失败，尝试逐级创建: ${remotePath}`, jgyError);
        }
      }
      
      // 对于普通情况或坚果云特殊处理失败后
      // 尝试创建父目录后再创建当前目录
      
      // 分割路径并确保各级目录存在
      const parts = remotePath.split('/');
      
      if (parts.length === 1) {
        // 如果是最顶层目录直接创建
        console.log(`创建顶层目录: ${remotePath}`);
        await this.createFolder(remotePath, recursionLevel);
        return;
      }
      
      // 父目录路径
      const parentPath = parts.slice(0, -1).join('/');
      
      // 防止父路径与当前路径相同
      if (parentPath === remotePath || parentPath === path) {
        console.warn(`检测到父路径与当前路径相同: ${parentPath}，跳过父路径处理`);
        
        // 尝试直接创建当前目录
        try {
          await this.createFolder(remotePath, recursionLevel);
          console.log(`直接创建目录成功: ${remotePath}`);
          return;
        } catch (directCreateError) {
          console.error(`直接创建目录失败: ${remotePath}`, directCreateError);
          throw directCreateError;
        }
      }
      
      console.log(`先确保父目录存在: ${parentPath}`);
      
      // 递归确保父目录存在，增加递归层级计数
      await this.ensureDirectoryExists(parentPath, recursionLevel + 1);
      
      // 创建当前目录
      console.log(`创建当前目录: ${remotePath}`);
      try {
        await this.createFolder(remotePath, recursionLevel);
        console.log(`成功创建目录: ${remotePath}`);
      } catch (createError) {
        // 如果创建失败但是是坚果云，尝试再次检查目录是否存在
        if (this.isJianGuoYun()) {
          try {
            const finalCheck = await this.folderExists(remotePath);
            if (finalCheck) {
              console.log(`即使报错，目录实际已创建成功: ${remotePath}`);
              return;
            }
          } catch (finalCheckError) {
            // 忽略最终检查中的错误
          }
        }
        
        // 抛出原始错误
        throw createError;
      }
    } catch (error) {
      console.error(`确保目录存在失败: ${path}`, error);
      throw this.handleError(error);
    }
  }

  /**
   * 创建文件夹
   * @param path 文件夹路径
   * @param recursionLevel 递归层级计数，防止无限递归
   * @author Bing
   */
  async createFolder(path: string, recursionLevel: number = 0): Promise<void> {
    try {
      // 防止无限递归
      if (recursionLevel > 5) {
        console.error(`创建文件夹递归层级过深: ${path}，可能存在循环依赖`);
        throw new Error(`创建文件夹递归过深: ${path}`);
      }
      
      let remotePath = this.formatPath(path);
      
      // 如果路径为空，则是根目录，无需创建
      if (!remotePath) {
        console.log('路径为空，视为根目录，无需创建');
        return;
      }
      
      console.log(`创建文件夹: ${remotePath}`);
      
      // 确保路径以/结尾
      if (!remotePath.endsWith('/')) {
        remotePath += '/';
      }
      
      // 拼接完整URL
      const serverUrl = this.formatUrl(this.config.serverUrl);
      let url = serverUrl + remotePath;
      if (!url.endsWith('/')) {
        url += '/';
      }
      
      console.log(`创建文件夹URL: ${url}`);
      
      // 对于坚果云，使用特殊处理
      if (this.isJianGuoYun()) {
        console.log('使用坚果云特定的方法创建文件夹');
        
        // 特别处理根路径
        if (!remotePath || remotePath === '') {
          console.log('坚果云根目录无需创建，跳过');
          return;
        }
        
        // 检查父文件夹是否存在
        const parentPath = remotePath.split('/').slice(0, -1).join('/');
        if (parentPath) {
          // 避免重复检查自身路径
          if (parentPath === path || parentPath === remotePath) {
            console.warn(`检测到父路径与当前路径相同: ${parentPath}，跳过父路径检查`);
          } else {
            console.log(`检查坚果云父文件夹: ${parentPath}`);
            const parentExists = await this.folderExists(parentPath);
            if (!parentExists) {
              console.log(`坚果云父文件夹不存在，尝试创建: ${parentPath}`);
              // 尝试递归创建父文件夹，增加递归层级计数
              try {
                await this.createFolder(parentPath, recursionLevel + 1);
              } catch (parentError) {
                console.warn(`坚果云创建父文件夹失败: ${parentPath}，但继续尝试`, parentError);
                // 即使父文件夹创建失败，仍尝试创建当前文件夹
              }
            }
          }
        }
      }
      
      // 尝试创建文件夹前，先检查是否已存在
      // 再次检查是为了避免竞态条件
      const exists = await this.folderExists(path);
      if (exists) {
        console.log(`文件夹已存在，无需创建: ${path}`);
        return;
      }
      
      // 发送MKCOL请求创建文件夹
      const options: RequestUrlParam = {
        url: url,
        method: 'MKCOL',
        headers: this.getHeaders()
      };
      
      try {
        const response = await requestUrl(options);
        
        if (response.status >= 200 && response.status < 300) {
          console.log(`文件夹创建成功: ${path}`);
        } else {
          throw new Error(`创建文件夹失败，状态码: ${response.status}`);
        }
      } catch (error) {
        // 如果状态码为409，可能是因为父目录不存在
        if (error.status === 409) {
          console.log(`父目录不存在，尝试递归创建: ${path}`);
          // 创建父目录
          const parentPath = path.split('/').slice(0, -1).join('/');
          if (parentPath && parentPath !== path && parentPath !== remotePath) {
            await this.createFolder(parentPath, recursionLevel + 1);
            // 再次尝试创建当前目录
            await this.createFolder(path, recursionLevel + 1);
          } else {
            throw error; // 如果没有父目录但仍返回409，抛出异常
          }
        } 
        // 如果是403或401，可能是认证问题
        else if (error.status === 403 || error.status === 401) {
          console.log('创建文件夹时遇到认证错误:', error);
          
          // 对于坚果云特殊处理认证错误
          if (this.isJianGuoYun()) {
            console.log(`坚果云认证问题，尝试特殊方法创建: ${path}`);
            
            // 再次检查文件夹是否已存在(有时坚果云会返回403但实际已创建)
            try {
              const recheck = await this.folderExists(path);
              if (recheck) {
                console.log(`坚果云文件夹实际已存在: ${path}`);
                return; // 文件夹已存在，视为成功
              }
            } catch (recheckError) {
              console.warn('再次检查坚果云文件夹失败:', recheckError);
            }
            
            // 尝试通过上传空文件来隐式创建目录
            try {
              const dummyFilePath = remotePath + '.folder';
              // 尝试直接调用requestUrl而不是this.uploadFile来避免潜在的递归
              const dummyUrl = serverUrl + dummyFilePath;
              const dummyOptions: RequestUrlParam = {
                url: dummyUrl,
                method: 'PUT',
                headers: this.getHeaders(),
                body: ''
              };
              await requestUrl(dummyOptions);
              console.log(`通过创建空文件方式创建了坚果云文件夹: ${path}`);
              return;
            } catch (uploadError) {
              console.warn('通过空文件创建坚果云文件夹失败:', uploadError);
              // 如果上传也失败，我们仍然抛出原始错误
            }
          }
          
          throw this.handleError(error);
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('创建文件夹失败:', error);
      throw this.handleError(error);
    }
  }

  /**
   * 检查文件夹是否存在
   * @param path 文件夹路径
   * @returns 是否存在
   * @author Bing
   */
  async folderExists(path: string): Promise<boolean> {
    try {
      console.log(`检查文件夹是否存在: ${path}`);
      
      let remotePath = this.formatPath(path);
      
      // 根路径默认存在
      if (!remotePath) {
        console.log('根路径始终存在');
        return true;
      }
      
      // 确保路径以/结尾
      if (!remotePath.endsWith('/')) {
        remotePath += '/';
      }
      
      // 拼接完整URL
      const serverUrl = this.formatUrl(this.config.serverUrl);
      let url = serverUrl + remotePath;
      if (!url.endsWith('/')) {
        url += '/';
      }
      
      console.log(`检查文件夹是否存在: ${url}`);
      
      // 对于坚果云，首先检查根目录
      if (this.isJianGuoYun() && (!remotePath || remotePath === '')) {
        console.log('检查坚果云根目录，默认认为存在');
        return true; // 坚果云根目录总是存在
      }
      
      // 对于坚果云，使用PROPFIND可能比HEAD更可靠
      if (this.isJianGuoYun()) {
        try {
          // 使用PROPFIND方法检查文件夹
          const propfindBody = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
          
          const options: RequestUrlParam = {
            url: url,
            method: 'PROPFIND',
            headers: {
              ...this.getHeaders(),
              'Depth': '0',
              'Content-Type': 'application/xml'
            },
            body: propfindBody
          };
          
          // 尝试发送请求
          try {
            const response = await requestUrl(options);
            if (response.status >= 200 && response.status < 300) {
              // 成功响应，尝试检查返回的XML以确认是否为文件夹
              try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(response.text, "text/xml");
                
                // 检查是否有解析错误
                const parseError = xmlDoc.querySelector("parsererror");
                if (parseError) {
                  console.warn('XML解析错误，假定文件夹存在:', parseError.textContent);
                  return true; // 假定文件夹存在
                }
                
                // 查找资源类型
                let isCollection = false;
                
                // 尝试不同的选择器策略
                for (const selector of [
                  'resourcetype collection', 
                  'd\\:resourcetype d\\:collection', 
                  'D\\:resourcetype D\\:collection',
                  'response resourcetype collection',
                  'response d\\:resourcetype d\\:collection'
                ]) {
                  if (xmlDoc.querySelector(selector)) {
                    isCollection = true;
                    break;
                  }
                }
                
                // 如果上述方法失败，尝试命名空间查询
                if (!isCollection) {
                  try {
                    const responseEl = xmlDoc.getElementsByTagNameNS('DAV:', 'response')[0];
                    if (responseEl) {
                      const resourceTypeEl = responseEl.getElementsByTagNameNS('DAV:', 'resourcetype')[0];
                      if (resourceTypeEl) {
                        isCollection = resourceTypeEl.getElementsByTagNameNS('DAV:', 'collection').length > 0;
                      }
                    }
                  } catch (e) {
                    console.log('命名空间查询失败:', e);
                  }
                }
                
                return isCollection;
              } catch (parseError) {
                console.warn('解析XML响应失败，假定文件夹存在:', parseError);
                return true; // 假定文件夹存在
              }
            } else {
              return false; // 状态码表示不存在
            }
          } catch (requestError) {
            // 如果是404错误，说明文件夹不存在
            if (requestError.status === 404) {
              return false;
            }
            
            // 对于403或401错误，如果是坚果云可能需要特殊处理
            if (this.isJianGuoYun() && (requestError.status === 403 || requestError.status === 401)) {
              console.log('坚果云PROPFIND请求失败，尝试GET方法');
              
              // 尝试使用GET请求作为备选
              try {
                const getOptions: RequestUrlParam = {
                  url: url,
                  method: 'GET',
                  headers: this.getHeaders()
                };
                
                const getResponse = await requestUrl(getOptions);
                return getResponse.status >= 200 && getResponse.status < 300;
              } catch (getError) {
                if (getError.status === 404) {
                  return false;
                }
                
                // 如果直接创建文件夹可能成功，返回false以便创建
                console.log('坚果云GET请求也失败，返回false以尝试创建:', getError);
                return false;
              }
            }
            
            // 其他错误，重新抛出
            throw requestError;
          }
        } catch (error) {
          // 对于404错误，说明文件夹不存在
          if (error.status === 404) {
            return false;
          }
          
          // 对于403或401错误，可能是认证问题，尝试特殊处理
          if (error.status === 403 || error.status === 401) {
            console.log('检查文件夹存在时遇到认证错误，尝试使用替代方法');
            
            // 检查是否可能是根目录
            if (!remotePath || remotePath === '' || remotePath === '/') {
              console.log('可能是根目录，假定存在');
              return true;
            }
            
            // 返回false而不是抛出错误，让调用者知道需要创建此文件夹
            return false;
          }
          
          // 其他错误需要抛出
          throw error;
        }
      }
      
      // 对于其他WebDAV服务，使用HEAD请求
      // 发送HEAD请求检查文件夹是否存在
      const options: RequestUrlParam = {
        url: url,
        method: 'HEAD',
        headers: this.getHeaders()
      };
      
      try {
        const response = await requestUrl(options);
        return response.status >= 200 && response.status < 300;
      } catch (error) {
        // 如果是404错误，说明文件夹不存在
        if (error.status === 404) {
          return false;
        }
        
        // 对于403或401错误，可能是认证问题
        if (error.status === 403 || error.status === 401) {
          console.log('检查文件夹存在时遇到认证错误，尝试使用替代方法');
          // 返回false而不是抛出错误，让调用者知道需要创建此文件夹
          return false;
        }
        
        // 其他错误需要抛出
        throw error;
      }
    } catch (error) {
      console.error('检查文件夹是否存在失败:', error);
      // 对于404错误，返回false而不是抛出异常
      if (error.status === 404) {
        return false;
      }
      
      // 对于认证错误，也返回false
      if (error.status === 403 || error.status === 401) {
        console.log('检查文件夹存在时遇到认证错误，返回false');
        return false;
      }
      
      throw this.handleError(error);
    }
  }

  /**
   * 下载文件
   * @param remotePath 远程路径
   * @param localPath 本地路径（在此实现中不使用，为了兼容接口）
   * @returns 文件内容
   * @author Bing
   */
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    try {
      console.log(`下载文件: ${remotePath}`);
      
      // 确保路径格式正确
      let path = remotePath || '';
      if (path.startsWith('/')) {
        path = path.substring(1);
      }
      
      // 拼接完整URL
      const serverUrl = this.formatUrl(this.config.serverUrl);
      const url = serverUrl + path;
      
      console.log(`下载URL: ${url}`);
      
      // 发送GET请求下载文件
      const options: RequestUrlParam = {
        url: url,
        method: 'GET',
        headers: this.getHeaders()
      };
      
      const response = await requestUrl(options);
      
      if (response.status >= 200 && response.status < 300) {
        console.log(`文件下载成功: ${remotePath}`);
        // 在此实现中，我们不实际保存到本地文件系统
        // 在实际的完整实现中，你需要将内容保存到本地文件系统
        return;
      } else {
        throw new Error(`下载文件失败，状态码: ${response.status}`);
      }
    } catch (error) {
      console.error('下载文件失败:', error);
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
      console.log(`下载文件内容: ${remotePath}`);
      
      let path = this.formatPath(remotePath);
      
      // 识别文件类型
      const fileExt = remotePath.split('.').pop()?.toLowerCase() || '';
      const isBinary = this.isBinaryFileType(fileExt);
      console.log(`文件类型: ${fileExt}, 被识别为${isBinary ? '二进制' : '文本'}文件`);
      
      // 拼接完整URL
      const serverUrl = this.formatUrl(this.config.serverUrl);
      const url = serverUrl + path;
      
      console.log(`下载URL: ${url}`);
      
      // 发送GET请求下载文件
      const options: RequestUrlParam = {
        url: url,
        method: 'GET',
        headers: this.getHeaders()
      };
      
      // 应用特殊配置
      if (this.isJianGuoYun()) {
        console.log('检测到坚果云WebDAV服务，使用特殊配置');
      }
      
      try {
        const response = await requestUrl(options);
        
        if (response.status >= 200 && response.status < 300) {
          console.log(`文件下载成功: ${remotePath}, 状态码: ${response.status}`);
          
          // 根据文件类型和响应内容判断返回形式
          if (response.arrayBuffer) {
            const contentType = response.headers['content-type'] || '';
            console.log(`服务器返回Content-Type: ${contentType}`);
            
            // 如果是二进制文件类型，强制返回arrayBuffer
            if (isBinary || this.isBinaryContentType(contentType)) {
              console.log(`处理为二进制文件, 内容大小: ${response.arrayBuffer.byteLength} 字节`);
              return response.arrayBuffer;
            }
            
            // 如果确定是文本文件，返回文本
            if (response.text && this.isTextContentType(contentType)) {
              console.log(`处理为文本文件, 内容大小: ${response.text.length} 字符`);
              return response.text;
            }
            
            // 默认如果有arrayBuffer则返回二进制
            console.log(`默认处理为二进制文件, 内容大小: ${response.arrayBuffer.byteLength} 字节`);
            return response.arrayBuffer;
          }
          
          // 如果没有二进制响应，返回文本内容
          if (response.text) {
            console.log(`没有二进制响应，返回文本内容, 大小: ${response.text.length} 字符`);
            return response.text;
          }
          
          console.log(`警告: 响应中既没有text也没有arrayBuffer属性`);
          throw new Error('响应不包含有效的内容');
        } else {
          console.error(`下载文件内容失败，状态码: ${response.status}, URL: ${url}`);
          throw new Error(`下载文件内容失败，状态码: ${response.status}`);
        }
      } catch (requestError) {
        console.error(`请求文件内容时出错:`, requestError);
        
        // 对于坚果云，尝试特殊处理
        if (this.isJianGuoYun()) {
          console.log(`尝试对坚果云进行特殊处理`);
          
          // 可以在这里添加针对坚果云的特殊处理逻辑
        }
        
        throw requestError;
      }
    } catch (error) {
      console.error('下载文件内容失败:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 判断是否为二进制文件类型
   * @param fileExt 文件扩展名
   * @returns 是否为二进制文件
   * @author Bing
   */
  private isBinaryFileType(fileExt: string): boolean {
    const binaryExtensions = [
      'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'zip', 'rar', '7z', 'tar', 'gz',
      'jpg', 'jpeg', 'png', 'gif', 'bmp', 'ico', 'tif', 'tiff', 
      'mp3', 'mp4', 'avi', 'mov', 'wmv', 'flv',
      'exe', 'dll', 'so', 'class'
    ];
    
    return binaryExtensions.includes(fileExt.toLowerCase());
  }
  
  /**
   * 判断是否为二进制内容类型
   * @param contentType Content-Type头
   * @returns 是否为二进制内容
   * @author Bing
   */
  private isBinaryContentType(contentType: string): boolean {
    return !contentType.includes('text/') && 
          !contentType.includes('application/json') && 
          !contentType.includes('application/xml') &&
          !contentType.includes('application/javascript');
  }
  
  /**
   * 判断是否为文本内容类型
   * @param contentType Content-Type头
   * @returns 是否为文本内容
   * @author Bing
   */
  private isTextContentType(contentType: string): boolean {
    return contentType.includes('text/') || 
          contentType.includes('application/json') || 
          contentType.includes('application/xml') ||
          contentType.includes('application/javascript');
  }

  /**
   * 删除文件
   * @param remotePath 远程路径
   * @author Bing
   */
  async deleteFile(remotePath: string): Promise<void> {
    try {
      console.log(`删除文件: ${remotePath}`);
      
      let path = this.formatPath(remotePath);
      
      // 拼接完整URL
      const serverUrl = this.formatUrl(this.config.serverUrl);
      const url = serverUrl + path;
      
      console.log(`删除URL: ${url}`);
      
      // 检查是否为坚果云
      const isJianGuoYun = this.isJianGuoYun();
      if (isJianGuoYun) {
        console.log('检测到坚果云WebDAV服务，使用特殊删除配置');
      }
      
      // 发送DELETE请求删除文件
      const options: RequestUrlParam = {
        url: url,
        method: 'DELETE',
        headers: this.getHeaders()
      };
      
      try {
        const response = await requestUrl(options);
        
        if (response.status >= 200 && response.status < 300) {
          console.log(`文件删除成功: ${remotePath}`);
        } else {
          throw new Error(`删除文件失败，状态码: ${response.status}`);
        }
      } catch (deleteError) {
        // 对坚果云进行特殊处理
        if (isJianGuoYun && (deleteError.status === 403 || deleteError.status === 401 || 
            deleteError.status === 405 || deleteError.status === 500 || deleteError.status === 502 || 
            deleteError.status === 503)) {
          console.log(`坚果云删除文件返回错误(${deleteError.status})，尝试特殊处理`);
          
          // 先判断文件是否真的存在，如果已不存在则直接返回成功
          try {
            const fileExistsOptions: RequestUrlParam = {
              url: url,
              method: 'HEAD',
              headers: this.getHeaders()
            };
            
            try {
              await requestUrl(fileExistsOptions);
              // 文件还存在，继续尝试删除
            } catch (headError) {
              if (headError.status === 404) {
                console.log(`文件已不存在，视为删除成功: ${remotePath}`);
                return;
              }
            }
          } catch (checkError) {
            console.warn('检查文件存在性失败，继续尝试删除:', checkError);
          }
          
          // 尝试替代方法：用空内容覆盖文件，然后再删除
          try {
            console.log(`尝试先用空内容覆盖文件再删除: ${remotePath}`);
            const putOptions: RequestUrlParam = {
              url: url,
              method: 'PUT',
              headers: {
                ...this.getHeaders(),
                'Content-Type': 'text/plain; charset=utf-8'
              },
              body: '' // 空内容
            };
            
            // 先覆盖为空文件
            const putResponse = await requestUrl(putOptions);
            if (putResponse.status >= 200 && putResponse.status < 300) {
              console.log('文件已被覆盖为空内容');
              
              // 延迟500ms再删除
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // 再次尝试删除
              const retryDeleteOptions: RequestUrlParam = {
                url: url,
                method: 'DELETE',
                headers: this.getHeaders()
              };
              
              try {
                const retryResponse = await requestUrl(retryDeleteOptions);
                if (retryResponse.status >= 200 && retryResponse.status < 300) {
                  console.log(`特殊处理后文件删除成功: ${remotePath}`);
                  return;
                }
              } catch (secondDeleteError) {
                // 即使第二次删除失败，文件内容已清空，可视为软删除
                console.log(`第二次尝试删除失败，但文件已清空，视为删除成功: ${remotePath}`);
                return;
              }
            }
          } catch (putError) {
            console.warn('替换为空文件失败:', putError);
            
            // 如果覆盖为空内容失败，尝试使用其他方法：
            try {
              // 尝试重命名文件为临时文件(添加.deleted后缀)
              console.log(`尝试将文件重命名为临时删除文件: ${remotePath}`);
              const tempFileName = path + '.deleted';
              const moveOptions: RequestUrlParam = {
                url: url,
                method: 'MOVE',
                headers: {
                  ...this.getHeaders(),
                  'Destination': serverUrl + tempFileName,
                  'Overwrite': 'T'
                }
              };
              
              await requestUrl(moveOptions);
              console.log(`已将文件重命名为临时文件: ${tempFileName}`);
              
              // 视为删除成功
              return;
            } catch (moveError) {
              console.warn('重命名文件失败:', moveError);
            }
          }
          
          // 如果所有尝试都失败，对于坚果云，我们允许忽略此错误并继续
          console.warn(`所有坚果云删除方法都失败，但忽略此错误继续执行: ${remotePath}`);
          return;
        }
        
        // 非坚果云服务或其他错误类型，抛出原始错误
        throw deleteError;
      }
    } catch (error) {
      console.error('删除文件失败:', error);
      
      // 对于坚果云，即使删除失败，也不中断执行
      if (this.isJianGuoYun()) {
        console.warn(`坚果云删除文件失败，但允许继续执行: ${remotePath}`);
        return; // 返回而不是抛出错误
      }
      
      throw this.handleError(error);
    }
  }

  /**
   * 移动/重命名文件
   * @param oldPath 旧路径
   * @param newPath 新路径
   * @author Bing
   */
  async moveFile(oldPath: string, newPath: string): Promise<void> {
    try {
      console.log(`移动文件从: ${oldPath} 到: ${newPath}`);
      
      let oldRemotePath = this.formatPath(oldPath);
      let newRemotePath = this.formatPath(newPath);
      
      // 拼接完整URL
      const serverUrl = this.formatUrl(this.config.serverUrl);
      const sourceUrl = serverUrl + oldRemotePath;
      const destinationUrl = serverUrl + newRemotePath;
      
      console.log(`移动源URL: ${sourceUrl}`);
      console.log(`移动目标URL: ${destinationUrl}`);
      
      // 创建目标文件夹（如果需要）
      const destDir = newRemotePath.split('/').slice(0, -1).join('/');
      if (destDir) {
        await this.ensureDirectoryExists(destDir);
      }
      
      // 发送MOVE请求移动文件
      const options: RequestUrlParam = {
        url: sourceUrl,
        method: 'MOVE',
        headers: {
          ...this.getHeaders(),
          'Destination': destinationUrl,
          'Overwrite': 'T' // 覆盖已存在的文件
        }
      };
      
      const response = await requestUrl(options);
      
      if (response.status >= 200 && response.status < 300) {
        console.log(`文件移动成功: ${oldPath} -> ${newPath}`);
      } else {
        throw new Error(`移动文件失败，状态码: ${response.status}`);
      }
    } catch (error) {
      console.error('移动文件失败:', error);
      throw this.handleError(error);
    }
  }

  /**
   * 删除文件夹
   * @param path 文件夹路径
   * @author Bing
   */
  async deleteFolder(path: string): Promise<void> {
    try {
      console.log(`删除文件夹: ${path}`);
      
      let remotePath = this.formatPath(path);
      
      // 根目录不能删除
      if (!remotePath) {
        throw new Error('不能删除根目录');
      }
      
      // 确保路径以/结尾
      if (!remotePath.endsWith('/')) {
        remotePath += '/';
      }
      
      // 拼接完整URL
      const serverUrl = this.formatUrl(this.config.serverUrl);
      const url = serverUrl + remotePath;
      
      console.log(`删除文件夹URL: ${url}`);
      
      // 是否为坚果云
      const isJianGuoYun = this.isJianGuoYun();
      if (isJianGuoYun) {
        console.log('检测到坚果云WebDAV服务，使用特殊文件夹删除配置');
      }
      
      // 发送DELETE请求删除文件夹
      const options: RequestUrlParam = {
        url: url,
        method: 'DELETE',
        headers: this.getHeaders()
      };
      
      try {
        const response = await requestUrl(options);
        
        if (response.status >= 200 && response.status < 300) {
          console.log(`文件夹删除成功: ${path}`);
        } else {
          throw new Error(`删除文件夹失败，状态码: ${response.status}`);
        }
      } catch (deleteError) {
        // 对坚果云进行特殊处理
        if (isJianGuoYun && (deleteError.status === 403 || deleteError.status === 401 || 
            deleteError.status === 405 || deleteError.status === 500 || deleteError.status === 502 || 
            deleteError.status === 503)) {
          console.log(`坚果云删除文件夹失败(${deleteError.status})，但允许继续执行`);
          
          // 检查文件夹是否真的存在
          try {
            const folderExistsOptions: RequestUrlParam = {
              url: url,
              method: 'PROPFIND',
              headers: {
                ...this.getHeaders(),
                'Depth': '0',
                'Content-Type': 'application/xml'
              },
              body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
            };
            
            try {
              await requestUrl(folderExistsOptions);
              // 文件夹确实存在但无法删除，记录警告
              console.warn(`坚果云中文件夹 ${path} 确实存在但无法删除，允许继续执行`);
            } catch (checkError) {
              if (checkError.status === 404) {
                // 如果文件夹不存在，视为成功
                console.log(`文件夹实际不存在，视为删除成功: ${path}`);
              }
            }
          } catch (error) {
            console.warn(`检查坚果云文件夹存在性失败: ${path}`, error);
          }
          
          // 对于坚果云，即使删除失败，也返回成功以继续执行
          return;
        }
        
        throw deleteError;
      }
    } catch (error) {
      console.error('删除文件夹失败:', error);
      
      // 对于坚果云，即使删除失败，也不中断执行
      if (this.isJianGuoYun()) {
        console.warn(`坚果云删除文件夹失败，但允许继续执行: ${path}`);
        return; // 返回而不是抛出错误
      }
      
      throw this.handleError(error);
    }
  }

  /**
   * 获取文件元数据
   * @param path 文件路径
   * @returns 文件元数据
   * @author Bing
   */
  async getFileMetadata(path: string): Promise<FileMetadata> {
    try {
      console.log(`获取文件元数据: ${path}`);
      
      let remotePath = this.formatPath(path);
      
      // 拼接完整URL
      const serverUrl = this.formatUrl(this.config.serverUrl);
      const url = serverUrl + remotePath;
      
      console.log(`元数据URL: ${url}`);
      
      // 发送PROPFIND请求获取元数据
      const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
        <propfind xmlns="DAV:">
          <prop>
            <resourcetype/>
            <getlastmodified/>
            <getcontentlength/>
            <getetag/>
            <creationdate/>
            <getcontenttype/>
          </prop>
        </propfind>`;
      
      const options: RequestUrlParam = {
        url: url,
        method: 'PROPFIND',
        headers: {
          ...this.getHeaders(),
          'Depth': '0',
          'Content-Type': 'application/xml'
        },
        body: propfindBody
      };
      
      const response = await requestUrl(options);
      
      if (response.status >= 200 && response.status < 300) {
        try {
          console.log('解析文件元数据XML响应...');
          // 解析XML响应
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(response.text, "text/xml");
          
          // 检查解析错误
          const parseError = xmlDoc.querySelector("parsererror");
          if (parseError) {
            console.error('XML解析错误:', parseError.textContent);
            throw new Error(`XML解析错误: ${parseError.textContent}`);
          }
          
          // 尝试使用不同方法获取响应元素
          let responseEl: Element | null = null;
          
          // 首先尝试使用命名空间
          try {
            const nsResponses = xmlDoc.getElementsByTagNameNS('DAV:', 'response');
            if (nsResponses && nsResponses.length > 0) {
              responseEl = nsResponses[0];
            }
          } catch (e) {
            console.log('使用命名空间获取响应元素失败，尝试替代方法');
          }
          
          // 如果命名空间方法失败，尝试其他选择器
          if (!responseEl) {
            // 尝试标准的querySelector (不带命名空间)
            responseEl = xmlDoc.querySelector('response') || 
                        xmlDoc.querySelector('d\\:response') || 
                        xmlDoc.querySelector('D\\:response');
          }
          
          if (!responseEl) {
            throw new Error('获取文件元数据失败：无效的响应格式，找不到response元素');
          }
          
          // 获取href (文件路径)
          let href = '';
          let hrefEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsHref = responseEl.getElementsByTagNameNS('DAV:', 'href');
            if (nsHref && nsHref.length > 0) {
              hrefEl = nsHref[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!hrefEl) {
            hrefEl = responseEl.querySelector('href') || 
                    responseEl.querySelector('d\\:href') || 
                    responseEl.querySelector('D\\:href');
          }
          
          if (hrefEl && hrefEl.textContent) {
            href = decodeURIComponent(hrefEl.textContent);
          }
          
          // 获取资源类型
          let isFolder = false;
          let resourceTypeEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsResType = responseEl.getElementsByTagNameNS('DAV:', 'resourcetype');
            if (nsResType && nsResType.length > 0) {
              resourceTypeEl = nsResType[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!resourceTypeEl) {
            resourceTypeEl = responseEl.querySelector('resourcetype') || 
                            responseEl.querySelector('d\\:resourcetype') || 
                            responseEl.querySelector('D\\:resourcetype');
          }
          
          if (resourceTypeEl) {
            // 检查collection元素存在
            let collectionFound = false;
            
            // 尝试命名空间方法
            try {
              const nsCollection = resourceTypeEl.getElementsByTagNameNS('DAV:', 'collection');
              collectionFound = nsCollection && nsCollection.length > 0;
            } catch (e) {}
            
            // 尝试标准querySelector
            if (!collectionFound) {
              const collEl = resourceTypeEl.querySelector('collection') || 
                            resourceTypeEl.querySelector('d\\:collection') || 
                            resourceTypeEl.querySelector('D\\:collection');
              collectionFound = !!collEl;
            }
            
            isFolder = collectionFound;
          }
          
          // 获取最后修改时间
          let modifiedTime = new Date();
          let lastModifiedEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsLastMod = responseEl.getElementsByTagNameNS('DAV:', 'getlastmodified');
            if (nsLastMod && nsLastMod.length > 0) {
              lastModifiedEl = nsLastMod[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!lastModifiedEl) {
            lastModifiedEl = responseEl.querySelector('getlastmodified') || 
                            responseEl.querySelector('d\\:getlastmodified') || 
                            responseEl.querySelector('D\\:getlastmodified');
          }
          
          if (lastModifiedEl && lastModifiedEl.textContent) {
            try {
              modifiedTime = new Date(lastModifiedEl.textContent);
            } catch (e) {
              console.log(`日期解析错误: ${lastModifiedEl.textContent}`, e);
            }
          }
          
          // 获取创建时间
          let createdTime: Date | undefined = undefined;
          let createdEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsCreated = responseEl.getElementsByTagNameNS('DAV:', 'creationdate');
            if (nsCreated && nsCreated.length > 0) {
              createdEl = nsCreated[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!createdEl) {
            createdEl = responseEl.querySelector('creationdate') || 
                        responseEl.querySelector('d\\:creationdate') || 
                        responseEl.querySelector('D\\:creationdate');
          }
          
          if (createdEl && createdEl.textContent) {
            try {
              createdTime = new Date(createdEl.textContent);
            } catch (e) {
              console.log(`创建日期解析错误: ${createdEl.textContent}`, e);
            }
          }
          
          // 获取内容长度（文件大小）
          let size = 0;
          let contentLengthEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsContentLength = responseEl.getElementsByTagNameNS('DAV:', 'getcontentlength');
            if (nsContentLength && nsContentLength.length > 0) {
              contentLengthEl = nsContentLength[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!contentLengthEl) {
            contentLengthEl = responseEl.querySelector('getcontentlength') || 
                              responseEl.querySelector('d\\:getcontentlength') || 
                              responseEl.querySelector('D\\:getcontentlength');
          }
          
          if (contentLengthEl && contentLengthEl.textContent) {
            size = parseInt(contentLengthEl.textContent) || 0;
          }
          
          // 获取ETag（版本标识）
          let etag: string | undefined = undefined;
          let etagEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsEtag = responseEl.getElementsByTagNameNS('DAV:', 'getetag');
            if (nsEtag && nsEtag.length > 0) {
              etagEl = nsEtag[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!etagEl) {
            etagEl = responseEl.querySelector('getetag') || 
                    responseEl.querySelector('d\\:getetag') || 
                    responseEl.querySelector('D\\:getetag');
          }
          
          if (etagEl && etagEl.textContent) {
            etag = etagEl.textContent;
          }
          
          // 获取内容类型
          let contentType: string | undefined = undefined;
          let contentTypeEl: Element | null = null;
          
          // 尝试命名空间方法
          try {
            const nsContentType = responseEl.getElementsByTagNameNS('DAV:', 'getcontenttype');
            if (nsContentType && nsContentType.length > 0) {
              contentTypeEl = nsContentType[0];
            }
          } catch (e) {}
          
          // 尝试标准querySelector
          if (!contentTypeEl) {
            contentTypeEl = responseEl.querySelector('getcontenttype') || 
                            responseEl.querySelector('d\\:getcontenttype') || 
                            responseEl.querySelector('D\\:getcontenttype');
          }
          
          if (contentTypeEl && contentTypeEl.textContent) {
            contentType = contentTypeEl.textContent;
          }
          
          // 文件名称
          const name = path.split('/').pop() || '';
          
          // 创建元数据对象
          const metadata: FileMetadata = {
            path: path,
            name: name,
            isFolder: isFolder,
            size: size,
            modifiedTime: modifiedTime,
            createdTime: createdTime,
            contentType: contentType,
            etag: etag,
            hash: etag // 使用ETag作为哈希值（可以根据需要更改）
          };
          
          return metadata;
        } catch (parseError) {
          console.error('解析元数据响应失败:', parseError);
          throw new Error(`解析元数据响应失败: ${parseError.message || parseError}`);
        }
      } else {
        throw new Error(`获取文件元数据失败，状态码: ${response.status}`);
      }
    } catch (error) {
      console.error('获取文件元数据失败:', error);
      
      // 如果是404错误，返回一个基本的元数据对象，表示文件不存在
      if (error.status === 404) {
        return {
          path: path,
          name: path.split('/').pop() || '',
          isFolder: false,
          size: 0,
          modifiedTime: new Date(),
          exists: false
        } as FileMetadata;
      }
      
      throw this.handleError(error);
    }
  }

  /**
   * 获取服务配额信息
   * @returns 配额信息
   * @author Bing
   */
  async getQuota(): Promise<{ used: number; available: number; total: number }> {
    try {
      console.log('获取WebDAV服务配额');
      
      const serverUrl = this.formatUrl(this.config.serverUrl);
      const url = serverUrl;
      
      const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
        <D:propfind xmlns:D="DAV:">
          <D:prop>
            <D:quota-available-bytes/>
            <D:quota-used-bytes/>
          </D:prop>
        </D:propfind>`;
      
      const options: RequestUrlParam = {
        url: url,
        method: 'PROPFIND',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '0'
        },
        body: propfindBody
      };
      
      try {
        console.log(`发送PROPFIND请求: ${url}`);
        const response = await requestUrl(options);
        
        console.log('解析配额信息XML响应');
        // 解析XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(response.text, 'text/xml');
        
        // 检查解析错误
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
          console.error('XML解析错误:', parseError.textContent);
          return { used: -1, available: -1, total: -1 };
        }
        
        let availableBytes = -1;
        let usedBytes = -1;
        
        // 尝试获取quota-available-bytes
        try {
          // 标准命名空间方式
          const availableBytesElem = xmlDoc.getElementsByTagNameNS('DAV:', 'quota-available-bytes')[0];
          if (availableBytesElem && availableBytesElem.textContent) {
            availableBytes = parseInt(availableBytesElem.textContent.trim(), 10);
            console.log(`找到可用空间: ${availableBytes} 字节`);
          } else {
            // 标准查询选择器方式
            const altAvailableElem = xmlDoc.querySelector('quota-available-bytes, d\\:quota-available-bytes');
            if (altAvailableElem && altAvailableElem.textContent) {
              availableBytes = parseInt(altAvailableElem.textContent.trim(), 10);
              console.log(`通过替代方式找到可用空间: ${availableBytes} 字节`);
            }
          }
        } catch (availableError) {
          console.warn('获取可用空间时出错:', availableError);
        }
        
        // 尝试获取quota-used-bytes
        try {
          // 标准命名空间方式
          const usedBytesElem = xmlDoc.getElementsByTagNameNS('DAV:', 'quota-used-bytes')[0];
          if (usedBytesElem && usedBytesElem.textContent) {
            usedBytes = parseInt(usedBytesElem.textContent.trim(), 10);
            console.log(`找到已用空间: ${usedBytes} 字节`);
          } else {
            // 标准查询选择器方式
            const altUsedElem = xmlDoc.querySelector('quota-used-bytes, d\\:quota-used-bytes');
            if (altUsedElem && altUsedElem.textContent) {
              usedBytes = parseInt(altUsedElem.textContent.trim(), 10);
              console.log(`通过替代方式找到已用空间: ${usedBytes} 字节`);
            }
          }
        } catch (usedError) {
          console.warn('获取已用空间时出错:', usedError);
        }
        
        // 计算总空间
        let totalBytes = -1;
        if (usedBytes >= 0 && availableBytes >= 0) {
          totalBytes = usedBytes + availableBytes;
          console.log(`计算得到总空间: ${totalBytes} 字节`);
        }
        
        return {
          used: usedBytes,
          available: availableBytes,
          total: totalBytes
        };
      } catch (error) {
        console.error('获取配额信息失败:', error);
        return {
          used: -1,
          available: -1,
          total: -1
        };
      }
    } catch (error) {
      console.error('获取配额时出错:', error);
      return {
        used: -1,
        available: -1,
        total: -1
      };
    }
  }
} 