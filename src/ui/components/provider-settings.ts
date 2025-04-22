import { Setting } from 'obsidian';
import { PluginSettings } from '@models/plugin-settings';
import CloudSyncPlugin from '@main';

/**
 * 创建云盘提供商选择部分
 * @param containerEl 容器元素
 * @param plugin 插件实例 
 * @param tempSettings 临时设置对象
 * @param displayFunc 刷新界面函数
 * @author Bing
 */
export function createCloudProvidersSection(
  containerEl: HTMLElement, 
  plugin: CloudSyncPlugin, 
  tempSettings: PluginSettings,
  displayFunc: () => Promise<void>
): void {
  const providersSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
  
  providersSection.createEl('h3', { text: '云盘同步' });
  
  // WebDAV选项
  new Setting(providersSection)
    .setName('WebDAV')
    .setDesc('使用WebDAV同步数据')
    .addToggle(toggle => toggle
      .setValue(tempSettings.enabledProviders.includes('webdav'))
      .onChange(async (value) => {
        if (value) {
          console.log('WebDAV开关打开，开始配置...');
          
          // 添加WebDAV作为启用的提供商
          if (!tempSettings.enabledProviders.includes('webdav')) {
            tempSettings.enabledProviders.push('webdav');
            console.log('将WebDAV添加到已启用提供商列表');
          }
          
          // 初始化WebDAV设置
          if (!tempSettings.providerSettings.webdav) {
            tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
            console.log('初始化WebDAV设置对象');
          } else {
            tempSettings.providerSettings.webdav.enabled = true;
            console.log('将WebDAV标记为已启用');
          }
          
          // 不再强制启用全局同步开关，尊重用户设置
          console.log('WebDAV已启用，但不自动开启全局同步');
        } else {
          console.log('WebDAV开关关闭，开始清理...');
          
          // 从启用的提供商中移除WebDAV
          tempSettings.enabledProviders = tempSettings.enabledProviders.filter(p => p !== 'webdav');
          console.log('从已启用提供商列表中移除WebDAV');
          
          // 禁用WebDAV设置
          if (tempSettings.providerSettings.webdav) {
            tempSettings.providerSettings.webdav.enabled = false;
            console.log('将WebDAV标记为未启用');
          }
          
          // 移除以下注释中的代码，不再自动关闭全局同步开关
          // 如果没有其他启用的提供商，自动关闭全局同步开关
          // if (tempSettings.enabledProviders.length === 0) {
          //   console.log('没有启用的提供商，自动关闭全局同步开关');
          //   tempSettings.enableSync = false;
          // }
        }
        
        // 保存设置
        console.log('保存WebDAV设置更改并初始化提供商...');
        await plugin.saveSettings(tempSettings);
        
        // 刷新界面
        await displayFunc();
      }));
  
  // Google Drive选项
  new Setting(providersSection)
    .setName('Google Drive')
    .setDesc('使用Google Drive同步数据')
    .addToggle(toggle => toggle
      .setValue(tempSettings.enabledProviders.includes('gdrive'))
      .onChange(async (value) => {
        if (value) {
          // 添加Google Drive作为启用的提供商
          if (!tempSettings.enabledProviders.includes('gdrive')) {
            tempSettings.enabledProviders.push('gdrive');
            
            // 初始化Google Drive设置
            if (!tempSettings.providerSettings.gdrive) {
              tempSettings.providerSettings.gdrive = {
                enabled: true,
                clientId: '',
                clientSecret: '',
                syncPath: ''
              };
            } else {
              tempSettings.providerSettings.gdrive.enabled = true;
            }
          }
        } else {
          // 从启用的提供商中移除Google Drive
          tempSettings.enabledProviders = tempSettings.enabledProviders.filter(p => p !== 'gdrive');
          
          // 禁用Google Drive设置
          if (tempSettings.providerSettings.gdrive) {
            tempSettings.providerSettings.gdrive.enabled = false;
          }
        }
        
        await plugin.saveSettings(tempSettings);
        await displayFunc(); // 刷新界面以显示/隐藏Google Drive设置
      }))
    .setDisabled(true); // 暂时禁用，因为尚未实现
  
  // OneDrive选项
  new Setting(providersSection)
    .setName('OneDrive')
    .setDesc('使用OneDrive同步数据')
    .addToggle(toggle => toggle
      .setValue(tempSettings.enabledProviders.includes('onedrive'))
      .onChange(async (value) => {
        if (value) {
          // 添加OneDrive作为启用的提供商
          if (!tempSettings.enabledProviders.includes('onedrive')) {
            tempSettings.enabledProviders.push('onedrive');
            
            // 初始化OneDrive设置
            if (!tempSettings.providerSettings.onedrive) {
              tempSettings.providerSettings.onedrive = {
                enabled: true,
                clientId: '',
                clientSecret: '',
                syncPath: ''
              };
            } else {
              tempSettings.providerSettings.onedrive.enabled = true;
            }
          }
        } else {
          // 从启用的提供商中移除OneDrive
          tempSettings.enabledProviders = tempSettings.enabledProviders.filter(p => p !== 'onedrive');
          
          // 禁用OneDrive设置
          if (tempSettings.providerSettings.onedrive) {
            tempSettings.providerSettings.onedrive.enabled = false;
          }
        }
        
        await plugin.saveSettings(tempSettings);
        await displayFunc(); // 刷新界面以显示/隐藏OneDrive设置
      }))
    .setDisabled(true); // 暂时禁用，因为尚未实现
  
  // iCloud选项
  new Setting(providersSection)
    .setName('iCloud')
    .setDesc('使用iCloud同步数据')
    .addToggle(toggle => toggle
      .setValue(tempSettings.enabledProviders.includes('icloud'))
      .onChange(async (value) => {
        if (value) {
          // 添加iCloud作为启用的提供商
          if (!tempSettings.enabledProviders.includes('icloud')) {
            tempSettings.enabledProviders.push('icloud');
            
            // 初始化iCloud设置
            if (!tempSettings.providerSettings.icloud) {
              tempSettings.providerSettings.icloud = {
                enabled: true,
                appId: '',
                password: '',
                syncPath: ''
              };
            } else {
              tempSettings.providerSettings.icloud.enabled = true;
            }
          }
        } else {
          // 从启用的提供商中移除iCloud
          tempSettings.enabledProviders = tempSettings.enabledProviders.filter(p => p !== 'icloud');
          
          // 禁用iCloud设置
          if (tempSettings.providerSettings.icloud) {
            tempSettings.providerSettings.icloud.enabled = false;
          }
        }
        
        await plugin.saveSettings(tempSettings);
        await displayFunc(); // 刷新界面以显示/隐藏iCloud设置
      }))
    .setDisabled(true); // 暂时禁用，因为尚未实现

  // GitHub选项
  new Setting(providersSection)
    .setName('GitHub')
    .setDesc('使用GitHub同步数据')
    .addToggle(toggle => toggle
      .setValue(tempSettings.enabledProviders.includes('github'))
      .onChange(async (value) => {
        if (value) {
          // 添加GitHub作为启用的提供商
          if (!tempSettings.enabledProviders.includes('github')) {
            tempSettings.enabledProviders.push('github');
            
            // 初始化GitHub设置
            if (!tempSettings.providerSettings.github) {
              tempSettings.providerSettings.github = {
                enabled: true,
                username: '',
                token: '',
                repository: '',
                branch: '',
                syncPath: ''
              };
            } else {
              tempSettings.providerSettings.github.enabled = true;
            }
          }
        } else {
          // 从启用的提供商中移除GitHub
          tempSettings.enabledProviders = tempSettings.enabledProviders.filter(p => p !== 'github');
          
          // 禁用GitHub设置
          if (tempSettings.providerSettings.github) {
            tempSettings.providerSettings.github.enabled = false;
          }
        }
        
        await plugin.saveSettings(tempSettings);
        await displayFunc(); // 刷新界面以显示/隐藏GitHub设置
      }))
    .setDisabled(true); // 暂时禁用，因为尚未实现
  
  // 其他云盘选项...以后添加
} 