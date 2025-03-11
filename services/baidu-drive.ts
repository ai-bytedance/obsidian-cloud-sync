import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import { BaiduDriveSettings } from '../settings';

export class BaiduDriveService {
  private settings: BaiduDriveSettings;
  private baseUrl = 'https://pan.baidu.com/rest/2.0/xpan';
  private oauthUrl = 'https://openapi.baidu.com/oauth/2.0';
  private authWindow: Window | null = null;

  constructor(settings: BaiduDriveSettings) {
    this.settings = settings;
  }

  async authorize() {
    if (!this.settings.appKey) {
      new Notice('请先设置百度网盘 App Key');
      return;
    }

    // 构建授权 URL
    const redirectUri = 'https://obsidian.md/callback';
    const authUrl = `${this.oauthUrl}/authorize?response_type=code&client_id=${this.settings.appKey}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=basic,netdisk&display=popup`;
    
    // 打开授权窗口
    this.authWindow = window.open(authUrl, 'baiduAuth', 'width=800,height=600');
    
    // 监听消息
    window.addEventListener('message', this.handleAuthCallback.bind(this), { once: true });
    
    new Notice('请在打开的窗口中完成百度网盘授权');
  }

  private async handleAuthCallback(event: MessageEvent) {
    if (event.origin !== window.location.origin) {
      return;
    }
    
    if (this.authWindow) {
      this.authWindow.close();
      this.authWindow = null;
    }
    
    const { code, error } = event.data;
    
    if (error) {
      new Notice(`百度网盘授权失败: ${error}`);
      return;
    }
    
    if (!code) {
      new Notice('百度网盘授权失败: 未收到授权码');
      return;
    }
    
    try {
      // 获取访问令牌
      await this.getAccessToken(code);
      new Notice('百度网盘授权成功');
    } catch (error) {
      new Notice(`百度网盘授权失败: ${error.message}`);
    }
  }

