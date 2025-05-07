import { CryptoService, CryptoError } from '@crypto/crypto-service';
import * as CryptoJS from 'crypto-js';
import { ModuleLogger } from '@services/log/log-service';
import CloudSyncPlugin from '@main';

/**
 * AES加密服务实现
 * 使用AES-256加密算法
 * @author Bing
 */
export class AESCryptoService implements CryptoService {
  // 密钥长度(字节)
  private readonly KEY_LENGTH = 16;
  private logger: ModuleLogger | null = null;

  /**
   * 构造函数
   * @param plugin 可选，插件实例，用于获取日志服务
   */
  constructor(plugin?: CloudSyncPlugin) {
    if (plugin && plugin.logService) {
      this.logger = plugin.logService.getModuleLogger('AESCryptoService');
    }
  }

  /**
   * 加密文件内容
   * @param content 要加密的内容
   * @param key 加密密钥
   * @returns 加密后的内容
   * @author Bing
   */
  async encrypt(content: ArrayBuffer, key: string): Promise<ArrayBuffer> {
    try {
      // 验证密钥
      if (!this.validateKey(key)) {
        const error = new CryptoError(`无效的加密密钥，密钥长度必须为${this.KEY_LENGTH}个字符`, 'invalid-key');
        this.logger?.error('加密失败: 无效的密钥', error);
        throw error;
      }

      this.logger?.info(`开始加密内容, 大小: ${content.byteLength} 字节`);

      // 生成随机初始化向量(IV)
      const iv = CryptoJS.lib.WordArray.random(16);
      
      // 将ArrayBuffer转换为WordArray
      const contentWordArray = this.arrayBufferToWordArray(content);
      
      // 加密
      const encrypted = CryptoJS.AES.encrypt(contentWordArray, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      
      // 将IV与加密数据合并，以便解密时可以提取
      const result = CryptoJS.lib.WordArray.create()
        .concat(iv)
        .concat(encrypted.ciphertext);
      
      // 返回加密后的ArrayBuffer
      const resultBuffer = this.wordArrayToArrayBuffer(result);
      this.logger?.info(`加密完成, 加密后大小: ${resultBuffer.byteLength} 字节`);
      return resultBuffer;
    } catch (error) {
      if (error instanceof CryptoError) {
        throw error;
      }
      const cryptoError = new CryptoError('加密失败', 'encryption-failed', error as Error);
      this.logger?.error('加密过程中发生错误', cryptoError);
      throw cryptoError;
    }
  }

  /**
   * 解密文件内容
   * @param encryptedContent 要解密的内容
   * @param key 解密密钥
   * @returns 解密后的内容
   * @author Bing
   */
  async decrypt(encryptedContent: ArrayBuffer, key: string): Promise<ArrayBuffer> {
    try {
      // 验证密钥
      if (!this.validateKey(key)) {
        const error = new CryptoError(`无效的解密密钥，密钥长度必须为${this.KEY_LENGTH}个字符`, 'invalid-key');
        this.logger?.error('解密失败: 无效的密钥', error);
        throw error;
      }

      this.logger?.info(`开始解密内容, 大小: ${encryptedContent.byteLength} 字节`);

      // 将ArrayBuffer转换为WordArray
      const encryptedWordArray = this.arrayBufferToWordArray(encryptedContent);
      
      // 提取IV（前16字节）
      const iv = CryptoJS.lib.WordArray.create(
        encryptedWordArray.words.slice(0, 4),
        16
      );
      
      // 提取加密数据（剩余部分）
      const ciphertext = CryptoJS.lib.WordArray.create(
        encryptedWordArray.words.slice(4),
        encryptedWordArray.sigBytes - 16
      );
      
      // 创建CipherParams对象
      const cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: ciphertext
      });
      
      // 解密
      const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      
      // 返回解密后的ArrayBuffer
      const resultBuffer = this.wordArrayToArrayBuffer(decrypted);
      this.logger?.info(`解密完成, 解密后大小: ${resultBuffer.byteLength} 字节`);
      return resultBuffer;
    } catch (error) {
      if (error instanceof CryptoError) {
        throw error;
      }
      const cryptoError = new CryptoError('解密失败', 'decryption-failed', error as Error);
      this.logger?.error('解密过程中发生错误', cryptoError);
      throw cryptoError;
    }
  }

  /**
   * 生成随机加密密钥
   * @returns 生成的密钥
   * @author Bing
   */
  generateKey(): string {
    // 生成一个16字节的随机密钥
    const wordArray = CryptoJS.lib.WordArray.random(this.KEY_LENGTH);
    const key = wordArray.toString(CryptoJS.enc.Base64);
    this.logger?.info('生成了新的加密密钥');
    return key;
  }

  /**
   * 验证密钥是否有效
   * @param key 要验证的密钥
   * @returns 密钥是否有效
   * @author Bing
   */
  validateKey(key: string): boolean {
    // 简单验证密钥长度是否符合要求
    const isValid = Boolean(key && key.length === this.KEY_LENGTH);
    if (!isValid) {
      this.logger?.warning(`密钥验证失败，长度不符: ${key?.length || 0} != ${this.KEY_LENGTH}`);
    }
    return isValid;
  }

  /**
   * 将ArrayBuffer转换为WordArray
   * @param arrayBuffer ArrayBuffer对象
   * @returns WordArray对象
   * @author Bing
   */
  private arrayBufferToWordArray(arrayBuffer: ArrayBuffer): CryptoJS.lib.WordArray {
    const u8arr = new Uint8Array(arrayBuffer);
    const words: number[] = [];
    for (let i = 0; i < u8arr.length; i += 4) {
      words.push(
        ((u8arr[i] || 0) << 24) |
        ((u8arr[i + 1] || 0) << 16) |
        ((u8arr[i + 2] || 0) << 8) |
        (u8arr[i + 3] || 0)
      );
    }
    return CryptoJS.lib.WordArray.create(words, u8arr.length);
  }

  /**
   * 将WordArray转换为ArrayBuffer
   * @param wordArray WordArray对象
   * @returns ArrayBuffer对象
   * @author Bing
   */
  private wordArrayToArrayBuffer(wordArray: CryptoJS.lib.WordArray): ArrayBuffer {
    const words = wordArray.words;
    const sigBytes = wordArray.sigBytes;
    const u8arr = new Uint8Array(sigBytes);
    for (let i = 0; i < sigBytes; i++) {
      const byte = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
      u8arr[i] = byte;
    }
    return u8arr.buffer;
  }
} 
