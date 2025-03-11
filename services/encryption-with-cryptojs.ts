import * as CryptoJS from 'crypto-js';

export class EncryptionService {
  private key: string;

  constructor(key: string) {
    this.key = key || 'default-encryption-key';
  }

  // 更新加密密钥
  updateKey(newKey: string) {
    this.key = newKey || 'default-encryption-key';
  }

  // 自定义 arrayBufferToBase64 函数
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  // 自定义 base64ToArrayBuffer 函数
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // 使用 CryptoJS 进行 AES 加密
  async encrypt(data: ArrayBuffer): Promise<string> {
    try {
      // 将 ArrayBuffer 转换为 Base64 字符串
      const base64 = this.arrayBufferToBase64(data);
      
      // 使用 CryptoJS 进行 AES 加密
      const encrypted = CryptoJS.AES.encrypt(base64, this.key).toString();
      
      return encrypted;
    } catch (error) {
      console.error('加密失败:', error);
      throw new Error('加密失败: ' + error.message);
    }
  }

  // 使用 CryptoJS 进行 AES 解密
  async decrypt(encryptedText: string): Promise<ArrayBuffer> {
    try {
      // 使用 CryptoJS 进行 AES 解密
      const decrypted = CryptoJS.AES.decrypt(encryptedText, this.key).toString(CryptoJS.enc.Utf8);
      
      // 将解密后的 Base64 字符串转换为 ArrayBuffer
      return this.base64ToArrayBuffer(decrypted);
    } catch (error) {
      console.error('解密失败:', error);
      throw new Error('解密失败: ' + error.message);
    }
  }
} 