  private async getAccessToken(code: string) {
    const tokenUrl = 'https://openapi.baidu.com/oauth/2.0/token';
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.settings.appKey,
      client_secret: this.settings.appSecret,
      redirect_uri: this.settings.redirectUri
    });
    
    const response = await requestUrl({
      url: `${tokenUrl}?${params.toString()}`,
      method: 'GET'
    });
    
    const data = response.json;
    
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }
    
    this.settings.accessToken = data.access_token;
    this.settings.refreshToken = data.refresh_token;
    this.settings.expiresAt = Date.now() + data.expires_in * 1000;
    
    // 保存设置
    // 注意：这里需要通过插件实例保存设置
    // 这里假设会在外部调用 saveSettings 方法
  }

  async refreshToken() {
    if (!this.settings.refreshToken) {
      throw new Error('刷新令牌不存在，请重新授权');
    }
    
    try {
      const response = await requestUrl({
        url: `${this.oauthUrl}/token`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.settings.refreshToken,
          client_id: this.settings.appKey,
          client_secret: this.settings.appSecret
        }).toString()
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
        throw new Error('未授权，请先授权百度网盘');
      }
      
      // 添加访问令牌
      if (!params.url.includes('?')) {
        params.url += '?';
      } else {
        params.url += '&';
      }
      params.url += `access_token=${this.settings.accessToken}`;
      
      return await requestUrl(params);
    } catch (error) {
      // 如果是令牌过期，尝试刷新令牌
      if (error.status === 401) {
        await this.refreshToken();
        // 重试请求
        if (params.url.includes('access_token=')) {
          params.url = params.url.replace(/access_token=([^&]*)/, `access_token=${this.settings.accessToken}`);
        } else {
          if (!params.url.includes('?')) {
            params.url += '?';
          } else {
            params.url += '&';
          }
          params.url += `access_token=${this.settings.accessToken}`;
        }
        return await requestUrl(params);
      }
      throw error;
    }
  }

  // 确保目录存在
  private async ensureDir(dirPath: string) {
    // 分割路径
    const parts = dirPath.split('/').filter(p => p);
    let currentPath = '';
    
    for (const part of parts) {
      currentPath += '/' + part;
      
      try {
        // 检查目录是否存在
        const response = await this.request({
          url: `${this.baseUrl}/file?method=fileinfo&path=${encodeURIComponent(currentPath)}`,
          method: 'GET'
        });
        
        // 如果目录存在，继续下一个
        if (response.json.isdir === 1) {
          continue;
        }
      } catch (error) {
        // 目录不存在，创建它
        await this.request({
          url: `${this.baseUrl}/file?method=create`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            path: currentPath,
            isdir: '1'
          }).toString()
        });
      }
    }
    
    return currentPath;
  }

  // 上传文件
  async uploadFile(path: string, content: ArrayBuffer): Promise<void> {
    try {
      // 确保目录存在
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      await this.ensureDir(this.settings.syncFolder + dirPath);
      
      // 预创建文件
      const preCreateResponse = await this.request({
        url: `${this.baseUrl}/file?method=precreate`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          path: this.settings.syncFolder + path,
          size: content.byteLength.toString(),
          isdir: '0',
          autoinit: '1',
          rtype: '3' // 覆盖同名文件
        }).toString()
      });
      
      const uploadid = preCreateResponse.json.uploadid;
      
      // 分片上传
      const chunkSize = 4194304; // 4MB
      const chunks = Math.ceil(content.byteLength / chunkSize);
      
      const blockList: string[] = [];
      
      for (let i = 0; i < chunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, content.byteLength);
        const chunk = content.slice(start, end);
        
        // 上传分片
        await this.request({
          url: `${this.baseUrl}/file?method=upload&type=tmpfile&path=${encodeURIComponent(this.settings.syncFolder + path)}&uploadid=${uploadid}&partseq=${i}`,
          method: 'POST',
          body: chunk,
          headers: {
            'Content-Type': 'application/octet-stream'
          },
          contentType: 'application/octet-stream'
        });
        
        blockList.push(i.toString());
      }
      
      // 创建文件
      const createResponse = await this.request({
        url: `${this.baseUrl}/file?method=create`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          path: this.settings.syncFolder + path,
          size: content.byteLength.toString(),
          isdir: '0',
          uploadid: uploadid,
          block_list: JSON.stringify(blockList),
          rtype: '3' // 覆盖同名文件
        }).toString()
      });
      
      return createResponse.json;
    } catch (error) {
      console.error('上传文件失败', error);
      throw new Error('上传文件失败: ' + error.message);
    }
  }

  // 下载文件
  async downloadFile(filePath: string): Promise<ArrayBuffer> {
    const response = await this.request({
      url: `${this.baseUrl}/file?method=download&path=${encodeURIComponent(this.settings.syncFolder + filePath)}`,
      method: 'GET'
    });
    
    return response.arrayBuffer;
  }

  // 删除文件
  async deleteFile(filePath: string): Promise<any> {
    const response = await this.request({
      url: `${this.baseUrl}/file?method=filemanager&opera=delete`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        async: '0',
        filelist: JSON.stringify([this.settings.syncFolder + filePath])
      }).toString()
    });
    
    return response.json;
  }

  // 列出文件
  async listFiles(dirPath: string = '/'): Promise<any[]> {
    const response = await this.request({
      url: `${this.baseUrl}/file?method=list&dir=${encodeURIComponent(this.settings.syncFolder + dirPath)}`,
      method: 'GET'
    });
    
    return response.json.list || [];
  }

  // 重命名文件
  async renameFile(oldPath: string, newPath: string): Promise<any> {
    const response = await this.request({
      url: `${this.baseUrl}/file?method=filemanager&opera=rename`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        async: '0',
        filelist: JSON.stringify([{
          path: this.settings.syncFolder + oldPath,
          newname: newPath.split('/').pop()
        }])
      }).toString()
    });
    
    return response.json;
  }
} 