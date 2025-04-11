import { CryptoService, CryptoError } from '@crypto/crypto-service';
import * as CryptoJS from 'crypto-js';

/**
 * AES加密服务实现
 * 使用AES-256加密算法
 * @author Bing
 */
export class AESCryptoService implements CryptoService {
  // 密钥长度(字节)
  private readonly KEY_LENGTH = 16;

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
        throw new CryptoError(`无效的加密密钥，密钥长度必须为${this.KEY_LENGTH}个字符`, 'invalid-key');
      }

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
      return this.wordArrayToArrayBuffer(result);
    } catch (error) {
      if (error instanceof CryptoError) {
        throw error;
      }
      throw new CryptoError('加密失败', 'encryption-failed', error as Error);
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
        throw new CryptoError(`无效的解密密钥，密钥长度必须为${this.KEY_LENGTH}个字符`, 'invalid-key');
      }

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
      return this.wordArrayToArrayBuffer(decrypted);
    } catch (error) {
      if (error instanceof CryptoError) {
        throw error;
      }
      throw new CryptoError('解密失败', 'decryption-failed', error as Error);
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
    return wordArray.toString(CryptoJS.enc.Base64);
  }

  /**
   * 验证密钥是否有效
   * @param key 要验证的密钥
   * @returns 密钥是否有效
   * @author Bing
   */
  validateKey(key: string): boolean {
    // 简单验证密钥长度是否符合要求
    return Boolean(key && key.length === this.KEY_LENGTH);
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
