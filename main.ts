import { 
	Plugin, 
	App
} from 'obsidian';
import { 
	PluginSettings, 
	DEFAULT_SETTINGS,
	StorageProviderType
} from '@models/plugin-settings';
import { CloudSyncSettingTab } from '@components/settings-tab';
import { StorageProvider } from '@providers/common/storage-provider';
import { CryptoService } from '@services/crypto/crypto-service';
import { NotificationManager } from '@services/notification/notification-manager';
import { SyncEngine } from '@src/core/sync-engine';
import { VaultFileManager } from '@src/core/vault-file-manager';
import { FileEventHandler } from '@src/core/file-event-handler';
import { AutoSyncManager } from '@src/core/auto-sync-manager';
import { ProviderManager } from '@src/core/provider-manager';
import { CacheManager } from '@src/core/cache-manager';
import { SyncManager } from '@src/core/sync-manager';
import { SettingsManager } from '@src/core/settings-manager';
import { LifecycleService } from '@services/lifecycle-service';
import { PluginService } from '@services/plugin-service';

/**
 * Obsidian云同步插件主类
 */
export default class CloudSyncPlugin extends Plugin {
	// 基本属性
	settings: PluginSettings;
	storageProviders: Map<StorageProviderType, StorageProvider>;
	cryptoService: CryptoService;
	syncInProgress: boolean = false;
	notificationManager: NotificationManager;
	settingTab: CloudSyncSettingTab;
	
	// 核心组件
	syncEngine: SyncEngine;
	vaultFileManager: VaultFileManager;
	fileEventHandler: FileEventHandler;
	autoSyncManager: AutoSyncManager;
	providerManager: ProviderManager;
	cacheManager: CacheManager;
	syncManager: SyncManager;
	settingsManager: SettingsManager;
	
	// 服务类
	private lifecycleService: LifecycleService;
	pluginService: PluginService;
	
	// 同步超时保护
	private syncTimeoutId: NodeJS.Timeout | null = null;
	private readonly MAX_SYNC_DURATION = 10 * 60 * 1000; // 10分钟超时
	
	/**
	 * 初始化插件
	 */
	async onload() {
		// 创建生命周期服务
		this.lifecycleService = new LifecycleService(this);
		
		// 委托初始化工作
		await this.lifecycleService.initialize();
	}
	
	/**
	 * 卸载插件
	 */
	onunload() {
		// 委托清理工作
		this.lifecycleService.cleanup();
	}
	
	/**
	 * 保存插件设置（公共API，供外部使用）
	 */
	async saveSettings(newSettings?: PluginSettings) {
		// 简化委托逻辑，确保向下兼容
		if (this.pluginService) {
			return await this.pluginService.saveSettings(newSettings);
		}
		return await this.settingsManager.saveSettings(newSettings);
	}
	
	/**
	 * 确保提供商已初始化（公共API，供外部使用）
	 */
	async ensureProvidersInitialized(forceInitialize: boolean = false) {
		const success = await this.providerManager.ensureProvidersInitialized(forceInitialize);
		// 更新存储提供商引用
		this.storageProviders = this.providerManager.getProviders();
		return success;
	}
	
	/**
	 * 手动同步（公共API，供外部使用）
	 */
	async manualSync(): Promise<boolean> {
		// 如果已有同步正在进行，直接返回
		if (this.syncInProgress) {
			console.warn('已有同步操作正在进行，跳过此次调用');
			return false;
		}
		
		try {
			this.syncInProgress = true;
			
			// 设置同步超时保护
			this.syncTimeoutId = setTimeout(() => {
				console.warn('同步操作超时，强制终止');
				this.syncInProgress = false;
				this.notificationManager.show('sync-timeout', '同步操作超时，已自动中断', 5000);
			}, this.MAX_SYNC_DURATION);
			
			return await this.syncManager.manualSync();
		} finally {
			// 清除超时并重置状态
			if (this.syncTimeoutId) {
				clearTimeout(this.syncTimeoutId);
				this.syncTimeoutId = null;
			}
			this.syncInProgress = false;
		}
	}
	
	/**
	 * 清除缓存（公共API，供外部使用）
	 */
	async clearCache() {
		await this.cacheManager.clearCache();
	}
	
	/**
	 * 获取WebDAV提供商类（公共API，供外部使用）
	 */
	public getWebDAVProviderClass() {
		if (this.pluginService) {
			return this.pluginService.getWebDAVProviderClass();
		}
		return null;
	}
} 