import { App } from 'obsidian';
import { StorageProvider, FileInfo, FileMetadata, QuotaInfo } from '@providers/common/storage-provider';
import { WebDAVSettings, RequestDelayLevel } from '@models/plugin-settings';
import { WebDAVFactory } from './webdav-factory';
import { ModuleLogger } from '@services/log/log-service';
import CloudSyncPlugin from '@main';

/**
 * 扩展的存储提供商接口
 * 包含WebDAV特定的方法
 */
interface ExtendedStorageProvider extends StorageProvider {
  updateRequestDelay?: (delayLevel: RequestDelayLevel) => Promise<void>;
  updateAccountType?: (isPaidUser: boolean) => Promise<void>;
}

/**
 * 类型守卫：检查提供商是否支持更新请求延迟
 * @param provider 存储提供商
 * @returns 提供商是否支持更新请求延迟
 */
function supportsRequestDelay(provider: StorageProvider): provider is ExtendedStorageProvider & { updateRequestDelay: Function } {
  return 'updateRequestDelay' in provider && typeof (provider as ExtendedStorageProvider).updateRequestDelay === 'function';
}

/**
 * 类型守卫：检查提供商是否支持更新账户类型
 * @param provider 存储提供商
 * @returns 提供商是否支持更新账户类型
 */
function supportsAccountType(provider: StorageProvider): provider is ExtendedStorageProvider & { updateAccountType: Function } {
  return 'updateAccountType' in provider && typeof (provider as ExtendedStorageProvider).updateAccountType === 'function';
}

/**
 * WebDAV提供商类
 * 向下兼容的包装器，保持与原WebDAVProvider接口兼容
 * @author Bing
 */
export class WebDAVProvider implements StorageProvider {
  private provider: ExtendedStorageProvider;
  private logger: ModuleLogger | null = null;
  
  /**
   * 创建WebDAV提供商实例
   * @param config WebDAV配置
   * @param app Obsidian应用实例
   * @param plugin 插件实例，用于获取日志服务
   * @author Bing
   */
  constructor(config: WebDAVSettings, app: App, plugin?: CloudSyncPlugin) {
    if (plugin && plugin.logService) {
      this.logger = plugin.logService.getModuleLogger('WebDAVProvider');
      this.logger.info('初始化WebDAV提供商');
    }

    // 创建底层提供商实例
    this.provider = WebDAVFactory.createProvider(config, app, plugin) as ExtendedStorageProvider;
    this.logger?.info('WebDAV提供商创建完成');
  }
  
  /**
   * 获取提供商名称
   * @returns 名称
   * @author Bing
   */
  getName(): string {
    const name = this.provider.getName();
    this.logger?.debug(`获取提供商名称: ${name}`);
    return name;
  }
  
  /**
   * 获取提供商类型
   * @returns 类型
   * @author Bing
   */
  getType(): string {
    const type = this.provider.getType();
    this.logger?.debug(`获取提供商类型: ${type}`);
    return type;
  }
  
  /**
   * 获取连接状态
   * @returns 连接状态
   * @author Bing
   */
  getStatus() {
    const status = this.provider.getStatus();
    this.logger?.debug(`获取连接状态: ${status}`);
    return status;
  }
  
  /**
   * 连接到WebDAV服务器
   * @returns 连接是否成功
   * @author Bing
   */
  async connect(): Promise<boolean> {
    this.logger?.info('连接到WebDAV服务器');
    try {
      const result = await this.provider.connect();
      this.logger?.info(`WebDAV连接${result ? '成功' : '失败'}`);
      return result;
    } catch (error) {
      this.logger?.error('WebDAV连接失败', error);
      throw error;
    }
  }
  
  /**
   * 断开与WebDAV服务器的连接
   * @author Bing
   */
  async disconnect(): Promise<void> {
    this.logger?.info('断开WebDAV服务器连接');
    try {
      await this.provider.disconnect();
      this.logger?.info('WebDAV连接已断开');
    } catch (error) {
      this.logger?.error('断开WebDAV连接失败', error);
      throw error;
    }
  }
  
