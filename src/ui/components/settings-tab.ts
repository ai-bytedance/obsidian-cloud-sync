import { App, Notice, PluginSettingTab, Setting, ButtonComponent } from 'obsidian';
import CloudSyncPlugin from '@main';
import { PluginSettings, WebDAVSettings, RequestDelayLevel } from '@models/plugin-settings';
import { WebDAVProvider } from '@providers/webdav/webdav-provider';
import { ConnectionStatus } from '@providers/common/storage-provider';
import { ConflictPolicy, SyncDirection, SyncMode } from '@models/plugin-settings';
import { ModuleLogger } from '@services/log/log-service';

// 引入拆分后的组件
import { createGeneralSection } from './general-settings';
import { createCloudProvidersSection } from './provider-settings';
import { createWebDAVSection } from './webdav-settings-ui';
import { createAdvancedSection } from './advanced-settings';

// 模块级别的日志记录器
let logger: ModuleLogger | null = null;

/**
 * 配置模块日志记录器
 * @param moduleLogger 日志记录器实例
 */
export function configureSettingsTabLogger(moduleLogger: ModuleLogger): void {
  logger = moduleLogger;
}

/**
 * Cloud Sync插件设置界面
 * @author Bing
 */
export class CloudSyncSettingTab extends PluginSettingTab {
  plugin: CloudSyncPlugin;
  tempSettings: PluginSettings;
  testingConnection: boolean = false;

  constructor(app: App, plugin: CloudSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    
    // 初始化日志记录器，如果尚未初始化
    if (!logger && plugin.logService) {
      logger = plugin.logService.getModuleLogger('SettingsTab');
    }
  }

  async display(): Promise<void> {
    const { containerEl } = this;

    // 克隆设置对象以便取消时恢复
    this.tempSettings = JSON.parse(JSON.stringify(this.plugin.settings));
    
    // 调试日志：输出初始化的tempSettings值
    logger?.debug('初始化的tempSettings:', {
      syncMode: this.tempSettings.syncMode,
      syncDirection: this.tempSettings.syncDirection
    });
    
    // 确保同步模式和同步方向有有效值
    if (!this.tempSettings.syncMode) {
      logger?.info('同步模式无效，设置为默认值: incremental');
      this.tempSettings.syncMode = 'incremental';
    }
    
    if (!this.tempSettings.syncDirection) {
      logger?.info('同步方向无效，设置为默认值: bidirectional');
      this.tempSettings.syncDirection = 'bidirectional';
    }
    
    // 检查设置的一致性
    this.checkSettingsConsistency();

    // 清除现有内容
    containerEl.empty();

    // 创建通用设置部分 - 调用拆分后的组件
    createGeneralSection(containerEl, this.plugin, this.tempSettings);

    // 创建云盘选择部分 - 调用拆分后的组件
    createCloudProvidersSection(containerEl, this.plugin, this.tempSettings, this.display.bind(this));

    // 创建WebDAV设置部分 (如果启用) - 调用拆分后的组件
    if (this.tempSettings.enabledProviders.includes('webdav')) {
      createWebDAVSection(
        containerEl, 
        this.plugin, 
        this.tempSettings, 
        this.testingConnection, 
        (value: boolean) => this.testingConnection = value,
        this.display.bind(this)
      );
    }
    
    // 创建iCloud设置部分 (如果启用)
    if (this.tempSettings.enabledProviders.includes('icloud')) {
      this.createICloudSection(containerEl);
    }
    
    // 创建GitHub设置部分 (如果启用)
    if (this.tempSettings.enabledProviders.includes('github')) {
      this.createGitHubSection(containerEl);
    }

    // 创建高级设置部分 - 调用拆分后的组件
    createAdvancedSection(containerEl, this.plugin, this.tempSettings, this.display.bind(this));
  }
  
  /**
   * 检查设置的一致性，确保UI状态和内部配置一致
   * @author Bing
   */
  private checkSettingsConsistency(): boolean {
    let needSave = false;
    
    // 检查WebDAV设置的一致性
    if (this.tempSettings.enabledProviders.includes('webdav')) {
      // 如果WebDAV在启用列表中，但WebDAV设置未启用
      if (this.tempSettings.providerSettings.webdav && !this.tempSettings.providerSettings.webdav.enabled) {
        logger?.info('修复：WebDAV在enabledProviders列表中但设置中未启用');
        this.tempSettings.providerSettings.webdav.enabled = true;
        needSave = true;
      }
    } else {
      // 如果WebDAV不在启用列表中，但WebDAV设置启用了
      if (this.tempSettings.providerSettings.webdav?.enabled) {
        logger?.info('修复：WebDAV设置启用但不在enabledProviders列表中');
        this.tempSettings.enabledProviders.push('webdav');
        needSave = true;
      }
    }
    
    // 处理同步间隔与自动同步关联逻辑
    if (this.tempSettings.syncInterval === 0 && this.tempSettings.enableSync) {
      logger?.info('检测到同步间隔为0但同步已启用，同步间隔与状态不一致');
      this.tempSettings.enableSync = false;
      needSave = true;
    }
    
    if (needSave) {
      // 异步保存设置
      this.plugin.saveSettings(this.tempSettings).catch(error => {
        logger?.error('保存修复后的设置失败:', error);
      });
    }
    
    return needSave;
  }

