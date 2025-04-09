/**
 * 加密服务错误
 */
export class CryptoError extends Error {
  public readonly code: string;
  public readonly originalError?: Error;

  constructor(message: string, code: string, originalError?: Error) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
    this.originalError = originalError;

    // 确保正确的原型链
    Object.setPrototypeOf(this, CryptoError.prototype);
  }
}

/**
 * 加密服务接口
 * 这个接口定义了插件所需的加密功能
 */
export interface CryptoService {
  /**
   * 加密文件内容
   * @param content 要加密的内容
   * @param key 加密密钥
   * @returns 加密后的内容
   */
  encrypt(content: ArrayBuffer, key: string): Promise<ArrayBuffer>;
  
  /**
   * 解密文件内容
   * @param encryptedContent 要解密的内容
   * @param key 解密密钥
   * @returns 解密后的内容
   */
  decrypt(encryptedContent: ArrayBuffer, key: string): Promise<ArrayBuffer>;
  
  /**
   * 生成随机加密密钥
   * @returns 生成的密钥
   */
  generateKey(): string;
  
  /**
   * 验证密钥是否有效
   * @param key 要验证的密钥
   * @returns 密钥是否有效
   */
  validateKey(key: string): boolean;
} 