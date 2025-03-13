import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import { AliDriveSettings } from '../settings';

export class AliDriveService {
  private settings: AliDriveSettings;
  private baseUrl = 'https://api.aliyundrive.com/v2';
  private oauthUrl = 'https://openapi.aliyundrive.com/oauth/authorize';
  private tokenUrl = 'https://openapi.aliyundrive.com/oauth/access_token';
  private driveId: string = '';

  constructor(settings: AliDriveSettings) {
    this.settings = settings;
  }

  async authorize() {
    if (!this.settings.appKey) {
      new Notice('请先设置阿里云盘 App Key');
      return;
    }

    // 构建授权 URL
    const redirectUri = 'https://obsidian.md/callback';
    const authUrl = `${this.oauthUrl}?client_id=${this.settings.appKey}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=user:base,file:all:read,file:all:write`;
    
    // 打开授权页面
    window.open(authUrl, '_blank');
    
    // 这里需要处理授权回调，可以使用本地服务器或手动输入授权码
    const authCode = prompt('请输入阿里云盘授权码：');
    if (!authCode) return;
    
    try {
      // 获取访问令牌
      const tokenResponse = await requestUrl({
        url: this.tokenUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: authCode,
          client_id: this.settings.appKey,
          client_secret: this.settings.appSecret,
          redirect_uri: redirectUri
        })
      });
      
      const data = tokenResponse.json;
      this.settings.accessToken = data.access_token;
      this.settings.refreshToken = data.refresh_token;
      
      // 获取 drive_id
      await this.getDriveId();
      