  // iCloud设置部分
  createICloudSection(containerEl: HTMLElement): void {
    const icloudSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
    
    // 使用Setting.setHeading()创建标题
    new Setting(icloudSection)
      .setName('iCloud')
      .setHeading();
    
    // 添加开发中提示
    const developingNotice = icloudSection.createEl('div', { 
      cls: 'cloud-sync-info-panel cloud-sync-developing-notice' 
    });
    
    const noticeIcon = developingNotice.createEl('span', {
      cls: 'cloud-sync-tip-icon',
      text: '🚧'
    });
    
    const noticeText = developingNotice.createEl('p', {
      cls: 'cloud-sync-tip-text'
    });
    
    noticeText.setText('iCloud同步功能正在开发中，当前设置仅供参考，尚未实际可用。敬请期待！');
    
    // App ID设置
    new Setting(icloudSection)
      .setName('App ID')
      .setDesc('iCloud账号')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.icloud?.appId || '')
        .setPlaceholder('请输入iCloud账号')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.icloud) {
            this.tempSettings.providerSettings.icloud = {
              enabled: true,
              appId: '',
              password: '',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.icloud.appId = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 密码设置
    new Setting(icloudSection)
      .setName('密码')
      .setDesc('iCloud密码')
      .addText(text => {
        let isPasswordVisible = false;
        
        text.setValue(this.tempSettings.providerSettings.icloud?.password || '')
          .setPlaceholder('请输入iCloud密码')
          .onChange(async (value) => {
            if (!this.tempSettings.providerSettings.icloud) {
              this.tempSettings.providerSettings.icloud = {
                enabled: true,
                appId: '',
                password: '',
                syncPath: ''
              };
            }
            this.tempSettings.providerSettings.icloud.password = value;
            await this.plugin.saveSettings(this.tempSettings);
          });
          
        // 添加密码可见性切换功能
        const togglePasswordVisibility = (show: boolean) => {
          isPasswordVisible = show;
          text.inputEl.type = show ? 'text' : 'password';
        };
        
        // 默认为密码模式（隐藏）
        togglePasswordVisibility(false);
        
        // 获取输入框元素
        const inputEl = text.inputEl;
        
        // 添加密码输入框样式类
        inputEl.addClass('cloud-sync-password-input cs-input-with-icon');
        
        // 创建一个容器来包含输入框和图标
        const containerEl = inputEl.parentElement;
        if (containerEl) {
          // 添加容器样式类
          containerEl.addClass('cloud-sync-input-container');
          
          // 添加显示/隐藏按钮到输入框容器中
          const eyeIconContainer = containerEl.createSpan({ cls: 'eye-icon-container cs-eye-icon' });
          
          eyeIconContainer.addEventListener('click', () => {
            togglePasswordVisibility(!isPasswordVisible);
            eyeIconContainer.setText(isPasswordVisible ? '👁️' : '👁️‍🗨️');
          });
          
          // 初始设置图标文本
          eyeIconContainer.setText(isPasswordVisible ? '👁️' : '👁️‍🗨️');
        }
        
        return text;
      });
    
    // 同步路径设置
    new Setting(icloudSection)
      .setName('同步路径')
      .setDesc('设置iCloud同步数据的存储路径（留空表示同步到根目录）')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.icloud?.syncPath || '')
        .setPlaceholder('例如: obsidian-notes')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.icloud) {
            this.tempSettings.providerSettings.icloud = {
              enabled: true,
              appId: '',
              password: '',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.icloud.syncPath = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 授权按钮
    new Setting(icloudSection)
      .setName('授权')
      .setDesc('授权访问iCloud')
      .addButton(button => button
        .setButtonText('授权')
        .setCta()
        .onClick(async () => {
          // 显示未实现提示
          this.plugin.notificationManager.show('icloud-auth', '授权iCloud功能尚未实现', 4000);
        }))
      .setDisabled(true); // 暂时禁用，因为尚未实现
  }

  // GitHub设置部分
  createGitHubSection(containerEl: HTMLElement): void {
    const githubSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
    
    // 使用Setting.setHeading()创建标题
    new Setting(githubSection)
      .setName('GitHub')
      .setHeading();
    
    // 添加开发中提示
    const developingNotice = githubSection.createEl('div', { 
      cls: 'cloud-sync-info-panel cloud-sync-developing-notice' 
    });
    
    const noticeIcon = developingNotice.createEl('span', {
      cls: 'cloud-sync-tip-icon',
      text: '🚧'
    });
    
    const noticeText = developingNotice.createEl('p', {
      cls: 'cloud-sync-tip-text'
    });
    
    noticeText.setText('GitHub同步功能正在开发中，当前设置仅供参考，尚未实际可用。敬请期待！');
    
    // 用户名设置
    new Setting(githubSection)
      .setName('用户名')
      .setDesc('GitHub仓库所有者用户名')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.github?.username || '')
        .setPlaceholder('请输入GitHub用户名')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.github) {
            this.tempSettings.providerSettings.github = {
              enabled: true,
              username: '',
              token: '',
              repository: '',
              branch: 'main',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.github.username = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 访问令牌设置
    new Setting(githubSection)
      .setName('个人访问令牌')
      .setDesc('GitHub个人访问令牌（Personal Access Token）')
      .addText(text => {
        let isTokenVisible = false;
        
        text.setValue(this.tempSettings.providerSettings.github?.token || '')
          .setPlaceholder('请输入GitHub个人访问令牌')
          .onChange(async (value) => {
            if (!this.tempSettings.providerSettings.github) {
              this.tempSettings.providerSettings.github = {
                enabled: true,
                username: '',
                token: '',
                repository: '',
                branch: 'main',
                syncPath: ''
              };
            }
            this.tempSettings.providerSettings.github.token = value;
            await this.plugin.saveSettings(this.tempSettings);
          });
          
        // 添加令牌可见性切换功能
        const toggleTokenVisibility = (show: boolean) => {
          isTokenVisible = show;
          text.inputEl.type = show ? 'text' : 'password';
        };
        
        // 默认为密码模式（隐藏）
        toggleTokenVisibility(false);
        
        // 获取输入框元素
        const inputEl = text.inputEl;
        
        // 添加密码输入框样式类
        inputEl.addClass('cloud-sync-password-input cs-input-with-icon');
        
        // 创建一个容器来包含输入框和图标
        const containerEl = inputEl.parentElement;
        if (containerEl) {
          // 添加容器样式类
          containerEl.addClass('cloud-sync-input-container');
          
          // 添加显示/隐藏按钮到输入框容器中
          const eyeIconContainer = containerEl.createSpan({ cls: 'eye-icon-container cs-eye-icon' });
          
          eyeIconContainer.addEventListener('click', () => {
            toggleTokenVisibility(!isTokenVisible);
            eyeIconContainer.setText(isTokenVisible ? '👁️' : '👁️‍🗨️');
          });
          
          // 初始设置图标文本
          eyeIconContainer.setText(isTokenVisible ? '👁️' : '👁️‍🗨️');
        }
        
        return text;
      });
    
    // 仓库名称设置
    new Setting(githubSection)
      .setName('仓库名称')
      .setDesc('GitHub仓库名称')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.github?.repository || '')
        .setPlaceholder('例如: obsidian-notes')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.github) {
            this.tempSettings.providerSettings.github = {
              enabled: true,
              username: '',
              token: '',
              repository: '',
              branch: 'main',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.github.repository = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 分支设置
    new Setting(githubSection)
      .setName('分支')
      .setDesc('GitHub仓库分支')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.github?.branch || 'main')
        .setPlaceholder('例如: main')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.github) {
            this.tempSettings.providerSettings.github = {
              enabled: true,
              username: '',
              token: '',
              repository: '',
              branch: 'main',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.github.branch = value || 'main';
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 同步路径设置
    new Setting(githubSection)
      .setName('同步路径')
      .setDesc('设置GitHub同步数据的存储路径（留空表示同步到根目录）')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.github?.syncPath || '')
        .setPlaceholder('例如: notes')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.github) {
            this.tempSettings.providerSettings.github = {
              enabled: true,
              username: '',
              token: '',
              repository: '',
              branch: 'main',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.github.syncPath = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 测试连接按钮
    new Setting(githubSection)
      .setName('测试连接')
      .setDesc('测试GitHub连接是否正常')
      .addButton(button => button
        .setButtonText('测试连接')
        .setCta()
        .onClick(async () => {
          // 显示未实现提示
          this.plugin.notificationManager.show('github-test', 'GitHub连接测试功能尚未实现', 4000);
        }))
      .setDisabled(true); // 暂时禁用，因为尚未实现
  }
} 