import { StorageProvider, FileInfo } from '@providers/common/storage-provider';
import { StorageProviderType } from '@models/plugin-settings';
import CloudSyncPlugin from '@main';

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
      console.log(`加密已启用，对文件内容进行加密: ${sourceFilePath}`);
      
      // 检查内容是否已经是加密内容，避免二次加密
      const isBase64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(content);
      if (isBase64 && content.length > 100) {  // 加密后的Base64字符串通常较长
        console.log(`检测到可能已经是加密内容，避免二次加密: ${sourceFilePath}`);
        try {
          // 尝试解密，如果能解密则说明是已加密内容
          const buffer = await this.base64ToArrayBuffer(content);
          try {
            await plugin.cryptoService.decrypt(buffer, plugin.settings.encryption.key);
            console.log(`内容已加密，直接上传: ${sourceFilePath}`);
            // 内容已加密，直接上传
            await provider.uploadFile(remotePath, content);
            return;
          } catch (decryptError) {
            // 解密失败，说明不是加密内容，继续正常加密流程
            console.log(`内容不是加密格式，继续执行加密: ${sourceFilePath}`);
          }
        } catch (error) {
          // Base64解析失败，可能不是加密内容，继续正常加密流程
          console.log(`Base64解析失败，继续执行加密: ${sourceFilePath}`);
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
        await provider.uploadFile(remotePath, encryptedBase64);
        console.log(`加密上传成功: ${sourceFilePath}`);
      } catch (encryptError) {
        console.error(`加密失败: ${sourceFilePath}`, encryptError);
        // 如果加密失败，使用原始内容上传
        await provider.uploadFile(remotePath, content);
      }
    } else {
      // 未启用加密，直接上传
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
      console.error(`当前提供商不支持直接下载文件内容: ${remotePath}`);
      return;
    }
    
    // 下载文件
    let content = await provider.downloadFileContent(remotePath);
    
    // 检查是否启用加密，并尝试解密内容
    if (plugin.settings.encryption.enabled && 
        plugin.settings.encryption.key && 
        typeof content === 'string') {
      console.log(`加密已启用，尝试解密文件内容: ${remotePath}`);
      
      // 检测内容是否可能是加密的Base64字符串
      const isBase64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(content);
      if (!isBase64) {
        console.log(`内容不是有效的Base64格式，视为未加密: ${remotePath}`);
      } else {
        try {
          // 尝试将内容转换为ArrayBuffer并解密
          const contentBuffer = await this.base64ToArrayBuffer(content);
          const decryptedBuffer = await plugin.cryptoService.decrypt(
            contentBuffer, 
            plugin.settings.encryption.key
          );
          
          // 转换解密后的内容为字符串
          content = new TextDecoder().decode(decryptedBuffer);
          console.log(`解密成功: ${remotePath}`);
        } catch (decryptError) {
          console.error(`解密失败，可能文件未加密: ${remotePath}`, decryptError);
          // 如果解密失败，使用原始内容（可能文件本来就未加密）
          console.log(`使用原始内容: ${remotePath}`);
        }
      }
    } else if (!plugin.settings.encryption.enabled) {
      console.log(`加密未启用，不尝试解密: ${remotePath}`);
    }
    
    // 写入到本地
    if (typeof content === 'string') {
      await plugin.app.vault.adapter.write(localPath, content);
      console.log(`文件已写入本地: ${localPath}`);
    } else {
      await plugin.app.vault.adapter.writeBinary(localPath, content);
      console.log(`二进制文件已写入本地: ${localPath}`);
    }
  }
  
  /**
   * 将ArrayBuffer转换为Base64字符串
   * @protected
   * @param buffer ArrayBuffer数据
   * @returns Base64编码的字符串
   * @author Bing
   */
  protected async arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
    // 在Web环境中使用原生方法
    const blob = new Blob([buffer]);
    const reader = new FileReader();
    return new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // 移除data URL前缀
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
  /**
   * 将Base64字符串转换为ArrayBuffer
   * @protected
   * @param base64 Base64编码的字符串
   * @returns ArrayBuffer数据
   * @author Bing
   */
  protected async base64ToArrayBuffer(base64: string): Promise<ArrayBuffer> {
    // 检查字符串是否是Base64格式
    const isBase64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(base64);
    if (!isBase64) {
      // 不是Base64，可能是普通文本，直接返回文本的ArrayBuffer
      return new TextEncoder().encode(base64).buffer;
    }
    
    // 是Base64，解码
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
} 