import { Setting } from 'obsidian';
import { PluginSettings, RequestDelayLevel } from '@models/plugin-settings';
import CloudSyncPlugin from '@main';
import { WebDAVProvider } from '@providers/webdav/webdav-provider';

/**
 * 创建WebDAV设置部分
 * @param containerEl 容器元素
 * @param plugin 插件实例 
 * @param tempSettings 临时设置对象
 * @param testingConnection 测试连接状态
 * @param setTestingConnection 设置测试连接状态函数
 * @author Bing
 */
export function createWebDAVSection(
  containerEl: HTMLElement, 
  plugin: CloudSyncPlugin, 
  tempSettings: PluginSettings,
  testingConnection: boolean,
  setTestingConnection: (value: boolean) => void
): void {
  const webdavSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
  
  webdavSection.createEl('h3', { text: 'WebDAV设置' });
  
  // 创建防抖函数，避免用户快速输入时多次尝试初始化
  let debounceTimer: NodeJS.Timeout | null = null;
  const debounceConfigCheck = (delay: number = 1000) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      checkConfigCompleteAndInitialize();
    }, delay);
  };
  
  /**
   * 检查WebDAV配置是否完整，并尝试初始化提供商
   * 解决首次配置后需要重启的问题
   */
  const checkConfigCompleteAndInitialize = async () => {
    // 检查WebDAV配置是否完整
    const webdavSettings = tempSettings.providerSettings.webdav;
    
    // 进行详细的字段验证并记录缺失的字段
    const missingFields = [];
    
    if (!webdavSettings?.serverUrl) {
      missingFields.push('服务器URL');
      console.log('WebDAV配置进行中：缺少服务器URL');
    }
    
    if (!webdavSettings?.username) {
      missingFields.push('用户名');
      console.log('WebDAV配置进行中：缺少用户名');
    }
    
    if (!webdavSettings?.password) {
      missingFields.push('密码');
      console.log('WebDAV配置进行中：缺少密码');
    }
    
    // 如果有缺失字段，提前返回不执行初始化
    if (missingFields.length > 0) {
      console.log(`WebDAV配置尚未完成，还需填写: ${missingFields.join(', ')}`);
      
      // 只有一个字段时，提示用户完成配置
      if (webdavSettings?.serverUrl && (missingFields.length <= 2)) {
        // 避免频繁显示提示
        plugin.notificationManager.show(
          'webdav-config-incomplete', 
          `WebDAV配置尚未完成，请继续填写: ${missingFields.join('、')}`, 
          3000
        );
      }
      return;
    }
    
    // 配置完整，继续初始化
    console.log('WebDAV配置已完整，准备初始化提供商...');
    
    // 确保WebDAV在启用列表中
    if (!tempSettings.enabledProviders.includes('webdav')) {
      console.log('将WebDAV添加到启用列表');
      tempSettings.enabledProviders.push('webdav');
    }
    
    // 确保WebDAV被标记为启用
    if (webdavSettings) {
      console.log('确保WebDAV标记为已启用');
      webdavSettings.enabled = true;
    }
    
    // 确保全局同步开关开启
    if (!tempSettings.enableSync) {
      console.log('启用全局同步开关');
      tempSettings.enableSync = true;
    }
    
    // 保存更新后的设置
    await plugin.saveSettings(tempSettings);
    
    try {
      // 强制初始化提供商
      console.log('强制初始化提供商...');
      const success = await plugin.ensureProvidersInitialized(true);
      
      if (success) {
        console.log('WebDAV提供商初始化成功，无需重启');
        plugin.notificationManager.show('webdav-init', 'WebDAV配置已成功激活，可以开始同步', 4000);
      } else {
        console.log('WebDAV配置已保存，但需要时间初始化，将在同步时自动连接');
        plugin.notificationManager.show('webdav-init', 'WebDAV配置已保存，将在执行同步时自动连接', 5000);
      }
    } catch (error) {
      console.error('初始化WebDAV提供商时出错:', error);
      plugin.notificationManager.show('webdav-init-error', '激活WebDAV配置时出错，请尝试重启Obsidian', 6000);
    }
  };
  
  // 用户名设置
  const usernameSettingContainer = new Setting(webdavSection)
    .setName('用户名')
    .setDesc('WebDAV用户名')
    .addText(text => {
      let isTextVisible = false;
      
      text.setValue(tempSettings.providerSettings.webdav?.username || '')
        .setPlaceholder('请输入WebDAV用户名')
        .onChange(async (value) => {
          if (!tempSettings.providerSettings.webdav) {
            tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
          }
          tempSettings.providerSettings.webdav.username = value;
          await plugin.saveSettings(tempSettings);
          
          // 配置完整性检查和初始化
          debounceConfigCheck();
        });
        
      // 添加可见性切换功能
      const toggleTextVisibility = (show: boolean) => {
        isTextVisible = show;
        text.inputEl.type = show ? 'text' : 'password';
      };
      
      // 默认为密码模式（隐藏）
      toggleTextVisibility(false);
      
      // 获取输入框元素
      const inputEl = text.inputEl;
      
      // 调整输入框样式，为图标留出空间
      inputEl.style.paddingRight = '30px';
      
      // 创建一个容器来包含输入框和图标
      const containerEl = inputEl.parentElement;
      if (containerEl) {
        containerEl.style.position = 'relative';
        
        // 添加显示/隐藏按钮到输入框容器中
        const eyeIconContainer = containerEl.createSpan({ cls: 'eye-icon-container' });
        eyeIconContainer.style.position = 'absolute';
        eyeIconContainer.style.right = '8px';
        eyeIconContainer.style.top = '50%';
        eyeIconContainer.style.transform = 'translateY(-50%)';
        eyeIconContainer.style.cursor = 'pointer';
        eyeIconContainer.style.zIndex = '1';
        eyeIconContainer.style.fontSize = '16px';
        eyeIconContainer.style.opacity = '0.7';
        eyeIconContainer.style.color = 'var(--text-normal)';
        eyeIconContainer.style.pointerEvents = 'auto';
        eyeIconContainer.innerHTML = isTextVisible ? '👁️' : '👁️‍🗨️';
        
        eyeIconContainer.addEventListener('click', () => {
          toggleTextVisibility(!isTextVisible);
          eyeIconContainer.innerHTML = isTextVisible ? '👁️' : '👁️‍🗨️';
        });
      }
      
      return text;
    });
  
  // 添加必填标记
  usernameSettingContainer.nameEl.addClass('cloud-sync-required');
  
  // 密码设置
  const passwordSettingContainer = new Setting(webdavSection)
    .setName('密码')
    .setDesc('WebDAV密码')
    .addText(text => {
      let isPasswordVisible = false;
      
      text.setValue(tempSettings.providerSettings.webdav?.password || '')
        .setPlaceholder('请输入WebDAV密码')
        .onChange(async (value) => {
          if (!tempSettings.providerSettings.webdav) {
            tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
          }
          tempSettings.providerSettings.webdav.password = value;
          await plugin.saveSettings(tempSettings);
          
          // 配置完整性检查和初始化
          debounceConfigCheck();
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
      
      // 调整输入框样式，为图标留出空间
      inputEl.style.paddingRight = '30px';
      
      // 创建一个容器来包含输入框和图标
      const containerEl = inputEl.parentElement;
      if (containerEl) {
        containerEl.style.position = 'relative';
        
        // 添加显示/隐藏按钮到输入框容器中
        const eyeIconContainer = containerEl.createSpan({ cls: 'eye-icon-container' });
        eyeIconContainer.style.position = 'absolute';
        eyeIconContainer.style.right = '8px';
        eyeIconContainer.style.top = '50%';
        eyeIconContainer.style.transform = 'translateY(-50%)';
        eyeIconContainer.style.cursor = 'pointer';
        eyeIconContainer.style.zIndex = '1';
        eyeIconContainer.style.fontSize = '16px';
        eyeIconContainer.style.opacity = '0.7';
        eyeIconContainer.style.color = 'var(--text-normal)';
        eyeIconContainer.style.pointerEvents = 'auto';
        eyeIconContainer.innerHTML = isPasswordVisible ? '👁️' : '👁️‍🗨️';
        
        eyeIconContainer.addEventListener('click', () => {
          togglePasswordVisibility(!isPasswordVisible);
          eyeIconContainer.innerHTML = isPasswordVisible ? '👁️' : '👁️‍🗨️';
        });
      }
      
      return text;
    });
  
  // 添加必填标记
  passwordSettingContainer.nameEl.addClass('cloud-sync-required');
  
  // 服务器URL设置
  const serverUrlSettingContainer = new Setting(webdavSection)
    .setName('服务器URL')
    .setDesc('WebDAV服务器URL地址')
    .addText(text => {
      let timerId: NodeJS.Timeout | null = null;
      
      const inputEl = text.inputEl;
      // 设置输入框宽度为更宽
      inputEl.style.width = '300px';
      
      return text
        .setValue(tempSettings.providerSettings.webdav?.serverUrl || '')
        .setPlaceholder('例如: https://dav.jianguoyun.com/dav/')
        .onChange(async (value) => {
          if (!tempSettings.providerSettings.webdav) {
            tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
          }
          
          // 保存当前设置状态
          const oldUrl = tempSettings.providerSettings.webdav.serverUrl || '';
          
          // 格式化URL
          let formattedUrl = value.trim();
          
          // 如果URL不为空且没有协议，添加https://
          if (formattedUrl && !formattedUrl.match(/^https?:\/\//i)) {
            formattedUrl = 'https://' + formattedUrl;
            console.log('URL自动添加https://', formattedUrl);
          }
          
          // 确保URL以/结尾
          if (formattedUrl && !formattedUrl.endsWith('/')) {
            formattedUrl = formattedUrl + '/';
            console.log('URL自动添加末尾斜杠', formattedUrl);
          }
          
          // 如果格式化后的URL与输入不同，更新输入框
          if (formattedUrl !== value) {
            text.setValue(formattedUrl);
          }
          
          // 更新设置
          tempSettings.providerSettings.webdav.serverUrl = formattedUrl;
          await plugin.saveSettings(tempSettings);
          
          // 检查URL是否包含jianguoyun.com
          const newUrl = formattedUrl || '';
          const hasJianguoyun = newUrl.toLowerCase().includes('jianguoyun.com');
          const oldHasJianguoyun = oldUrl.toLowerCase().includes('jianguoyun.com');
          
          // 安全检查：如果使用http协议，提示不安全
          if (formattedUrl && formattedUrl.toLowerCase().startsWith('http://')) {
            console.log('检测到不安全的HTTP连接');
            plugin.notificationManager.show(
              'webdav-http-warning', 
              '警告：您正在使用不安全的HTTP连接，建议使用HTTPS以保护您的数据', 
              6000
            );
          }
          
          console.log('URL检查:', {oldUrl, newUrl, oldHasJianguoyun, hasJianguoyun});
          
          // 创建一个指向特定设置部分的变量
          const providerSpecificSection = webdavSection.querySelector('.cloud-sync-provider-specific-settings');
          
          // 处理UI更新
          if (oldHasJianguoyun !== hasJianguoyun && providerSpecificSection) {
            console.log('坚果云状态变化，将刷新界面');
            // 当坚果云状态变化时，使用防抖处理完整刷新
            if (timerId) {
              clearTimeout(timerId);
            }
            
            timerId = setTimeout(() => {
              plugin.settingTab.display();
            }, 1000); // 用户停止输入1秒后再刷新
          } else if (!hasJianguoyun && value && providerSpecificSection) {
            console.log('非坚果云URL，更新提示');
            // 对于非坚果云URL，动态更新提示而不刷新整个页面
            
            // 清理之前的提示（如果存在）
            if (providerSpecificSection instanceof HTMLElement) {
              providerSpecificSection.empty();
              
              // 添加非坚果云提示
              const otherProviderSection = providerSpecificSection.createEl('div', { 
                cls: 'cloud-sync-other-provider' 
              });
              
              // 添加提示图标
              otherProviderSection.createEl('span', { 
                cls: 'cloud-sync-tip-icon',
                text: '💡'
              });
              
              // 添加提示信息
              otherProviderSection.createEl('p', { 
                cls: 'cloud-sync-tip-text'
              }).innerHTML = '提示：若使用坚果云，输入包含<span class="highlight">jianguoyun.com</span>的URL可启用优化选项';
            }
          } else if (!value && providerSpecificSection) {
            console.log('URL为空，清除提示');
            // 当URL为空时清除提示
            if (providerSpecificSection instanceof HTMLElement) {
              providerSpecificSection.empty();
            }
          }
          
          // 配置完整性检查和初始化
          debounceConfigCheck();
        });
    });
  
  // 添加必填标记
  serverUrlSettingContainer.nameEl.addClass('cloud-sync-required');
  
  // 创建服务提供商特定设置部分
  const providerSpecificSection = webdavSection.createEl('div', { 
    cls: 'cloud-sync-provider-specific-settings'
  });
  
  // 坚果云特定设置
  // 只有当服务器URL包含jianguoyun.com时才显示这些设置
  if (tempSettings.providerSettings.webdav?.serverUrl?.includes('jianguoyun.com')) {
    // 添加坚果云特定设置容器
    const jianguoyunSettingsContainer = providerSpecificSection.createEl('div', { 
      cls: 'cloud-sync-jianguoyun-settings' 
    });

    // 使用一个简单的div作为标题容器
    const headerContainer = jianguoyunSettingsContainer.createEl('div', { 
      cls: 'cloud-sync-jianguoyun-header' 
    });

    // 添加标题文本
    headerContainer.createEl('h4', { 
      text: '坚果云特定设置', 
      cls: 'cloud-sync-subtitle' 
    });

    // 添加说明面板
    const infoPanel = jianguoyunSettingsContainer.createEl('div', { 
      cls: 'cloud-sync-info-panel' 
    });

    // 添加说明文本
    infoPanel.createEl('p', { 
      cls: 'cloud-sync-info-text'
    }).innerHTML = '坚果云<span class="highlight">免费用户每30分钟最多600次请求，付费用户最多1500次请求</span>。适当调整延迟可以避免同步问题。';
    
    // 用户类型设置
    const accountTypeSetting = new Setting(jianguoyunSettingsContainer)
      .setName('账户类型')
      .setDesc('选择您的坚果云账户类型，影响请求频率限制')
      .addDropdown(dropdown => dropdown
        .addOption('false', '免费用户 (600次/30分钟)')
        .addOption('true', '付费用户 (1500次/30分钟)')
        .setValue(tempSettings.providerSettings.webdav?.isPaidUser ? 'true' : 'false')
        .onChange(async (value) => {
          if (!tempSettings.providerSettings.webdav) {
            tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
          }
          tempSettings.providerSettings.webdav.isPaidUser = value === 'true';
          await plugin.saveSettings(tempSettings);
          
          // 尝试更新现有WebDAV提供商实例的账户类型设置
          if (plugin.storageProviders && plugin.storageProviders.has('webdav')) {
            const provider = plugin.storageProviders.get('webdav');
            if (provider) {
              console.log('尝试更新现有WebDAV提供商的账户类型设置');
              try {
                // @ts-ignore - 使用动态访问
                if (typeof provider.updateAccountType === 'function') {
                  // @ts-ignore
                  await provider.updateAccountType(value === 'true');
                  console.log('成功更新WebDAV提供商的账户类型设置');
                } else {
                  console.warn('WebDAV提供商不支持动态更新账户类型设置');
                }
              } catch (e) {
                console.warn('无法更新现有WebDAV提供商的账户类型设置:', e);
              }
            }
          }
        }));
    
    // 为设置添加自定义样式
    accountTypeSetting.settingEl.addClass('cloud-sync-jianguoyun-setting');
    
    // 请求延迟设置
    const requestDelaySetting = new Setting(jianguoyunSettingsContainer)
      .setName('请求延迟')
      .setDesc('较高的延迟可以减少被限流的可能性，但同步速度会变慢')
      .addDropdown(dropdown => dropdown
        .addOption('normal', '普通 (默认，200ms)')
        .addOption('slow', '较慢 (500ms)')
        .addOption('very-slow', '非常慢 (1000ms)')
        .setValue(tempSettings.providerSettings.webdav?.requestDelay || 'normal')
        .onChange(async (value) => {
          if (!tempSettings.providerSettings.webdav) {
            tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
          }
          
          // 记录延迟设置变更
          const oldDelay = tempSettings.providerSettings.webdav.requestDelay || 'normal';
          const newDelay = value as RequestDelayLevel;
          console.log(`坚果云请求延迟设置更改: ${oldDelay} -> ${newDelay}`);
          
          tempSettings.providerSettings.webdav.requestDelay = newDelay;
          await plugin.saveSettings(tempSettings);
          
          // 尝试更新现有WebDAV提供商实例的延迟设置
          if (plugin.storageProviders && plugin.storageProviders.has('webdav')) {
            const provider = plugin.storageProviders.get('webdav');
            if (provider) {
              console.log('尝试更新现有WebDAV提供商的请求延迟设置');
              try {
                // @ts-ignore - 使用动态访问
                if (typeof provider.updateRequestDelay === 'function') {
                  // @ts-ignore
                  await provider.updateRequestDelay(newDelay);
                  console.log('成功更新WebDAV提供商的请求延迟设置');
                } else {
                  console.warn('WebDAV提供商不支持动态更新请求延迟设置');
                }
              } catch (e) {
                console.warn('无法更新现有WebDAV提供商的请求延迟设置:', e);
              }
            }
          }
        }));
    
    // 为设置添加自定义样式
    requestDelaySetting.settingEl.addClass('cloud-sync-jianguoyun-setting');
  } else if (tempSettings.providerSettings.webdav?.serverUrl) {
    // 对非坚果云用户显示简洁提示信息
    const otherProviderSection = providerSpecificSection.createEl('div', { 
      cls: 'cloud-sync-other-provider' 
    });
    
    // 添加提示图标
    otherProviderSection.createEl('span', { 
      cls: 'cloud-sync-tip-icon',
      text: '💡'
    });
    
    // 添加提示信息(更简洁的版本)
    otherProviderSection.createEl('p', { 
      cls: 'cloud-sync-tip-text'
    }).innerHTML = '提示：若使用坚果云，输入包含<span class="highlight">jianguoyun.com</span>的URL可启用优化选项';
  }
  
  // 同步路径设置
  new Setting(webdavSection)
    .setName('同步路径')
    .setDesc('设置WebDAV同步数据的存储路径（留空表示同步到根目录）')
    .addText(text => text
      .setValue(tempSettings.providerSettings.webdav?.syncPath || '')
      .setPlaceholder('例如: obsidian-notes')
      .onChange(async (value) => {
        if (!tempSettings.providerSettings.webdav) {
          tempSettings.providerSettings.webdav = {
            enabled: true,
            username: '',
            password: '',
            serverUrl: '',
            syncPath: ''
          };
        }
        tempSettings.providerSettings.webdav.syncPath = value;
        await plugin.saveSettings(tempSettings);
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
        if (testingConnection) {
          return;
        }

        // 获取当前WebDAV设置
        const webdavSettings = tempSettings.providerSettings.webdav;
        if (!webdavSettings) {
          plugin.notificationManager.show('webdav-test', 'WebDAV设置不存在', 4000);
          return;
        }
        
        // 检查必填字段
        if (!webdavSettings.username || !webdavSettings.password || !webdavSettings.serverUrl) {
          plugin.notificationManager.show('webdav-test', '请填写完整的WebDAV配置信息', 4000);
          return;
        }
        
        // 标记正在测试连接
        setTestingConnection(true);
        
        // 更改按钮状态
        const originalText = button.buttonEl.textContent || '测试连接';
        button.setButtonText('测试中...');
        button.setDisabled(true);
        
        try {
          console.log('尝试连接到WebDAV服务器...');
          
          // 验证URL格式
          const serverUrl = webdavSettings.serverUrl;
          if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
            plugin.notificationManager.show('webdav-test', 'WebDAV 服务器URL应以http://或https://开头', 4000);
            throw new Error('URL格式错误：缺少协议');
          }
          
          // 如果是HTTP连接，显示警告
          if (serverUrl.startsWith('http://')) {
            plugin.notificationManager.show('webdav-warning', '警告：使用非加密连接可能导致数据泄露风险', 7000);
          }
          
          const provider = new WebDAVProvider(webdavSettings, plugin.app);
          
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
              
              plugin.notificationManager.show('webdav-complete', '连接成功！WebDAV 服务器连接正常', 4000);
            } catch (testError) {
              console.error('连接成功但功能测试失败:', testError);
              plugin.notificationManager.show('webdav-error', '连接建立成功，但权限测试失败，请检查WebDAV访问权限', 5000);
            } finally {
              // 测试完成后断开连接
              try {
                await provider.disconnect();
              } catch (disconnectError) {
                console.warn('断开连接失败:', disconnectError);
              }
            }
          } else {
            plugin.notificationManager.show('webdav-error', '连接失败，服务器拒绝连接', 5000);
          }
        } catch (error) {
          console.error('测试WebDAV连接失败:', error);
          plugin.notificationManager.show('webdav-test-error', `测试连接失败: ${error.message || '未知错误'}`, 5000);
        } finally {
          // 重置按钮状态和测试状态
          button.setButtonText(originalText);
          button.setDisabled(false);
          setTestingConnection(false);
        }
      }));
} 