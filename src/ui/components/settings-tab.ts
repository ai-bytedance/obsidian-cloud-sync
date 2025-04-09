import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import CloudSyncPlugin from '../../../main';
import { PluginSettings, WebDAVSettings } from '../../models/plugin-settings';
import { WebDAVProvider } from '../../services/storage/webdav-provider';
import { ConnectionStatus } from '../../services/storage/storage-provider';
import { ConflictPolicy, SyncDirection, SyncMode } from '../../models/plugin-settings';

export class CloudSyncSettingTab extends PluginSettingTab {
  plugin: CloudSyncPlugin;
  tempSettings: PluginSettings;
  testingConnection: boolean = false;

  constructor(app: App, plugin: CloudSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;

    // 克隆设置对象以便取消时恢复
    this.tempSettings = JSON.parse(JSON.stringify(this.plugin.settings));
    
    // 调试日志：输出初始化的tempSettings值
    console.log('CloudSyncSettingTab - 初始化的tempSettings:', {
      syncMode: this.tempSettings.syncMode,
      syncDirection: this.tempSettings.syncDirection
    });
    
    // 确保同步模式和同步方向有有效值
    if (!this.tempSettings.syncMode) {
      console.log('同步模式无效，设置为默认值: incremental');
      this.tempSettings.syncMode = 'incremental';
    }
    
    if (!this.tempSettings.syncDirection) {
      console.log('同步方向无效，设置为默认值: bidirectional');
      this.tempSettings.syncDirection = 'bidirectional';
    }

    // 清除现有内容
    containerEl.empty();

    // 添加标题
    containerEl.createEl('h2', { text: 'Cloud Sync 设置' });

    // 创建通用设置部分
    this.createGeneralSection(containerEl);

    // 创建云盘选择部分
    this.createCloudProvidersSection(containerEl);

    // 创建WebDAV设置部分 (如果启用)
    if (this.tempSettings.enabledProviders.includes('webdav')) {
      this.createWebDAVSection(containerEl);
    }

    // 创建高级设置部分
    this.createAdvancedSection(containerEl);
  }

