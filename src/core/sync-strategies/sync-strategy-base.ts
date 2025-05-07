import { StorageProvider, FileInfo } from '@providers/common/storage-provider';
import { StorageProviderType } from '@models/plugin-settings';
import CloudSyncPlugin from '@main';
import { ModuleLogger } from '@services/log/log-service';

/**
 * 本地文件信息接口
 * @author Bing
 */
export interface LocalFileInfo {
  path: string;
  mtime: number;
  size: number;
  isFolder: boolean;
}

/**
 * 同步策略接口
 * 定义所有同步策略必须实现的方法
 * @author Bing
 */
export interface SyncStrategy {
  /**
   * 执行同步
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  sync(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void>;
}

/**
 * 同步策略基类
 * 实现同步策略的通用方法
 * @author Bing
 */
export abstract class SyncStrategyBase implements SyncStrategy {
  protected logger: ModuleLogger;
  
  /**
   * 构造函数
   * @param plugin 插件实例
   */
  constructor(protected plugin: CloudSyncPlugin) {
    this.logger = this.plugin.logService.getModuleLogger('SyncStrategy');
  }
  
  /**
   * 执行同步
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  abstract sync(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void>;
  
  /**
   * 获取本地文件映射
   * @param localFiles 本地文件列表
   * @returns 本地文件映射
   * @author Bing
   */
  protected createLocalFilesMap(localFiles: LocalFileInfo[]): Map<string, LocalFileInfo> {
    const map = new Map<string, LocalFileInfo>();
    for (const file of localFiles) {
      map.set(file.path, file);
    }
    return map;
  }
  
  /**
   * 获取远程文件映射
   * @param remoteFiles 远程文件列表
   * @returns 远程文件映射
   * @author Bing
   */
  protected createRemoteFilesMap(remoteFiles: FileInfo[]): Map<string, FileInfo> {
    const map = new Map<string, FileInfo>();
    for (const file of remoteFiles) {
      map.set(file.path, file);
    }
    return map;
  }
  
  /**
   * 处理二进制文件上传（包含加密逻辑）
   * @protected
   * @param plugin 插件实例
   * @param provider 存储提供商
   * @param content 二进制文件内容
   * @param remotePath 远程路径
   * @param sourceFilePath 源文件路径（用于日志）
   */
  protected async handleBinaryUpload(
    plugin: CloudSyncPlugin,
    provider: StorageProvider, 
    content: ArrayBuffer, 
    remotePath: string, 
    sourceFilePath: string
  ): Promise<void> {
    // 检查是否启用加密
    if (plugin.settings.encryption.enabled && plugin.settings.encryption.key) {
      this.logger.info(`加密已启用，对二进制文件内容进行加密: ${sourceFilePath}`);
      
      try {
        // 二进制内容直接进行加密
        const encryptedBuffer = await plugin.cryptoService.encrypt(
          content, 
          plugin.settings.encryption.key
        );
        
        // 上传加密的二进制内容
        // 注意：此处调用的API定义和实现不一致
        // StorageProvider接口定义: uploadFile(localPath, remotePath)
        // 但WebDAV实现实际上是: uploadFile(remotePath, content)
        // @ts-ignore 忽略类型检查，因为我们知道实际实现
        await provider.uploadFile(remotePath, encryptedBuffer);
        this.logger.info(`加密上传二进制文件成功: ${sourceFilePath}`);
      } catch (encryptError) {
        this.logger.error(`加密二进制文件失败: ${sourceFilePath}`, encryptError);
        // 如果加密失败，使用原始内容上传
        // @ts-ignore 忽略类型检查
        await provider.uploadFile(remotePath, content);
      }
    } else {
      // 未启用加密，直接上传二进制内容
      // @ts-ignore 忽略类型检查
      await provider.uploadFile(remotePath, content);
    }
  }
  
