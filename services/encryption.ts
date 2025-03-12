import CryptoJS from 'crypto-js';

export class EncryptionService {
  private key: string;

  constructor(key: string) {
    this.key = key || 'default-key';
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

  // 加密方法 - 支持字符串和 ArrayBuffer 输入
  async encrypt(data: string | ArrayBuffer): Promise<string> {
    try {
      let dataStr: string;
      
      if (data instanceof ArrayBuffer) {
        // 将 ArrayBuffer 转换为字符串
        dataStr = this.arrayBufferToString(data);
      } else {
        dataStr = data;
      }
      
      // 使用 AES 加密
      const encrypted = CryptoJS.AES.encrypt(dataStr, this.key).toString();
      return encrypted;
    } catch (error) {
      console.error('加密失败', error);
      throw new Error('加密失败: ' + error.message);
    }
  }

  // 解密方法
  async decrypt(encryptedData: string): Promise<ArrayBuffer> {
    try {
      // 使用 AES 解密
      const decrypted = CryptoJS.AES.decrypt(encryptedData, this.key).toString(CryptoJS.enc.Utf8);
      
      // 将解密后的字符串转换为 ArrayBuffer
      return this.stringToArrayBuffer(decrypted);
    } catch (error) {
      console.error('解密失败', error);
      throw new Error('解密失败: ' + error.message);
    }
  }

  // 辅助方法：将 ArrayBuffer 转换为字符串
  private arrayBufferToString(buffer: ArrayBuffer): string {
    const uint8Array = new Uint8Array(buffer);
    let result = '';
    for (let i = 0; i < uint8Array.length; i++) {
      result += String.fromCharCode(uint8Array[i]);
    }
    return result;
  }

  // 辅助方法：将字符串转换为 ArrayBuffer
  private stringToArrayBuffer(str: string): ArrayBuffer {
    const encoder = new TextEncoder();
    return encoder.encode(str).buffer;
  }
} 