  // 通用设置部分
  createGeneralSection(containerEl: HTMLElement): void {
    const generalSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
    
    generalSection.createEl('h3', { text: '通用设置' });
    
    // 保存启用同步开关的引用
    let enableSyncToggleRef: any;

    // 启用同步设置
    new Setting(generalSection)
      .setName('启用同步')
      .setDesc('在Obsidian启动时自动同步，并按照设定的时间间隔自动同步')
      .addToggle(toggle => {
        // 保存引用以便后续使用
        enableSyncToggleRef = toggle;
        
        return toggle
          .setValue(this.tempSettings.enableSync)
          .onChange(async (value) => {
            this.tempSettings.enableSync = value;
            
            // 如果禁用同步，同步间隔设置为0
            if (!value && this.tempSettings.syncInterval > 0) {
              this.tempSettings.syncInterval = 0;
              
              // 更新滑动条和输入框显示
              if (textComponentRef) {
                textComponentRef.setValue("0");
              }
              if (valueDisplayEl) {
                valueDisplayEl.setText("0");
              }
            }
            
            // 如果启用同步且同步间隔为0，设置为默认值5
            if (value && this.tempSettings.syncInterval === 0) {
              this.tempSettings.syncInterval = 5;
              
              // 更新滑动条和输入框显示
              if (textComponentRef) {
                textComponentRef.setValue("5");
              }
              if (valueDisplayEl) {
                valueDisplayEl.setText("5");
              }
            }
            
            await this.plugin.saveSettings(this.tempSettings);
          });
      });
    
    // 同步间隔设置
    const syncIntervalSetting = new Setting(generalSection)
      .setName('同步间隔')
      .setDesc('设置同步间隔时间（分钟，0表示禁用自动同步）');
    
    // 添加数值显示元素
    const valueDisplayEl = syncIntervalSetting.controlEl.createEl("span", {
      cls: "sync-interval-display",
      text: `${this.tempSettings.syncInterval}`
    });
    valueDisplayEl.style.marginRight = "10px";
    
    // 添加滑动条和文本输入框
    // 保存文本组件引用
    let textComponentRef: any;
    // 保存滑动条实例的引用
    let sliderComponentRef: any;

    syncIntervalSetting.addSlider(slider => {
      // 保存滑动条实例
      const sliderComponent = slider
        .setLimits(0, 60, 1)
        .setValue(this.tempSettings.syncInterval)
        .setDynamicTooltip();
      
      // 保存滑动条引用以供文本输入框使用
      sliderComponentRef = sliderComponent;
      
      // 处理值变化事件
      sliderComponent.onChange(async (value) => {
        // 立即更新显示的数值
        valueDisplayEl.setText(`${value}`);
        
        // 更新输入框的值
        if (textComponentRef) {
          textComponentRef.setValue(`${value}`);
        }
        
        this.tempSettings.syncInterval = value;
        
        // 根据同步间隔值更新启用同步设置
        if (value === 0 && this.tempSettings.enableSync) {
          this.tempSettings.enableSync = false;
          
          // 更新UI上的开关状态
          if (enableSyncToggleRef) {
            enableSyncToggleRef.setValue(false);
          }
        } else if (value > 0 && !this.tempSettings.enableSync) {
          this.tempSettings.enableSync = true;
          
          // 更新UI上的开关状态
          if (enableSyncToggleRef) {
            enableSyncToggleRef.setValue(true);
          }
        }
        
        await this.plugin.saveSettings(this.tempSettings);
      });
      
      return sliderComponent;
    });
    
    // 添加文本输入框  
    syncIntervalSetting.addText(text => {
      const textComponent = text
        .setValue(this.tempSettings.syncInterval.toString())
        .setPlaceholder('分钟');
      
      // 保存文本组件引用以供滑动条使用
      textComponentRef = textComponent;
      
      textComponent.onChange(async (value) => {
        const interval = parseInt(value) || 0;
        
        // 限制范围
        let finalValue = interval;
        if (interval < 0) {
          finalValue = 0;
          // 更新输入框显示
          textComponent.setValue("0");
        } else if (interval > 60) {
          finalValue = 60;
          // 更新输入框显示
          textComponent.setValue("60");
        }
        
        this.tempSettings.syncInterval = finalValue;
        
        // 更新显示的数值
        valueDisplayEl.setText(`${finalValue}`);
        
        // 更新滑动条的位置
        if (sliderComponentRef) {
          sliderComponentRef.setValue(finalValue);
        }
        
        // 根据同步间隔值更新启用同步设置
        if (finalValue === 0 && this.tempSettings.enableSync) {
          this.tempSettings.enableSync = false;
          
          // 更新UI上的开关状态
          if (enableSyncToggleRef) {
            enableSyncToggleRef.setValue(false);
          }
        } else if (finalValue > 0 && !this.tempSettings.enableSync) {
          this.tempSettings.enableSync = true;
          
          // 更新UI上的开关状态
          if (enableSyncToggleRef) {
            enableSyncToggleRef.setValue(true);
          }
        }
        
        await this.plugin.saveSettings(this.tempSettings);
      });
      
      return textComponent;
    });
    
    // 手动同步按钮
    new Setting(generalSection)
      .setName('手动同步')
      .setDesc('手动同步本地文件和云盘文件')
      .addButton(button => button
        .setButtonText('立即同步')
        .setCta()
        .onClick(async () => {
          try {
            // 阻止重复点击
            if (button.buttonEl.disabled) {
              return;
            }
            
            // 按优先级顺序检查前置条件
            
            // 1. 首先检查同步功能是否已启用
            if (!this.plugin.settings.enableSync) {
              this.plugin.notificationManager.show('sync-prereq', '请先在设置中启用同步功能', 4000);
              return;
            }
            
            // 2. 检查是否有启用的存储提供商
            if (!this.plugin.settings.enabledProviders || this.plugin.settings.enabledProviders.length === 0) {
              this.plugin.notificationManager.show('sync-prereq', '请先在设置中启用至少一个云盘服务', 4000);
              return;
            }
            
            // 3. 对于已启用的存储提供商，检查配置是否完整
            if (this.plugin.settings.enabledProviders.includes('webdav')) {
              const webdavSettings = this.plugin.settings.providerSettings.webdav;
              if (!webdavSettings || !webdavSettings.username || !webdavSettings.password) {
                this.plugin.notificationManager.show('sync-prereq', '请先完成 WebDAV 配置，账号和密码不能为空', 4000);
                return;
              }
              
              if (!webdavSettings.serverUrl) {
                this.plugin.notificationManager.show('sync-prereq', '请先完成 WebDAV 配置，服务器URL不能为空', 4000);
                return;
              }
              
              // 检查URL格式
              if (!webdavSettings.serverUrl.startsWith('http://') && !webdavSettings.serverUrl.startsWith('https://')) {
                this.plugin.notificationManager.show('sync-prereq', 'WebDAV 服务器URL应以http://或https://开头', 4000);
                return;
              }
              
              // 如果是HTTP连接，显示警告（这个可以保留，因为是警告不是错误）
              if (webdavSettings.serverUrl.startsWith('http://')) {
                this.plugin.notificationManager.show('sync-warning', '警告：使用非加密连接可能导致数据泄露风险', 7000);
              }
            }
            
            // 所有检查通过，开始同步
            const syncButton = button.buttonEl;
            const originalText = syncButton.textContent;
            
            // 禁用按钮并显示状态
            syncButton.textContent = '同步中...';
            syncButton.disabled = true;
            
            // 使用通知管理器显示同步开始通知
            this.plugin.notificationManager.show('sync-start', '正在同步...', 30000);
            
            // 执行同步
            try {
              await this.plugin.manualSync();
              
              // 显示成功通知
              this.plugin.notificationManager.clear('sync-start');
              this.plugin.notificationManager.show('sync-complete', '同步完成', 4000);
            } catch (syncError) {
              console.error('同步执行失败:', syncError);
              
              // 清除开始通知
              this.plugin.notificationManager.clear('sync-start');
              
              // 提供详细的错误信息，使用单一通知
                let errorMessage = '同步失败';
                
                if (syncError.code === 'AUTH_FAILED' || 
                    (syncError.message && (syncError.message.includes('认证错误') || 
                                          syncError.message.includes('认证失败') || 
                                          syncError.message.includes('身份验证')))) {
                  errorMessage = '同步失败: 认证错误，请检查账号和密码';
                  
                  // 如果是坚果云，添加特殊提示
                  if (this.plugin.settings.providerSettings.webdav?.serverUrl?.includes('jianguoyun.com')) {
                    errorMessage += '\n坚果云用户请确认账号密码正确，且未开启二步验证';
                  }
                } else if (syncError.code === 'NOT_FOUND' || 
                          (syncError.message && (syncError.message.includes('404') || 
                                                syncError.message.includes('不存在')))) {
                  errorMessage = '同步失败: 远程目录不存在，请检查同步路径设置或创建指定的目录';
                } else if (syncError.code === 'FORBIDDEN' || 
                          (syncError.message && (syncError.message.includes('403') || 
                                                syncError.message.includes('权限')))) {
                  errorMessage = '同步失败: 无访问权限，请检查账号权限设置';
                } else if (syncError.code === 'QUOTA_EXCEEDED' || 
                          (syncError.message && (syncError.message.includes('配额') || 
                                                syncError.message.includes('空间不足')))) {
                  errorMessage = '同步失败: 云盘存储空间不足，请清理云盘或升级存储空间';
                } else if (syncError.message && syncError.message.includes('未启用任何存储提供商')) {
                  errorMessage = '请先在设置中启用至少一个云盘服务';
                } else if (syncError.message) {
                  errorMessage = `同步失败: ${syncError.message}`;
                }
                
                // 显示单一错误通知，包含完整信息
                this.plugin.notificationManager.show('sync-error', errorMessage, 8000); // 显示8秒，让用户有足够时间阅读
            }
          } catch (error) {
            console.error('同步过程中发生错误:', error);
            
            // 显示通用错误
            this.plugin.notificationManager.clear('sync-start');
            this.plugin.notificationManager.show('sync-error', `同步过程中发生错误: ${error.message || '未知错误'}`, 5000);
          } finally {
            // 确保按钮状态被重置
            button.setButtonText('立即同步');
            button.setDisabled(false);
          }
        }));
    
    // 忽略文件夹设置
    new Setting(generalSection)
      .setName('忽略文件夹')
      .setDesc('忽略指定文件夹 (用逗号分隔，支持通配符如 *.git)')
      .addTextArea(text => text
        .setValue(this.tempSettings.ignoreFolders.join(', '))
        .setPlaceholder('例如: .git, .obsidian, node_modules')
        .onChange(async (value) => {
          this.tempSettings.ignoreFolders = value.split(',').map(item => item.trim()).filter(item => !!item);
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 忽略文件设置
    new Setting(generalSection)
      .setName('忽略文件')
      .setDesc('忽略指定文件 (用逗号分隔，支持通配符如 *.tmp)')
      .addTextArea(text => text
        .setValue(this.tempSettings.ignoreFiles.join(', '))
        .setPlaceholder('例如: .DS_Store, desktop.ini')
        .onChange(async (value) => {
          this.tempSettings.ignoreFiles = value.split(',').map(item => item.trim()).filter(item => !!item);
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 忽略扩展名设置
    new Setting(generalSection)
      .setName('忽略扩展名')
      .setDesc('忽略指定扩展名 (用逗号分隔，不需要加点)')
      .addTextArea(text => text
        .setValue(this.tempSettings.ignoreExtensions.join(', '))
        .setPlaceholder('例如: tmp, bak, swp')
        .onChange(async (value) => {
          this.tempSettings.ignoreExtensions = value.split(',').map(item => item.trim()).filter(item => !!item);
          await this.plugin.saveSettings(this.tempSettings);
        }));
  }

  // 云盘选择部分
  createCloudProvidersSection(containerEl: HTMLElement): void {
    const providersSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
    
    providersSection.createEl('h3', { text: '云盘同步' });
    
    // WebDAV选项
    new Setting(providersSection)
      .setName('WebDAV')
      .setDesc('使用WebDAV同步数据')
      .addToggle(toggle => toggle
        .setValue(this.tempSettings.enabledProviders.includes('webdav'))
        .onChange(async (value) => {
          if (value) {
            // 添加WebDAV作为启用的提供商
            if (!this.tempSettings.enabledProviders.includes('webdav')) {
              this.tempSettings.enabledProviders.push('webdav');
              
              // 初始化WebDAV设置
              if (!this.tempSettings.providerSettings.webdav) {
                this.tempSettings.providerSettings.webdav = {
                  enabled: true,
                  username: '',
                  password: '',
                  serverUrl: '',
                  syncPath: ''
                };
              } else {
                this.tempSettings.providerSettings.webdav.enabled = true;
              }
            }
          } else {
            // 从启用的提供商中移除WebDAV
            this.tempSettings.enabledProviders = this.tempSettings.enabledProviders.filter(p => p !== 'webdav');
            
            // 禁用WebDAV设置
            if (this.tempSettings.providerSettings.webdav) {
              this.tempSettings.providerSettings.webdav.enabled = false;
            }
          }
          
          await this.plugin.saveSettings(this.tempSettings);
          this.display(); // 刷新界面以显示/隐藏WebDAV设置
        }));
    
    // Google Drive选项
    new Setting(providersSection)
      .setName('Google Drive')
      .setDesc('使用Google Drive同步数据')
      .addToggle(toggle => toggle
        .setValue(this.tempSettings.enabledProviders.includes('gdrive'))
        .onChange(async (value) => {
          if (value) {
            // 添加Google Drive作为启用的提供商
            if (!this.tempSettings.enabledProviders.includes('gdrive')) {
              this.tempSettings.enabledProviders.push('gdrive');
              
              // 初始化Google Drive设置
              if (!this.tempSettings.providerSettings.gdrive) {
                this.tempSettings.providerSettings.gdrive = {
                  enabled: true,
                  clientId: '',
                  clientSecret: '',
                  syncPath: ''
                };
              } else {
                this.tempSettings.providerSettings.gdrive.enabled = true;
              }
            }
          } else {
            // 从启用的提供商中移除Google Drive
            this.tempSettings.enabledProviders = this.tempSettings.enabledProviders.filter(p => p !== 'gdrive');
            
            // 禁用Google Drive设置
            if (this.tempSettings.providerSettings.gdrive) {
              this.tempSettings.providerSettings.gdrive.enabled = false;
            }
          }
          
          await this.plugin.saveSettings(this.tempSettings);
          this.display(); // 刷新界面以显示/隐藏Google Drive设置
        }))
      .setDisabled(true); // 暂时禁用，因为尚未实现
    
    // One Drive选项
    new Setting(providersSection)
      .setName('One Drive')
      .setDesc('使用One Drive同步数据')
      .addToggle(toggle => toggle
        .setValue(this.tempSettings.enabledProviders.includes('onedrive'))
        .onChange(async (value) => {
          if (value) {
            // 添加One Drive作为启用的提供商
            if (!this.tempSettings.enabledProviders.includes('onedrive')) {
              this.tempSettings.enabledProviders.push('onedrive');
              
              // 初始化One Drive设置
              if (!this.tempSettings.providerSettings.onedrive) {
                this.tempSettings.providerSettings.onedrive = {
                  enabled: true,
                  clientId: '',
                  clientSecret: '',
                  syncPath: ''
                };
              } else {
                this.tempSettings.providerSettings.onedrive.enabled = true;
              }
            }
          } else {
            // 从启用的提供商中移除One Drive
            this.tempSettings.enabledProviders = this.tempSettings.enabledProviders.filter(p => p !== 'onedrive');
            
            // 禁用One Drive设置
            if (this.tempSettings.providerSettings.onedrive) {
              this.tempSettings.providerSettings.onedrive.enabled = false;
            }
          }
          
          await this.plugin.saveSettings(this.tempSettings);
          this.display(); // 刷新界面以显示/隐藏One Drive设置
        }))
      .setDisabled(true); // 暂时禁用，因为尚未实现
    
    // 其他云盘选项...以后添加
  }

  // WebDAV设置部分
  createWebDAVSection(containerEl: HTMLElement): void {
    // 确保有WebDAV设置
    if (!this.tempSettings.providerSettings.webdav) {
      this.tempSettings.providerSettings.webdav = {
        enabled: true,
        username: '',
        password: '',
        serverUrl: '',
        syncPath: ''
      };
    }
    
    const webdavSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
    
    webdavSection.createEl('h3', { text: 'WebDAV 设置' });
    
    // 账号设置
    const usernameSettingContainer = new Setting(webdavSection)
      .setName('账号')
      .setDesc('WebDAV账号')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.webdav?.username || '')
        .setPlaceholder('请输入WebDAV账号')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.webdav) {
            this.tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.webdav.username = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 添加必填标记
    usernameSettingContainer.nameEl.addClass('cloud-sync-required');
    
    // 密码设置
    const passwordSettingContainer = new Setting(webdavSection)
      .setName('密码')
      .setDesc('WebDAV密码')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.webdav?.password || '')
        .setPlaceholder('请输入WebDAV密码')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.webdav) {
            this.tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.webdav.password = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 添加必填标记
    passwordSettingContainer.nameEl.addClass('cloud-sync-required');
    
    // 服务器URL设置
    const serverUrlSettingContainer = new Setting(webdavSection)
      .setName('服务器URL')
      .setDesc('WebDAV服务器URL地址')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.webdav?.serverUrl || '')
        .setPlaceholder('例如: https://dav.jianguoyun.com/dav/')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.webdav) {
            this.tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.webdav.serverUrl = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 添加必填标记
    serverUrlSettingContainer.nameEl.addClass('cloud-sync-required');
    
    // 同步路径设置
    new Setting(webdavSection)
      .setName('同步路径')
      .setDesc('设置WebDAV同步数据的存储路径（留空表示同步到根目录）')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.webdav?.syncPath || '')
        .setPlaceholder('例如: obsidian-notes')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.webdav) {
            this.tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.webdav.syncPath = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 测试连接按钮
    const testConnectionSetting = new Setting(webdavSection)
      .setName('测试连接')
      .setDesc('测试WebDAV服务器连接是否正常')
      .addButton(button => button
        .setButtonText('测试连接')
        .setCta()
        .onClick(async () => {
          // 如果之前已经在测试连接，则返回
          if (this.testingConnection) {
            return;
          }

          // 获取当前WebDAV设置
          const webdavSettings = this.tempSettings.providerSettings.webdav;
          if (!webdavSettings) {
            this.plugin.notificationManager.show('webdav-test', 'WebDAV设置不存在', 4000);
            return;
          }
          
          // 检查必填字段
          if (!webdavSettings.username || !webdavSettings.password || !webdavSettings.serverUrl) {
            this.plugin.notificationManager.show('webdav-test', '请填写完整的WebDAV配置信息', 4000);
            return;
          }
          
          // 标记正在测试连接
          this.testingConnection = true;
          
          // 更改按钮状态
          const originalText = button.buttonEl.textContent || '测试连接';
          button.setButtonText('测试中...');
          button.setDisabled(true);
          
          try {
            console.log('尝试连接到WebDAV服务器...');
            
            // 验证URL格式
            const serverUrl = webdavSettings.serverUrl;
            if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
              this.plugin.notificationManager.show('webdav-test', 'WebDAV 服务器URL应以http://或https://开头', 4000);
              throw new Error('URL格式错误：缺少协议');
            }
            
            // 如果是HTTP连接，显示警告
            if (serverUrl.startsWith('http://')) {
              this.plugin.notificationManager.show('webdav-warning', '警告：使用非加密连接可能导致数据泄露风险', 7000);
            }
            
            const provider = new WebDAVProvider(webdavSettings, this.app);
            
            // 先连接
            let connected = false;
            try {
              connected = await provider.connect();
            } catch (connectError) {
              console.error('WebDAV连接失败:', connectError);
              
              // 提取错误信息
              let errorMessage = connectError.message || '未知错误';
              let errorCode = connectError.code || '';
              
              // 格式化错误提示
              if (errorCode === 'AUTH_FAILED' || errorCode === 'FORBIDDEN') {
                throw new Error('连接失败：身份验证错误，请检查账号和密码');
              } else if (errorCode === 'CONFIG_ERROR') {
                throw new Error(errorMessage);
              } else if (errorCode === 'NETWORK_ERROR') {
                throw new Error('连接失败：网络错误，请检查服务器URL和网络连接');
              } else {
                throw new Error(`连接失败：${errorMessage}`);
              }
            }
            
            // 如果连接成功，尝试获取文件列表测试访问权限
            if (connected) {
              try {
                // 测试获取文件列表和配额信息
                try {
                  await provider.listFiles('/');
                  console.log('文件列表获取成功');
                } catch (listError) {
                  console.warn('获取文件列表失败，但连接成功:', listError);
                  // 如果获取列表失败但连接成功，继续，不中断测试
                }
                
                // 测试获取配额信息
                try {
                  const quota = await provider.getQuota();
                  console.log('配额信息:', quota);
                } catch (quotaError) {
                  console.warn('获取配额信息失败，但连接成功:', quotaError);
                  // 如果获取配额信息失败但连接成功，继续，不中断测试
                }
                
                this.plugin.notificationManager.show('webdav-complete', '连接成功！WebDAV 服务器连接正常', 4000);
              } catch (testError) {
                console.error('连接成功但功能测试失败:', testError);
                this.plugin.notificationManager.show('webdav-error', '连接建立成功，但权限测试失败，请检查WebDAV访问权限', 5000);
              } finally {
                // 测试完成后断开连接
                try {
                  await provider.disconnect();
                } catch (disconnectError) {
                  console.warn('断开连接失败:', disconnectError);
                }
              }
            } else {
              this.plugin.notificationManager.show('webdav-error', '连接失败，服务器拒绝连接', 5000);
            }
          } catch (error) {
            console.error('测试WebDAV连接失败:', error);
            this.plugin.notificationManager.show('webdav-test-error', `测试连接失败: ${error.message || '未知错误'}`, 5000);
          } finally {
            // 重置按钮状态和测试状态
            button.setButtonText(originalText);
            button.setDisabled(false);
            this.testingConnection = false;
          }
        }));
  }

  // 高级设置部分
  createAdvancedSection(containerEl: HTMLElement): void {
    const advancedSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
    
    advancedSection.createEl('h3', { text: '高级设置' });
    
    // 安全设置
    const securitySection = advancedSection.createEl('div', { cls: 'cloud-sync-settings cloud-sync-subsection' });
    securitySection.createEl('h4', { text: '安全设置', cls: 'cloud-sync-subtitle' });
    
    // 启用加密
    new Setting(securitySection)
      .setName('启用加密')
      .setDesc('加密同步的内容')
      .addToggle(toggle => toggle
        .setValue(this.tempSettings.encryption.enabled)
        .onChange(async (value) => {
          this.tempSettings.encryption.enabled = value;
          await this.plugin.saveSettings(this.tempSettings);
          this.display(); // 刷新界面以显示/隐藏加密设置
        }));
    
    // 加密设置
    if (this.tempSettings.encryption.enabled) {
      const encryptionKeySetting = new Setting(securitySection)
        .setName('加密密钥')
        .setDesc('用于加密的密钥，请妥善保管')
        .addText(text => {
          let isPasswordVisible = false;
          
          text.setPlaceholder('16位加密密钥')
            .setValue(this.tempSettings.encryption.key)
            .onChange(async (value) => {
              // 验证密钥长度
              if (value && value.length !== 16) {
                this.plugin.notificationManager.show('encryption-error', '密钥长度必须为16位', 4000);
                return;
              }
              
              this.tempSettings.encryption.key = value;
              await this.plugin.saveSettings(this.tempSettings);
            });
          
          // 添加密码可见性切换图标
          const togglePasswordVisibility = (show: boolean) => {
            isPasswordVisible = show;
            text.inputEl.type = show ? 'text' : 'password';
          };
          
          // 初始为密码模式
          togglePasswordVisibility(false);
          
          // 添加显示/隐藏按钮
          const eyeIconContainer = text.inputEl.parentElement!.createDiv({ cls: 'eye-icon-container' });
          eyeIconContainer.addEventListener('click', () => {
            togglePasswordVisibility(!isPasswordVisible);
          });
          
          return text;
        })
        .addExtraButton(button => button
          .setIcon('reset')
          .setTooltip('生成随机密钥')
          .onClick(async () => {
            // 通常我们会使用AESCryptoService.generateKey()，但为简化，这里直接生成
            const randGen = () => Math.floor(Math.random() * 16).toString(16);
            const randomKey = Array(16).fill(0).map(() => randGen()).join('');
            
            this.tempSettings.encryption.key = randomKey;
            await this.plugin.saveSettings(this.tempSettings);
            this.display(); // 刷新界面
            this.plugin.notificationManager.show('encryption-complete', '已生成新的加密密钥', 4000);
          }))
        .addExtraButton(button => button
          .setIcon('copy')
          .setTooltip('复制密钥')
          .onClick(() => {
            navigator.clipboard.writeText(this.tempSettings.encryption.key);
            this.plugin.notificationManager.show('encryption-copy', '加密密钥已复制到剪贴板', 4000);
          }));
      
      encryptionKeySetting.descEl.createDiv({
        text: '必须输入16位密钥。请务必备份密钥，密钥丢失将导致无法恢复加密的数据！',
        cls: 'setting-item-description cloud-sync-warning'
      });
    }
    
    // 同步设置
    const syncSection = advancedSection.createEl('div', { cls: 'cloud-sync-settings cloud-sync-subsection' });
    syncSection.createEl('h4', { text: '同步设置', cls: 'cloud-sync-subtitle' });
    
    // 冲突策略
    new Setting(syncSection)
      .setName('冲突策略')
      .setDesc('设置冲突处理策略')
      .addDropdown(dropdown => dropdown
        .addOption('overwrite', '覆盖')
        .addOption('keepLocal', '保留本地')
        .addOption('keepRemote', '保留云盘')
        .addOption('merge', '合并')
        .setValue(this.tempSettings.conflictPolicy)
        .onChange(async (value: any) => {
          this.tempSettings.conflictPolicy = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 同步模式
    new Setting(syncSection)
      .setName('同步模式')
      .setDesc('设置同步模式')
      .addDropdown(dropdown => {
        // 添加选项
        dropdown.addOption('incremental', '增量同步')
          .addOption('full', '全量同步');
        
        // 手动检查当前选择的值并设置
        const currentSyncMode = this.tempSettings.syncMode;
        console.log('设置同步模式下拉框，当前值:', currentSyncMode);
        
        if (currentSyncMode && (currentSyncMode === 'incremental' || currentSyncMode === 'full')) {
          dropdown.setValue(currentSyncMode);
        } else {
          console.log('同步模式值无效，设置为默认值: incremental');
          dropdown.setValue('incremental');
          this.tempSettings.syncMode = 'incremental';
        }
        
        // 处理值变化
        dropdown.onChange(async (value: any) => {
          console.log('同步模式变更为:', value);
          this.tempSettings.syncMode = value;
          await this.plugin.saveSettings(this.tempSettings);
        });
        
        return dropdown;
      });
    
    // 同步方向
    new Setting(syncSection)
      .setName('同步方向')
      .setDesc('设置同步方向')
      .addDropdown(dropdown => {
        // 添加选项
        dropdown.addOption('bidirectional', '双向同步')
          .addOption('uploadOnly', '仅上传')
          .addOption('downloadOnly', '仅下载');
        
        // 手动检查当前选择的值并设置
        const currentSyncDirection = this.tempSettings.syncDirection;
        console.log('设置同步方向下拉框，当前值:', currentSyncDirection);
        
        if (currentSyncDirection && 
           (currentSyncDirection === 'bidirectional' || 
            currentSyncDirection === 'uploadOnly' || 
            currentSyncDirection === 'downloadOnly')) {
          dropdown.setValue(currentSyncDirection);
        } else {
          console.log('同步方向值无效，设置为默认值: bidirectional');
          dropdown.setValue('bidirectional');
          this.tempSettings.syncDirection = 'bidirectional';
        }
        
        // 处理值变化
        dropdown.onChange(async (value) => {
          console.log('同步方向变更为:', value);
          this.tempSettings.syncDirection = value as SyncDirection;
          await this.plugin.saveSettings(this.tempSettings);
        });
        
        return dropdown;
      });
    
    // 删除远程多余文件
    new Setting(syncSection)
      .setName('删除远程多余文件')
      .setDesc('删除服务器上存在但本地不存在的文件和文件夹。启用此选项会删除Obsidian中删除的文件和文件夹。')
      .addToggle(toggle => toggle
        .setValue(this.tempSettings.deleteRemoteExtraFiles)
        .onChange(async (value) => {
          this.tempSettings.deleteRemoteExtraFiles = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));

    // 删除本地多余文件
    new Setting(syncSection)
      .setName('删除本地多余文件')
      .setDesc('删除本地存在但服务器上不存在的文件和文件夹。启用此选项请谨慎，可能会删除未同步的本地文件。')
      .addToggle(toggle => toggle
        .setValue(this.tempSettings.deleteLocalExtraFiles)
        .onChange(async (value) => {
          this.tempSettings.deleteLocalExtraFiles = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 基础设置
    const baseSection = advancedSection.createEl('div', { cls: 'cloud-sync-settings cloud-sync-subsection' });
    baseSection.createEl('h4', { text: '基础设置', cls: 'cloud-sync-subtitle' });
    
    // 调试模式
    new Setting(baseSection)
      .setName('调试模式')
      .setDesc('启用详细日志记录')
      .addToggle(toggle => toggle
        .setValue(this.tempSettings.debugMode)
        .onChange(async (value) => {
          this.tempSettings.debugMode = value;
          await this.plugin.saveSettings(this.tempSettings);
          this.display(); // 刷新界面以显示/隐藏日志级别设置
        }));
    
    // 日志级别
    if (this.tempSettings.debugMode) {
      new Setting(baseSection)
        .setName('日志级别')
        .setDesc('设置日志记录的详细程度')
        .addDropdown(dropdown => dropdown
          .addOption('debug', '调试')
          .addOption('info', '信息')
          .addOption('warning', '警告')
          .addOption('error', '错误')
          .setValue(this.tempSettings.logLevel)
          .onChange(async (value: any) => {
            this.tempSettings.logLevel = value;
            await this.plugin.saveSettings(this.tempSettings);
          }));
    }
    
    // 导出日志
    new Setting(baseSection)
      .setName('导出日志')
      .setDesc('导出插件日志以便排查问题')
      .addButton(button => button
        .setButtonText('导出')
        .onClick(async () => {
          // 实际实现会从一个日志服务获取日志
          const dummyLog = "=== Cloud Sync 日志 ===\n时间: " + new Date().toISOString() + "\n没有可用的日志数据";
          
          // 创建一个下载链接
          const blob = new Blob([dummyLog], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `cloud-sync-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
          document.body.appendChild(a);
          a.click();
          
          // 清理
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 100);
        }));
    
    // 网络检测
    new Setting(baseSection)
      .setName('网络检测')
      .setDesc('仅在WiFi网络同步')
      .addToggle(toggle => toggle
        .setValue(this.tempSettings.networkDetection)
        .onChange(async (value) => {
          this.tempSettings.networkDetection = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 清除缓存
    new Setting(baseSection)
      .setName('清除缓存')
      .setDesc('清除同步缓存数据')
      .addButton(button => button
        .setButtonText('清除')
        .onClick(async () => {
          try {
            await this.plugin.clearCache();
          } catch (error) {
            console.error('清除缓存失败', error);
            this.plugin.notificationManager.show('cache-error', `清除缓存失败: ${error.message || error}`, 5000);
          }
        }));
  }
} 