  /**
   * 处理文件上传（包含加密逻辑）
   * @protected
   * @param plugin 插件实例
   * @param provider 存储提供商
   * @param content 文件内容
   * @param remotePath 远程路径
   * @param sourceFilePath 源文件路径（用于日志）
   * @author Bing
   */
  protected async handleEncryptedUpload(
    plugin: CloudSyncPlugin,
    provider: StorageProvider, 
    content: string, 
    remotePath: string, 
    sourceFilePath: string
  ): Promise<void> {
    // 检查是否启用加密
    if (plugin.settings.encryption.enabled && plugin.settings.encryption.key) {
      this.logger.info(`加密已启用，对文件内容进行加密: ${sourceFilePath}`);
      
      // 检查内容是否已经是加密内容，避免二次加密
      const isBase64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(content);
      if (isBase64 && content.length > 100) {  // 加密后的Base64字符串通常较长
        this.logger.info(`检测到可能已经是加密内容，避免二次加密: ${sourceFilePath}`);
        try {
          // 尝试解密，如果能解密则说明是已加密内容
          const buffer = await this.base64ToArrayBuffer(content);
          try {
            await plugin.cryptoService.decrypt(buffer, plugin.settings.encryption.key);
            this.logger.info(`内容已加密，直接上传: ${sourceFilePath}`);
            // 内容已加密，直接上传
            // @ts-ignore 忽略类型检查，接口与实现不一致
            await provider.uploadFile(remotePath, content);
            return;
          } catch (decryptError) {
            // 解密失败，说明不是加密内容，继续正常加密流程
            this.logger.info(`内容不是加密格式，继续执行加密: ${sourceFilePath}`);
          }
        } catch (error) {
          // Base64解析失败，可能不是加密内容，继续正常加密流程
          this.logger.info(`Base64解析失败，继续执行加密: ${sourceFilePath}`);
        }
      }
      
      try {
        // 转换为ArrayBuffer进行加密
        const contentBuffer = new TextEncoder().encode(content).buffer;
        const encryptedBuffer = await plugin.cryptoService.encrypt(
          contentBuffer, 
          plugin.settings.encryption.key
        );
        
        // 将加密后的ArrayBuffer转换为Base64字符串
        const encryptedBase64 = await this.arrayBufferToBase64(encryptedBuffer);
        
        // 上传加密的内容
        // 注意：虽然StorageProvider接口定义的参数是(localPath, remotePath)，
        // 但实际实现中WebDAV接口的参数是(remotePath, content)
        // @ts-ignore 忽略类型检查，接口与实现不一致
        await provider.uploadFile(remotePath, encryptedBase64);
        this.logger.info(`加密上传成功: ${sourceFilePath}`);
      } catch (encryptError) {
        this.logger.error(`加密失败: ${sourceFilePath}`, encryptError);
        // 如果加密失败，使用原始内容上传
        // @ts-ignore 忽略类型检查，接口与实现不一致
        await provider.uploadFile(remotePath, content);
      }
    } else {
      // 未启用加密，直接上传
      // @ts-ignore 忽略类型检查，接口与实现不一致
      await provider.uploadFile(remotePath, content);
    }
  }
  
  /**
   * 处理文件下载（包含解密逻辑）
   * @protected
   * @param plugin 插件实例
   * @param provider 存储提供商
   * @param remotePath 远程路径
   * @param localPath 本地路径
   * @author Bing
   */
  protected async handleEncryptedDownload(
    plugin: CloudSyncPlugin,
    provider: StorageProvider,
    remotePath: string,
    localPath: string
  ): Promise<void> {
    if (!provider.downloadFileContent) {
      this.logger.error(`当前提供商不支持直接下载文件内容: ${remotePath}`);
      return;
    }
    
    // 下载文件
    let content = await provider.downloadFileContent(remotePath);
    
    // 检查是否启用加密，并尝试解密内容
    if (plugin.settings.encryption.enabled && 
        plugin.settings.encryption.key && 
        typeof content === 'string') {
      this.logger.info(`加密已启用，尝试解密文件内容: ${remotePath}`);
      
      // 检测内容是否可能是加密的Base64字符串
      const isBase64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(content);
      if (!isBase64) {
        this.logger.info(`内容不是有效的Base64格式，视为未加密: ${remotePath}`);
      } else {
        try {
          // 尝试将内容转换为ArrayBuffer并解密
          const contentBuffer = await this.base64ToArrayBuffer(content);
          const decryptedBuffer = await plugin.cryptoService.decrypt(
            contentBuffer, 
            plugin.settings.encryption.key
          );
          
          // 解密成功，将二进制内容转换为文本
          const decryptedText = new TextDecoder().decode(decryptedBuffer);
          
          // 写入到本地文件
          await plugin.app.vault.adapter.write(localPath, decryptedText);
          this.logger.info(`文件解密并写入成功: ${localPath}`);
          return;
        } catch (decryptError) {
          // 解密失败，可能是未加密或加密格式不正确
          this.logger.warning(`解密失败，使用原始内容: ${remotePath}`, decryptError);
        }
      }
    }
    
    // 如果未加密或解密失败，直接使用原始内容写入文件
    if (typeof content === 'string') {
      await plugin.app.vault.adapter.write(localPath, content);
    } else if (content instanceof ArrayBuffer) {
      await plugin.app.vault.adapter.writeBinary(localPath, content);
    } else {
      this.logger.error(`无法处理的内容类型: ${typeof content}, ${remotePath}`);
    }
  }
  
  /**
   * 将ArrayBuffer转换为Base64字符串
   * @protected
   * @param buffer ArrayBuffer
   * @returns Base64字符串
   */
  protected async arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
    // 在浏览器环境中
    const blob = new Blob([buffer]);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.substr(dataUrl.indexOf(',') + 1);
        resolve(base64);
      };
      reader.onerror = () => {
        reject(new Error('ArrayBuffer转Base64失败'));
      };
      reader.readAsDataURL(blob);
    });
  }
  
  /**
   * 将Base64字符串转换为ArrayBuffer
   * @protected
   * @param base64 Base64字符串
   * @returns ArrayBuffer
   */
  protected async base64ToArrayBuffer(base64: string): Promise<ArrayBuffer> {
    // 在Node.js环境中（Obsidian桌面版）
    try {
      // 尝试使用fetch API标准方法
      const response = await fetch(`data:application/octet-stream;base64,${base64}`);
      return await response.arrayBuffer();
    } catch (error) {
      // 备选方法
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }
  }
} 