  /**
   * 测试连接
   * @returns 连接是否成功
   * @author Bing
   */
  async testConnection(): Promise<boolean> {
    this.logger?.info('测试WebDAV连接');
    try {
      const result = await this.provider.testConnection();
      this.logger?.info(`WebDAV连接测试${result ? '成功' : '失败'}`);
      return result;
    } catch (error) {
      this.logger?.error('WebDAV连接测试失败', error);
      throw error;
    }
  }
  
  /**
   * 列出指定路径下的文件
   * @param path 路径
   * @returns 文件列表
   * @author Bing
   */
  async listFiles(path: string): Promise<FileInfo[]> {
    this.logger?.info(`列出WebDAV文件: ${path}`);
    try {
      const files = await this.provider.listFiles(path);
      this.logger?.info(`成功列出${files.length}个文件`);
      this.logger?.debug(`文件列表: ${files.map(f => f.name).join(', ')}`);
      return files;
    } catch (error) {
      this.logger?.error(`列出WebDAV文件失败: ${path}`, error);
      throw error;
    }
  }
  
  /**
   * 下载文件
   * @param remotePath 远程路径
   * @param localPath 本地路径
   * @author Bing
   */
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    this.logger?.info(`下载WebDAV文件: ${remotePath} -> ${localPath}`);
    try {
      await this.provider.downloadFile(remotePath, localPath);
      this.logger?.info(`文件下载成功: ${remotePath}`);
    } catch (error) {
      this.logger?.error(`下载WebDAV文件失败: ${remotePath}`, error);
      throw error;
    }
  }
  
  /**
   * 下载文件内容
   * @param remotePath 远程路径
   * @returns 文件内容（字符串或二进制数据）
   * @author Bing
   */
  async downloadFileContent(remotePath: string): Promise<string | ArrayBuffer> {
    this.logger?.info(`下载WebDAV文件内容: ${remotePath}`);
    try {
      if (this.provider.downloadFileContent) {
        const content = await this.provider.downloadFileContent(remotePath);
        const contentType = typeof content === 'string' ? '文本' : '二进制';
        const contentSize = typeof content === 'string' ? content.length : content.byteLength;
        this.logger?.info(`文件内容下载成功: ${remotePath} (${contentType}, ${contentSize} 字节)`);
        return content;
      } else {
        const error = new Error('当前提供商不支持下载文件内容');
        this.logger?.error(error.message);
        throw error;
      }
    } catch (error) {
      this.logger?.error(`下载WebDAV文件内容失败: ${remotePath}`, error);
      throw error;
    }
  }
  
  /**
   * 上传文件
   * @param localPath 本地路径
   * @param remotePath 远程路径
   * @author Bing
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    this.logger?.info(`上传文件: ${localPath} -> ${remotePath}`);
    try {
      await this.provider.uploadFile(localPath, remotePath);
      this.logger?.info(`文件上传成功: ${remotePath}`);
    } catch (error) {
      this.logger?.error(`上传文件失败: ${remotePath}`, error);
      throw error;
    }
  }
  
  /**
   * 删除文件
   * @param remotePath 远程路径
   * @author Bing
   */
  async deleteFile(remotePath: string): Promise<void> {
    this.logger?.info(`删除WebDAV文件: ${remotePath}`);
    try {
      await this.provider.deleteFile(remotePath);
      this.logger?.info(`文件删除成功: ${remotePath}`);
    } catch (error) {
      this.logger?.error(`删除WebDAV文件失败: ${remotePath}`, error);
      throw error;
    }
  }
  
  /**
   * 移动文件
   * @param oldPath 原路径
   * @param newPath 新路径
   * @author Bing
   */
  async moveFile(oldPath: string, newPath: string): Promise<void> {
    this.logger?.info(`移动WebDAV文件: ${oldPath} -> ${newPath}`);
    try {
      await this.provider.moveFile(oldPath, newPath);
      this.logger?.info(`文件移动成功: ${oldPath} -> ${newPath}`);
    } catch (error) {
      this.logger?.error(`移动WebDAV文件失败: ${oldPath} -> ${newPath}`, error);
      throw error;
    }
  }
  
  /**
   * 创建文件夹
   * @param path 路径
   * @author Bing
   */
  async createFolder(path: string): Promise<void> {
    this.logger?.info(`创建WebDAV文件夹: ${path}`);
    try {
      await this.provider.createFolder(path);
      this.logger?.info(`文件夹创建成功: ${path}`);
    } catch (error) {
      this.logger?.error(`创建WebDAV文件夹失败: ${path}`, error);
      throw error;
    }
  }
  
  /**
   * 删除文件夹
   * @param path 路径
   * @author Bing
   */
  async deleteFolder(path: string): Promise<void> {
    this.logger?.info(`删除WebDAV文件夹: ${path}`);
    try {
      await this.provider.deleteFolder(path);
      this.logger?.info(`文件夹删除成功: ${path}`);
    } catch (error) {
      this.logger?.error(`删除WebDAV文件夹失败: ${path}`, error);
      throw error;
    }
  }
  
  /**
   * 检查文件夹是否存在
   * @param path 路径
   * @returns 文件夹是否存在
   * @author Bing
   */
  async folderExists(path: string): Promise<boolean> {
    this.logger?.debug(`检查WebDAV文件夹是否存在: ${path}`);
    try {
      const exists = await this.provider.folderExists(path);
      this.logger?.debug(`文件夹${exists ? '存在' : '不存在'}: ${path}`);
      return exists;
    } catch (error) {
      this.logger?.error(`检查WebDAV文件夹存在性失败: ${path}`, error);
      throw error;
    }
  }
  
  /**
   * 获取文件元数据
   * @param path 路径
   * @returns 文件元数据
   * @author Bing
   */
  async getFileMetadata(path: string): Promise<FileMetadata> {
    this.logger?.debug(`获取WebDAV文件元数据: ${path}`);
    try {
      const metadata = await this.provider.getFileMetadata(path);
      this.logger?.debug(`获取文件元数据成功: ${path}, 修改时间: ${metadata.modifiedTime.toISOString()}, 大小: ${metadata.size}`);
      return metadata;
    } catch (error) {
      this.logger?.error(`获取WebDAV文件元数据失败: ${path}`, error);
      throw error;
    }
  }
  
  /**
   * 获取配额信息
   * @returns 配额信息
   * @author Bing
   */
  async getQuota(): Promise<QuotaInfo> {
    this.logger?.info('获取WebDAV配额信息');
    try {
      const quota = await this.provider.getQuota();
      this.logger?.info(`获取配额信息成功, 已用: ${quota.used}, 总计: ${quota.total}`);
      return quota;
    } catch (error) {
      this.logger?.error('获取WebDAV配额信息失败', error);
      throw error;
    }
  }
  
  /**
   * 更新请求延迟设置
   * 如果底层提供商支持，转发调用
   * @param delayLevel 延迟级别
   */
  async updateRequestDelay(delayLevel: RequestDelayLevel): Promise<void> {
    this.logger?.info(`更新WebDAV请求延迟设置: ${delayLevel}`);
    try {
      // 使用类型守卫检查底层提供商是否支持此方法
      if (this.provider && supportsRequestDelay(this.provider)) {
        await this.provider.updateRequestDelay(delayLevel);
        this.logger?.info(`请求延迟设置已更新: ${delayLevel}`);
        return;
      }
      const error = new Error('当前提供商不支持更新请求延迟');
      this.logger?.error(error.message);
      throw error;
    } catch (error) {
      this.logger?.error(`更新WebDAV请求延迟设置失败: ${delayLevel}`, error);
      throw error;
    }
  }
  
  /**
   * 更新账户类型
   * 如果底层提供商支持，转发调用
   * @param isPaidUser 是否为付费用户
   */
  async updateAccountType(isPaidUser: boolean): Promise<void> {
    this.logger?.info(`更新WebDAV账户类型: ${isPaidUser ? '付费用户' : '免费用户'}`);
    try {
      // 使用类型守卫检查底层提供商是否支持此方法
      if (this.provider && supportsAccountType(this.provider)) {
        await this.provider.updateAccountType(isPaidUser);
        this.logger?.info(`账户类型已更新: ${isPaidUser ? '付费用户' : '免费用户'}`);
        return;
      }
      const error = new Error('当前提供商不支持更新账户类型');
      this.logger?.error(error.message);
      throw error;
    } catch (error) {
      this.logger?.error(`更新WebDAV账户类型失败: ${isPaidUser}`, error);
      throw error;
    }
  }
} 