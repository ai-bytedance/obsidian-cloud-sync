import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import { ICloudDriveSettings } from '../settings';

export class ICloudDriveService {
  private settings: ICloudDriveSettings;
  private baseUrl = 'https://api.apple-cloudkit.com';
  private container: string;
  private environment: string;
  
  constructor(settings: ICloudDriveSettings) {
    this.settings = settings;
    this.container = settings.container || 'com.obsidian.cloudsync';
    this.environment = settings.environment || 'production';
  }

  async authorize() {
    if (!this.settings.apiToken) {
      new Notice('请先设置 iCloud API Token');
      return;
    }
    
    try {
      // 验证 API Token
      await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/public/users/current`,
        method: 'GET'
      });
      
      new Notice('iCloud 授权成功');
      return true;
    } catch (error) {
      console.error('iCloud 授权失败', error);
      new Notice('iCloud 授权失败: ' + error.message);
      return false;
    }
  }

  // iCloud 不需要刷新令牌
  async refreshToken() {
    return true;
  }

  private async request(params: RequestUrlParam) {
    if (!this.settings.apiToken) {
      throw new Error('未设置 iCloud API Token');
    }
    
    // 添加认证头
    params.headers = {
      ...params.headers || {},
      'Authorization': `Bearer ${this.settings.apiToken}`,
      'X-Apple-CloudKit-Request-KeyID': this.settings.keyId || '',
      'X-Apple-CloudKit-Request-ISO8601Date': new Date().toISOString()
    };
    
    return await requestUrl(params);
  }

  // 获取或创建记录
  private async getOrCreateRecord(path: string, isDirectory: boolean = false): Promise<string> {
    try {
      // 查询记录
      const queryResponse = await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/records/query`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: {
            recordType: 'Files',
            filterBy: [
              {
                fieldName: 'path',
                comparator: 'EQUALS',
                fieldValue: {
                  value: this.settings.syncFolder + path
                }
              }
            ]
          }
        })
      });
      
      if (queryResponse.json.records && queryResponse.json.records.length > 0) {
        return queryResponse.json.records[0].recordName;
      }
      
      // 创建记录
      const createResponse = await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/records/modify`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operations: [
            {
              operationType: 'create',
              record: {
                recordType: 'Files',
                fields: {
                  path: {
                    value: this.settings.syncFolder + path
                  },
                  isDirectory: {
                    value: isDirectory ? 1 : 0
                  }
                }
              }
            }
          ]
        })
      });
      
      return createResponse.json.records[0].recordName;
    } catch (error) {
      console.error('获取或创建记录失败', error);
      throw new Error('获取或创建记录失败: ' + error.message);
    }
  }

  // 确保目录存在
  private async ensureDir(dirPath: string) {
    // 分割路径
    const parts = dirPath.split('/').filter(p => p);
    let currentPath = '';
    
    for (const part of parts) {
      currentPath += '/' + part;
      await this.getOrCreateRecord(currentPath, true);
    }
    
    return currentPath;
  }

  // 上传文件
  async uploadFile(path: string, content: ArrayBuffer): Promise<void> {
    try {
      // 确保目录存在
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      await this.ensureDir(dirPath);
      
      // 获取或创建文件记录
      const recordName = await this.getOrCreateRecord(path);
      
      // 上传文件内容
      const asset = {
        fileChecksum: this.calculateChecksum(content),
        size: content.byteLength,
        wrappingKey: this.generateWrappingKey(),
        referenceChecksum: this.calculateReferenceChecksum(recordName)
      };
      
      // 获取上传 URL
      const tokenResponse = await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/assets/upload`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tokens: [
            {
              recordName,
              fieldName: 'content',
              ...asset
            }
          ]
        })
      });
      
      const uploadUrl = tokenResponse.json.tokens[0].url;
      
      // 上传文件内容
      await requestUrl({
        url: uploadUrl,
        method: 'POST',
        body: content
      });
      
      // 更新记录
      await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/records/modify`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operations: [
            {
              operationType: 'update',
              record: {
                recordName,
                recordType: 'Files',
                fields: {
                  content: {
                    value: {
                      fileChecksum: asset.fileChecksum,
                      size: asset.size,
                      wrappingKey: asset.wrappingKey,
                      referenceChecksum: asset.referenceChecksum
                    }
                  },
                  modifiedAt: {
                    value: new Date().toISOString()
                  }
                }
              }
            }
          ]
        })
      });
    } catch (error) {
      console.error('上传文件失败', error);
      throw new Error('上传文件失败: ' + error.message);
    }
  }

  // 下载文件
  async downloadFile(filePath: string): Promise<ArrayBuffer> {
    try {
      // 查询记录
      const queryResponse = await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/records/query`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: {
            recordType: 'Files',
            filterBy: [
              {
                fieldName: 'path',
                comparator: 'EQUALS',
                fieldValue: {
                  value: this.settings.syncFolder + filePath
                }
              }
            ]
          },
          desiredFields: ['content']
        })
      });
      
      if (!queryResponse.json.records || queryResponse.json.records.length === 0) {
        throw new Error(`文件不存在: ${filePath}`);
      }
      
      const record = queryResponse.json.records[0];
      const content = record.fields.content;
      
      if (!content || !content.value) {
        throw new Error(`文件内容为空: ${filePath}`);
      }
      
      // 获取下载 URL
      const tokenResponse = await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/assets/download`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tokens: [
            {
              recordName: record.recordName,
              fieldName: 'content'
            }
          ]
        })
      });
      
      const downloadUrl = tokenResponse.json.tokens[0].url;
      
      // 下载文件内容
      const response = await requestUrl({
        url: downloadUrl,
        method: 'GET'
      });
      
      return response.arrayBuffer;
    } catch (error) {
      console.error('下载文件失败', error);
      throw new Error('下载文件失败: ' + error.message);
    }
  }

  // 删除文件
  async deleteFile(filePath: string): Promise<any> {
    try {
      // 查询记录
      const queryResponse = await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/records/query`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: {
            recordType: 'Files',
            filterBy: [
              {
                fieldName: 'path',
                comparator: 'EQUALS',
                fieldValue: {
                  value: this.settings.syncFolder + filePath
                }
              }
            ]
          }
        })
      });
      
      if (!queryResponse.json.records || queryResponse.json.records.length === 0) {
        return { success: true }; // 文件不存在，视为删除成功
      }
      
      const recordName = queryResponse.json.records[0].recordName;
      
      // 删除记录
      await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/records/modify`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operations: [
            {
              operationType: 'delete',
              record: {
                recordName
              }
            }
          ]
        })
      });
      
      return { success: true };
    } catch (error) {
      console.error('删除文件失败', error);
      throw new Error('删除文件失败: ' + error.message);
    }
  }

  // 重命名文件
  async renameFile(oldPath: string, newPath: string): Promise<any> {
    try {
      // 查询记录
      const queryResponse = await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/records/query`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: {
            recordType: 'Files',
            filterBy: [
              {
                fieldName: 'path',
                comparator: 'EQUALS',
                fieldValue: {
                  value: this.settings.syncFolder + oldPath
                }
              }
            ]
          }
        })
      });
      
      if (!queryResponse.json.records || queryResponse.json.records.length === 0) {
        throw new Error(`文件不存在: ${oldPath}`);
      }
      
      const record = queryResponse.json.records[0];
      
      // 更新记录
      await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/records/modify`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operations: [
            {
              operationType: 'update',
              record: {
                recordName: record.recordName,
                recordType: 'Files',
                fields: {
                  path: {
                    value: this.settings.syncFolder + newPath
                  },
                  modifiedAt: {
                    value: new Date().toISOString()
                  }
                }
              }
            }
          ]
        })
      });
      
      return { success: true };
    } catch (error) {
      console.error('重命名文件失败', error);
      throw new Error('重命名文件失败: ' + error.message);
    }
  }

  // 列出文件
  async listFiles(dirPath: string = '/'): Promise<any[]> {
    try {
      // 查询记录
      const queryResponse = await this.request({
        url: `${this.baseUrl}/database/1/${this.container}/${this.environment}/private/records/query`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: {
            recordType: 'Files',
            filterBy: [
              {
                fieldName: 'path',
                comparator: 'BEGINS_WITH',
                fieldValue: {
                  value: this.settings.syncFolder + dirPath
                }
              }
            ]
          }
        })
      });
      
      if (!queryResponse.json.records) {
        return [];
      }
      
      // 过滤出当前目录下的文件和文件夹
      const prefix = this.settings.syncFolder + dirPath;
      return queryResponse.json.records
        .filter((record: any) => {
          const path = record.fields.path.value;
          if (path === prefix) return false; // 排除当前目录
          
          // 只包含直接子文件和子文件夹
          const relativePath = path.substring(prefix.length);
          return !relativePath.substring(1).includes('/');
        })
        .map((record: any) => ({
          path: record.fields.path.value.substring(this.settings.syncFolder.length),
          isdir: record.fields.isDirectory?.value === 1 ? 1 : 0,
          recordName: record.recordName
        }));
    } catch (error) {
      console.error('列出文件失败', error);
      return [];
    }
  }

  // 辅助方法：计算文件校验和
  private calculateChecksum(data: ArrayBuffer): string {
    // 简单实现，实际应使用 SHA-256
    let hash = 0;
    const bytes = new Uint8Array(data);
    for (let i = 0; i < bytes.length; i++) {
      hash = ((hash << 5) - hash) + bytes[i];
      hash |= 0; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  // 辅助方法：生成包装密钥
  private generateWrappingKey(): string {
    // 简单实现，实际应生成随机密钥
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // 辅助方法：计算引用校验和
  private calculateReferenceChecksum(recordName: string): string {
    // 简单实现
    let hash = 0;
    for (let i = 0; i < recordName.length; i++) {
      hash = ((hash << 5) - hash) + recordName.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16);
  }
} 