      new Notice('阿里云盘授权成功');
    } catch (error) {
      console.error('阿里云盘授权失败', error);
      new Notice('阿里云盘授权失败: ' + error.message);
    }
  }

  async refreshToken() {
    if (!this.settings.refreshToken) {
      throw new Error('刷新令牌不存在，请重新授权');
    }
    
    try {
      const response = await requestUrl({
        url: this.tokenUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: this.settings.refreshToken,
          client_id: this.settings.appKey,
          client_secret: this.settings.appSecret
        })
      });
      
      const data = response.json;
      this.settings.accessToken = data.access_token;
      if (data.refresh_token) {
        this.settings.refreshToken = data.refresh_token;
      }
      
      return true;
    } catch (error) {
      console.error('刷新令牌失败', error);
      throw new Error('刷新令牌失败: ' + error.message);
    }
  }

  private async request(params: RequestUrlParam) {
    try {
      if (!this.settings.accessToken) {
        throw new Error('未授权，请先授权阿里云盘');
      }
      
      // 添加访问令牌
      params.headers = {
        ...params.headers || {},
        'Authorization': `Bearer ${this.settings.accessToken}`
      };
      
      return await requestUrl(params);
    } catch (error) {
      // 如果是令牌过期，尝试刷新令牌
      if (error.status === 401) {
        await this.refreshToken();
        // 重试请求
        if (params.headers) {
          params.headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
        }
        return await requestUrl(params);
      }
      throw error;
    }
  }

  async getDriveId() {
    if (this.driveId) return this.driveId;
    
    const response = await this.request({
      url: `${this.baseUrl}/drive/get_default_drive`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    
    this.driveId = response.json.drive_id;
    return this.driveId;
  }

  // 获取文件ID
  async getFileId(path: string): Promise<string | null> {
    try {
      // 分割路径
      const parts = path.split('/').filter(p => p);
      
      // 从根目录开始查找
      let parentId = 'root';
      let currentPath = '';
      
      for (const part of parts) {
        currentPath += '/' + part;
        
        // 查找当前目录下的文件
        const response = await this.request({
          url: `${this.baseUrl}/file/list`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            drive_id: await this.getDriveId(),
            parent_file_id: parentId,
            limit: 100
          })
        });
        
        // 查找匹配的文件
        const file = response.json.items.find((item: any) => item.name === part);
        
        if (!file) {
          // 如果是最后一个部分，说明文件不存在
          if (part === parts[parts.length - 1]) {
            return null;
          }
          
          // 否则创建目录
          const createResponse = await this.request({
            url: `${this.baseUrl}/file/create`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              drive_id: await this.getDriveId(),
              parent_file_id: parentId,
              name: part,
              type: 'folder',
              check_name_mode: 'auto_rename'
            })
          });
          
          parentId = createResponse.json.file_id;
        } else {
          parentId = file.file_id;
        }
      }
      
      return parentId === 'root' ? null : parentId;
    } catch (error) {
      console.error('获取文件ID失败', error);
      return null;
    }
  }

  // 上传文件
  async uploadFile(path: string, content: ArrayBuffer): Promise<void> {
    try {
      // 确保目录存在
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      const fileName = path.substring(path.lastIndexOf('/') + 1);
      
      // 获取父目录ID
      let parentId = 'root';
      if (dirPath) {
        // 确保目录存在
        const parts = dirPath.split('/').filter(p => p);
        if (parts.length > 0) {
          // 从根目录开始创建目录
          let currentPath = '';
          
          for (const part of parts) {
            currentPath += '/' + part;
            
            // 添加重试逻辑获取目录ID
            let dirId = null;
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries && !dirId) {
              try {
                dirId = await this.getFileId(this.settings.syncFolder + currentPath);
                if (dirId) {
                  parentId = dirId;
                  break;
                }
                
                // 创建目录
                const createResponse = await this.request({
                  url: `${this.baseUrl}/file/create`,
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    drive_id: await this.getDriveId(),
                    parent_file_id: parentId,
                    name: part,
                    type: 'folder',
                    check_name_mode: 'auto_rename'
                  })
                });
                
                parentId = createResponse.json.file_id;
                break;
              } catch (error) {
                retryCount++;
                
                // 如果是冲突错误，尝试重新获取目录ID
                if (error.status === 409 || (error.json && error.json.code === 'AlreadyExists')) {
                  try {
                    const retryDirId = await this.getFileId(this.settings.syncFolder + currentPath);
                    if (retryDirId) {
                      parentId = retryDirId;
                      break;
                    }
                  } catch (retryError) {
                    console.warn(`重试获取目录ID失败: ${currentPath}`, retryError);
                  }
                }
                
                if (retryCount >= maxRetries) {
                  console.error(`创建目录失败，已达最大重试次数: ${currentPath}`, error);
                  throw error;
                }
                
                // 等待后重试
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
              }
            }
          }
        }
      }
      
      // 检查文件是否已存在
      const existingFileId = await this.getFileId(this.settings.syncFolder + path);
      if (existingFileId) {
        // 删除已存在的文件
        try {
          await this.deleteFile(path);
          // 等待删除操作完成
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.warn(`删除现有文件失败: ${path}`, error);
          // 继续尝试上传
        }
      }
      
      // 添加重试逻辑
      const maxRetries = 3;
      let retryCount = 0;
      let lastError = null;
      
      while (retryCount < maxRetries) {
        try {
          // 创建上传任务
          const createResponse = await this.request({
            url: `${this.baseUrl}/file/create_with_proof`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              drive_id: await this.getDriveId(),
              parent_file_id: parentId,
              name: fileName,
              type: 'file',
              check_name_mode: 'auto_rename',
              size: content.byteLength,
              content_hash_name: 'none',
              proof_version: 'v1',
              proof_code: ''
            })
          });
          
          const uploadId = createResponse.json.upload_id;
          const fileId = createResponse.json.file_id;
          const partInfoList = createResponse.json.part_info_list || [];
          
          // 分片上传文件内容
          const uploadPromises: Promise<any>[] = [];
          
          if (content.byteLength <= 10485760) { // 小于10MB的文件直接上传
            // 获取上传URL
            const uploadUrl = partInfoList[0]?.upload_url;
            if (!uploadUrl) {
              throw new Error('获取上传URL失败');
            }
            
            // 上传文件内容，添加重试逻辑
            let chunkRetryCount = 0;
            const maxChunkRetries = 3;
            let chunkError = null;
            
            while (chunkRetryCount < maxChunkRetries) {
              try {
                await requestUrl({
                  url: uploadUrl,
                  method: 'PUT',
                  body: content
                });
                break;
              } catch (error) {
                chunkError = error;
                chunkRetryCount++;
                
                if (chunkRetryCount >= maxChunkRetries) {
                  throw new Error(`上传文件内容失败: ${error.message}`);
                }
                
                // 等待后重试
                await new Promise(resolve => setTimeout(resolve, 1000 * chunkRetryCount));
              }
            }
          } else {
            // 大文件分片上传
            const chunkSize = 10485760; // 10MB
            const chunks = Math.ceil(content.byteLength / chunkSize);
            
            for (let i = 0; i < chunks; i++) {
              const start = i * chunkSize;
              const end = Math.min(start + chunkSize, content.byteLength);
              const chunk = content.slice(start, end);
              
              // 获取上传URL
              const uploadUrl = partInfoList[i]?.upload_url;
              if (!uploadUrl) {
                throw new Error(`获取第${i+1}片上传URL失败`);
              }
              
              // 上传分片，添加重试逻辑
              uploadPromises.push(
                (async () => {
                  let chunkRetryCount = 0;
                  const maxChunkRetries = 3;
                  
                  while (chunkRetryCount < maxChunkRetries) {
                    try {
                      await requestUrl({
                        url: uploadUrl,
                        method: 'PUT',
                        body: chunk
                      });
                      return;
                    } catch (error) {
                      chunkRetryCount++;
                      
                      if (chunkRetryCount >= maxChunkRetries) {
                        console.error(`上传分片${i+1}失败，已达最大重试次数`, error);
                        throw new Error(`上传分片${i+1}失败: ${error.message}`);
                      }
                      
                      // 等待后重试
                      await new Promise(resolve => setTimeout(resolve, 1000 * chunkRetryCount));
                    }
                  }
                })()
              );
            }
            
            await Promise.all(uploadPromises);
          }
          
          // 完成上传
          const completeResponse = await this.request({
            url: `${this.baseUrl}/file/complete`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              drive_id: await this.getDriveId(),
              file_id: fileId,
              upload_id: uploadId
            })
          });
          
          return;
        } catch (error) {
          lastError = error;
          retryCount++;
          
          console.warn(`上传失败，尝试重试 (${retryCount}/${maxRetries}): ${path}`, error);
          
          // 等待一段时间后重试
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
          }
        }
      }
      
      // 所有重试都失败
      throw lastError || new Error('上传文件失败: 未知错误');
    } catch (error) {
      console.error('上传文件失败', error);
      throw new Error('上传文件失败: ' + error.message);
    }
  }

  // 下载文件
  async downloadFile(filePath: string): Promise<ArrayBuffer> {
    try {
      // 获取文件ID
      const fileId = await this.getFileId(this.settings.syncFolder + filePath);
      if (!fileId) {
        throw new Error(`文件不存在: ${filePath}`);
      }
      
      // 获取下载URL
      const response = await this.request({
        url: `${this.baseUrl}/file/get_download_url`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          drive_id: await this.getDriveId(),
          file_id: fileId
        })
      });
      
      const downloadUrl = response.json.url;
      
      // 下载文件
      const downloadResponse = await requestUrl({
        url: downloadUrl,
        method: 'GET'
      });
      
      return downloadResponse.arrayBuffer;
    } catch (error) {
      console.error('下载文件失败', error);
      throw new Error('下载文件失败: ' + error.message);
    }
  }

  // 删除文件
  async deleteFile(filePath: string): Promise<any> {
    try {
      // 获取文件ID
      const fileId = await this.getFileId(this.settings.syncFolder + filePath);
      if (!fileId) {
        return { success: true }; // 文件不存在，视为删除成功
      }
      
      // 删除文件
      const response = await this.request({
        url: `${this.baseUrl}/file/delete`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          drive_id: await this.getDriveId(),
          file_id: fileId
        })
      });
      
      return response.json;
    } catch (error) {
      console.error('删除文件失败', error);
      throw new Error('删除文件失败: ' + error.message);
    }
  }

  // 重命名文件
  async renameFile(oldPath: string, newPath: string): Promise<any> {
    try {
      // 获取文件ID
      const fileId = await this.getFileId(this.settings.syncFolder + oldPath);
      if (!fileId) {
        throw new Error(`文件不存在: ${oldPath}`);
      }
      
      // 提取新文件名
      const newName = newPath.split('/').pop();
      
      // 重命名文件
      const response = await this.request({
        url: `${this.baseUrl}/file/update`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          drive_id: await this.getDriveId(),
          file_id: fileId,
          name: newName
        })
      });
      
      return response.json;
    } catch (error) {
      console.error('重命名文件失败', error);
      throw new Error('重命名文件失败: ' + error.message);
    }
  }

  // 列出文件
  async listFiles(dirPath: string = '/'): Promise<any[]> {
    try {
      // 获取目录ID
      const dirId = await this.getFileId(this.settings.syncFolder + dirPath);
      if (!dirId) {
        return [];
      }
      
      // 列出文件
      const response = await this.request({
        url: `${this.baseUrl}/file/list`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          drive_id: await this.getDriveId(),
          parent_file_id: dirId,
          limit: 100
        })
      });
      
      return response.json.items || [];
    } catch (error) {
      console.error('列出文件失败', error);
      return [];
    }
  }
} 