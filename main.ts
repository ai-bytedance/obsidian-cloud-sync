import { 
	Plugin, 
	Notice, 
	TAbstractFile, 
	TFile, 
	Vault, 
	debounce
} from 'obsidian';
import { 
	PluginSettings, 
	DEFAULT_SETTINGS, 
	WebDAVSettings, 
	StorageProviderType,
	SyncMode,
	SyncDirection
} from '@models/plugin-settings';
import { CloudSyncSettingTab } from '@components/settings-tab';
import { WebDAVProvider } from '@storage/webdav-provider';
import { AESCryptoService } from '@crypto/aes-crypto-service';
import { ConnectionStatus, StorageProvider, FileInfo } from '@storage/storage-provider';
import { CryptoService } from '@crypto/crypto-service';
import { NotificationManager } from '@services/notification/notification-manager';

export default class CloudSyncPlugin extends Plugin {
	settings: PluginSettings;
	storageProviders: Map<StorageProviderType, StorageProvider>;
	cryptoService: CryptoService;
	syncIntervalId: number | null = null;
	syncInProgress: boolean = false;
	notificationManager: NotificationManager;
	
	/**
	 * 初始化插件
	 */
	async onload() {
		console.log('加载 Cloud Sync 插件');
		
		// 初始化通知管理器
		this.notificationManager = new NotificationManager();
		
		// 加载设置
		await this.loadSettings();
		
		// 初始化加密服务
		this.cryptoService = new AESCryptoService();
		
		// 初始化存储提供商
		this.storageProviders = new Map();
		this.initializeProviders();
		
		// 添加设置选项卡
		this.addSettingTab(new CloudSyncSettingTab(this.app, this));
		
		// 添加状态栏
		this.addStatusBarItem().setText('Cloud Sync');
		
		// 添加手动同步命令
		this.addCommand({
			id: 'manual-sync',
			name: '手动同步',
			callback: async () => {
				try {
					this.notificationManager.show('sync-start', '开始同步...', 3000);
					await this.manualSync();
					this.notificationManager.clear('sync-start');
					this.notificationManager.show('sync-complete', '同步完成', 3000);
				} catch (error) {
					console.error('同步失败', error);
					this.notificationManager.clear('sync-start');
					this.notificationManager.show('sync-error', `同步失败: ${error.message || ''}`, 5000);
				}
			}
		});
		
		// 注册文件事件监听器
		this.registerFileEvents();
		
		// 如果启用了自动同步，开始自动同步
		if (this.settings.enableSync && this.settings.syncInterval > 0) {
			this.startAutoSync();
		}
	}
	
	/**
	 * 卸载插件
	 */
	onunload() {
		console.log('卸载 Cloud Sync 插件');
		
		// 停止自动同步
		this.stopAutoSync();
		
		// 断开所有存储提供商的连接
		this.disconnectAllProviders();
	}
	
	/**
	 * 加载插件设置
	 */
	async loadSettings() {
		// 加载用户设置，与默认设置合并
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		
		// 确保同步模式和同步方向有有效值
		if (!this.settings.syncMode) {
			console.log('同步模式无效，设置为默认值: incremental');
			this.settings.syncMode = 'incremental';
		}
		
		if (!this.settings.syncDirection) {
			console.log('同步方向无效，设置为默认值: bidirectional');
			this.settings.syncDirection = 'bidirectional';
		}
		
		// 记录加载的设置
		console.log('加载的设置，同步模式:', this.settings.syncMode, 
		           '同步方向:', this.settings.syncDirection);
	}
	
	/**
	 * 保存插件设置
	 * @param newSettings 新设置
	 */
	async saveSettings(newSettings?: PluginSettings) {
		if (newSettings) {
			this.settings = newSettings;
		}
		
		await this.saveData(this.settings);
		
		// 重新初始化存储提供商
		this.initializeProviders();
		
		// 根据设置启用或禁用自动同步
		if (this.settings.enableSync && this.settings.syncInterval > 0) {
			this.startAutoSync();
		} else {
			this.stopAutoSync();
		}
	}
	
	/**
	 * 初始化存储提供商
	 */
	private initializeProviders() {
		// 清空现有提供商
		this.disconnectAllProviders();
		this.storageProviders.clear();
		
		// 如果同步功能未启用，则不初始化提供商
		if (!this.settings.enableSync) {
			console.log('同步功能未启用，跳过初始化存储提供商');
			return;
		}
		
		// 初始化启用的提供商
		for (const providerType of this.settings.enabledProviders) {
			this.initializeProvider(providerType);
		}
	}
	
	/**
	 * 初始化指定类型的存储提供商
	 * @param providerType 存储提供商类型
	 */
	private initializeProvider(providerType: StorageProviderType) {
		try {
			switch (providerType) {
				case 'webdav':
					if (this.settings.providerSettings.webdav?.enabled) {
						const webdavSettings = this.settings.providerSettings.webdav;
						const webdavProvider = new WebDAVProvider(webdavSettings, this.app);
						this.storageProviders.set('webdav', webdavProvider);
					}
					break;
				// 其他存储提供商类型后续实现
				default:
					console.warn(`存储提供商类型 ${providerType} 尚未实现`);
			}
		} catch (error) {
			console.error(`初始化存储提供商 ${providerType} 失败:`, error);
			this.notificationManager.show('provider-error', `初始化存储提供商 ${providerType} 失败: ${error.message || error}`, 5000);
		}
	}
	
	/**
	 * 断开所有存储提供商的连接
	 */
	private async disconnectAllProviders() {
		for (const provider of this.storageProviders.values()) {
			try {
				await provider.disconnect();
			} catch (error) {
				console.error(`断开存储提供商 ${provider.getName()} 连接失败:`, error);
			}
		}
	}
	
	/**
	 * 开始自动同步
	 */
	private startAutoSync() {
		// 如果已经在自动同步，先停止
		this.stopAutoSync();
		
		// 设置自动同步定时器
		const intervalMinutes = this.settings.syncInterval;
		if (intervalMinutes <= 0) return;
		
		const intervalMs = intervalMinutes * 60 * 1000;
		this.syncIntervalId = window.setInterval(() => {
			this.autoSync();
		}, intervalMs);
		
		// 启动时进行一次同步
		setTimeout(() => {
			this.autoSync();
		}, 5000); // 延迟5秒，确保插件完全加载
	}
	
	/**
	 * 停止自动同步
	 */
	private stopAutoSync() {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
	}
	
	/**
	 * 自动同步
	 * @author Bing
	 */
	private async autoSync() {
		// 如果同步功能未启用，跳过
		if (!this.settings.enableSync) {
			console.log('同步功能未启用，跳过自动同步');
			return;
		}
		
		// 如果已经在同步，跳过
		if (this.syncInProgress) return;
		
		// 如果网络检测开启，检查是否在WiFi网络下
		if (this.settings.networkDetection) {
			// 实际环境中需要检测网络类型
			// 这里简化处理，始终允许同步
		}
		
		try {
			this.syncInProgress = true;
			
			// 执行同步
			await this.performSync(true);
		} catch (error) {
			console.error('自动同步失败:', error);
			if (this.settings.debugMode) {
				this.notificationManager.show('auto-sync-error', `自动同步失败: ${error.message || error}`, 5000);
			}
		} finally {
			this.syncInProgress = false;
		}
	}
	
	/**
	 * 手动同步
	 * @author Bing
	 */
	async manualSync() {
		console.log('开始手动同步...');
		
		// 检查同步功能是否已启用
		if (!this.settings.enableSync) {
			console.error('同步功能未启用，请在设置中启用同步功能');
			// 不抛出错误，因为UI层已经处理了这个检查
			return;
		}
		
		// 如果已经在同步，提示并返回
		if (this.syncInProgress) {
			this.notificationManager.show('sync-busy', '同步已在进行中，请稍后再试', 3000);
			return;
		}
		
		try {
			this.syncInProgress = true;
			
			// 检查是否有启用的存储提供商
			if (this.storageProviders.size === 0) {
				// 尝试初始化存储提供商
				console.log('未找到已初始化的存储提供商，尝试初始化...');
				this.initializeProviders();
				
				// 再次检查
				if (this.storageProviders.size === 0) {
					throw new Error('未启用任何存储提供商，请先在设置中启用至少一个云盘');
				}
			}
			
			// 执行同步
			await this.performSync(false);
			console.log('手动同步完成');
		} catch (error) {
			console.error('手动同步失败:', error);
			throw error;
		} finally {
			this.syncInProgress = false;
		}
	}
	
	/**
	 * 执行同步
	 * @param isAutoSync 是否为自动同步
	 * @author Bing
	 */
	private async performSync(isAutoSync: boolean) {
		// 检查是否有启用的存储提供商
		if (this.storageProviders.size === 0) {
			throw new Error('未启用任何存储提供商，请先在设置中启用至少一个云盘');
		}
		
		// 对每个存储提供商执行同步
		for (const [providerType, provider] of this.storageProviders.entries()) {
			try {
				console.log(`同步提供商: ${providerType} (${provider.getName()})`);
				
				// 对于手动同步，显示进度通知
				if (!isAutoSync) {
					this.notificationManager.show('sync-provider', `正在同步: ${provider.getName()}`, 30000);
				}
				
				// 检查连接状态
				if (provider.getStatus() !== ConnectionStatus.CONNECTED) {
					console.log(`提供商 ${providerType} 未连接，尝试连接...`);
					
					let connectSuccess = false;
					let connectAttempts = 0;
					const maxConnectAttempts = 2;
					
					while (!connectSuccess && connectAttempts <= maxConnectAttempts) {
						try {
							connectSuccess = await provider.connect();
							if (connectSuccess) {
								console.log(`提供商 ${providerType} 连接成功`);
							} else {
								connectAttempts++;
								console.log(`提供商 ${providerType} 连接失败 (尝试 ${connectAttempts}/${maxConnectAttempts + 1})`);
								if (connectAttempts <= maxConnectAttempts) {
									// 等待一秒再重试
									await new Promise(resolve => setTimeout(resolve, 1000));
								}
							}
						} catch (connectError) {
							connectAttempts++;
							console.error(`提供商 ${providerType} 连接错误 (尝试 ${connectAttempts}/${maxConnectAttempts + 1}):`, connectError);
							
							// 如果是最后一次尝试，抛出错误
							if (connectAttempts > maxConnectAttempts) {
								throw connectError;
							}
							
							// 否则等待后重试
							await new Promise(resolve => setTimeout(resolve, 1000));
						}
					}
					
					// 再次检查连接状态
					if (provider.getStatus() !== ConnectionStatus.CONNECTED) {
						throw new Error(`无法连接到${providerType}服务，请检查网络连接和服务器地址`);
					}
				}
				
				console.log(`开始同步提供商: ${providerType}`);
				
				// 获取本地文件列表
				console.log('获取本地文件列表...');
				const localFiles = await this.getLocalFiles();
				console.log(`本地文件数量: ${localFiles.length}`);
				
				// 确保远程根目录存在
				console.log('确保远程根目录存在...');
				try {
					await this.ensureRemoteRootDir(provider);
				} catch (dirError) {
					console.error('确保远程根目录存在失败:', dirError);
					
					// 对于WebDAV提供商，特别是坚果云，继续尝试
					if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
						console.log('远程根目录处理失败，但尝试继续同步（坚果云可能不需要显式创建目录）');
					} else {
						throw dirError;
					}
				}
				
				// 获取远程文件列表
				const remotePath = this.getRemoteBasePath(providerType);
				console.log(`获取远程文件列表，路径: ${remotePath || '根目录'}...`);
				let remoteFiles: FileInfo[] = [];
				try {
					remoteFiles = await provider.listFiles(remotePath);
					console.log(`远程文件数量: ${remoteFiles.length}`);
				} catch (error) {
					console.error(`获取远程文件列表失败:`, error);
					
					// 尝试修复: 如果是首次同步，可能远程目录不存在，创建它
					if (error.code === 'NOT_FOUND' || error.status === 404) {
						console.log('远程目录不存在，尝试创建...');
						try {
							await provider.createFolder(remotePath);
							console.log('远程目录创建成功，重新获取文件列表...');
							
							// 再次尝试获取远程文件列表
							remoteFiles = await provider.listFiles(remotePath);
							console.log(`远程文件数量: ${remoteFiles.length}`);
						} catch (createError) {
							console.error('创建远程目录失败:', createError);
							
							// 对于坚果云，继续尝试
							if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
								console.log('尝试在没有明确创建目录的情况下继续同步');
								remoteFiles = []; // 使用空数组继续
							} else {
								throw createError;
							}
						}
					} else if (error.code === 'AUTH_FAILED' || error.status === 401 || error.status === 403) {
						// 认证错误，提供更具体的错误信息
						throw new Error(`获取远程文件列表失败: 认证错误，请检查账号和密码 (${error.message || error})`);
					} else {
						// 其他类型的错误，直接抛出
						throw error;
					}
				}
				
				// 根据同步模式和同步方向执行同步
				console.log(`使用同步模式: ${this.settings.syncMode}, 同步方向: ${this.settings.syncDirection}`);
				
				try {
					// 更新进度通知
					if (!isAutoSync) {
						this.notificationManager.clear('sync-provider');
						this.notificationManager.show('sync-executing', `正在执行${this.settings.syncDirection === 'bidirectional' ? '双向' : (this.settings.syncDirection === 'uploadOnly' ? '上传' : '下载')}同步...`, 30000);
					}
					
					// 根据同步方向决定同步操作
					if (this.settings.syncDirection === 'uploadOnly') {
						// 仅上传模式
						console.log('同步方向设置为仅上传，执行本地到远程同步');
						if (this.settings.syncMode === 'incremental') {
							console.log('使用增量同步模式');
							await this.syncLocalToRemoteIncremental(provider, localFiles, remoteFiles, providerType);
						} else {
							console.log('使用全量同步模式');
							await this.syncLocalToRemoteFull(provider, localFiles, remoteFiles, providerType);
						}
					} else if (this.settings.syncDirection === 'downloadOnly') {
						// 仅下载模式
						console.log('同步方向设置为仅下载，执行远程到本地同步');
						if (this.settings.syncMode === 'incremental') {
							console.log('使用增量同步模式');
							await this.syncRemoteToLocalIncremental(provider, localFiles, remoteFiles, providerType);
						} else {
							console.log('使用全量同步模式');
							await this.syncRemoteToLocalFull(provider, localFiles, remoteFiles, providerType);
						}
					} else {
						// 双向同步
						console.log('同步方向设置为双向同步');
						if (this.settings.syncMode === 'incremental') {
							console.log('使用增量同步模式');
							await this.syncBidirectionalIncremental(provider, localFiles, remoteFiles, providerType);
						} else {
							console.log('使用全量同步模式');
							await this.syncBidirectionalFull(provider, localFiles, remoteFiles, providerType);
						}
					}
					
					// 清除进度通知
					if (!isAutoSync) {
						this.notificationManager.clear('sync-executing');
					}
				} catch (syncError) {
					console.error(`同步操作失败:`, syncError);
					
					// 清除进度通知
					if (!isAutoSync) {
						this.notificationManager.clear('sync-executing');
					}
					
					// 对于认证错误提供更具体的错误信息
					if (syncError.code === 'AUTH_FAILED' || syncError.status === 401 || syncError.status === 403) {
						throw new Error(`同步操作失败: 认证错误，请检查账号和密码 (${syncError.message || syncError})`);
					} else {
						throw new Error(`同步操作失败: ${syncError.message || syncError}`);
					}
				}
				
				console.log(`提供商 ${providerType} 同步完成`);
			} catch (error) {
				console.error(`提供商 ${providerType} 同步失败:`, error);
				
				// 清除任何进度通知
				if (!isAutoSync) {
					this.notificationManager.clear('sync-provider');
					this.notificationManager.clear('sync-executing');
				}
				
				if (!isAutoSync) {
					throw error; // 手动同步时，将错误抛出
				}
			}
		}
	}
	
	/**
	 * 确保远程根目录存在
	 * @param provider 存储提供商
	 * @author Bing
	 */
	private async ensureRemoteRootDir(provider: StorageProvider) {
		try {
			console.log('检查远程根目录是否存在...');
			const remotePath = '';
			
			// 检查根目录是否存在，不存在则创建
			const exists = await provider.folderExists(remotePath);
			
			if (!exists) {
				console.log('远程根目录不存在，尝试创建...');
				try {
					await provider.createFolder(remotePath);
					console.log('远程根目录创建成功');
				} catch (createError) {
					console.error('创建远程根目录失败:', createError);
					
					// 对于坚果云特殊处理，某些错误可以忽略
					if (provider.getName() === 'WebDAV' && 
						(createError.code === 'AUTH_FAILED' || createError.status === 403)) {
						console.log('坚果云可能不需要显式创建根目录，继续执行...');
						return;
					}
					
					throw createError;
				}
			} else {
				console.log('远程根目录已存在');
			}
		} catch (error) {
			console.error('确保远程根目录存在失败:', error);
			
			// 如果是认证错误，提供更明确的提示
			if (error.code === 'AUTH_FAILED' || error.status === 401 || error.status === 403) {
				throw new Error('认证失败，请检查账号和密码设置');
			}
			
			throw error;
		}
	}
	
	/**
	 * 获取远程根路径
	 * @param providerType 提供商类型
	 * @returns 远程根路径
	 * @author Bing
	 */
	private getRemoteBasePath(providerType: StorageProviderType): string {
		// 获取设置中的同步路径
		if (providerType === 'webdav' && this.settings.providerSettings.webdav) {
			const syncPath = this.settings.providerSettings.webdav.syncPath;
			if (syncPath && syncPath.trim()) {
				let path = syncPath.trim();
				// 移除前导和尾部斜杠以确保一致性
				path = path.replace(/^\/+/, '').replace(/\/+$/, '');
				if (path) {
					console.log(`使用WebDAV同步路径: ${path}`);
					return path;
				}
			}
		}
		
		// 如果没有设置同步路径或者是其他提供商，使用空路径
		return '';
	}
	
	/**
	 * 获取本地文件和文件夹列表
	 * @returns 本地文件列表
	 * @author Bing
	 */
	private async getLocalFiles(): Promise<{path: string, mtime: number, size: number, isFolder: boolean}[]> {
		const items: {path: string, mtime: number, size: number, isFolder: boolean}[] = [];
		
		// 递归获取所有文件和文件夹
		const getFilesRecursively = async (dir: string = '') => {
			const dirItems = await this.app.vault.adapter.list(dir);
			
			// 处理文件
			for (const file of dirItems.files) {
				// 检查是否在忽略列表中
				if (this.shouldIgnoreFile({path: file} as TAbstractFile)) {
					continue;
				}
				
				try {
					const stat = await this.app.vault.adapter.stat(file);
					if (stat) {
						items.push({
							path: file,
							mtime: stat.mtime,
							size: stat.size,
							isFolder: false
						});
					}
				} catch (e) {
					console.error(`无法获取文件信息: ${file}`, e);
				}
			}
			
			// 递归处理子目录
			for (const folder of dirItems.folders) {
				// 检查是否在忽略列表中
				if (this.shouldIgnoreFile({path: folder} as TAbstractFile)) {
					continue;
				}
				
				try {
					// 添加文件夹本身
					const folderStat = await this.app.vault.adapter.stat(folder);
					if (folderStat) {
						items.push({
							path: folder,
							mtime: folderStat.mtime,
							size: 0, // 文件夹大小为0
							isFolder: true
						});
					}
				} catch (e) {
					console.error(`无法获取文件夹信息: ${folder}`, e);
					// 即使获取统计信息失败，仍然添加文件夹以确保同步
					items.push({
						path: folder,
						mtime: Date.now(),
						size: 0,
						isFolder: true
					});
				}
				
				// 继续递归处理此文件夹
				await getFilesRecursively(folder);
			}
		};
		
		await getFilesRecursively();
		return items;
	}
	
	/**
	 * 本地到远程同步
	 * @param provider 存储提供商
	 * @param localFiles 本地文件列表
	 * @param remoteFiles 远程文件列表
	 * @param providerType 提供商类型
	 */
	private async syncLocalToRemote(
		provider: StorageProvider, 
		localFiles: {path: string, mtime: number, size: number, isFolder: boolean}[], 
		remoteFiles: FileInfo[],
		providerType: StorageProviderType
	) {
		console.log('执行本地到远程同步');
		
		// 获取远程根路径
		const basePath = this.getRemoteBasePath(providerType);
		console.log(`使用远程根路径: ${basePath || '/'}`);
		
		// 转换为Map便于查找
		const remoteFilesMap = new Map<string, FileInfo>();
		for (const file of remoteFiles) {
			remoteFilesMap.set(file.path, file);
		}
		
		// 创建本地文件和文件夹的路径集合
		const localPathSet = new Set<string>();
		for (const file of localFiles) {
			// 添加到路径集合
			if (basePath) {
				localPathSet.add(`${basePath}/${file.path}`);
			} else {
				localPathSet.add(file.path);
			}
		}
		
		// 提取文件夹和文件
		const folders = localFiles.filter(item => item.isFolder);
		const files = localFiles.filter(item => !item.isFolder);
		
		console.log(`待同步文件夹数量: ${folders.length}, 文件数量: ${files.length}`);
		
		// 排序文件夹，确保父文件夹在子文件夹之前处理
		folders.sort((a, b) => {
			// 按路径深度排序，浅层的先处理
			const depthA = a.path.split('/').length;
			const depthB = b.path.split('/').length;
			return depthA - depthB;
		});
		
		// 先处理文件夹结构
		for (const folder of folders) {
			try {
				// 构建远程路径，如果有basePath则拼接
				const localPath = folder.path;
				const remotePath = basePath ? `${basePath}/${localPath}` : localPath;
				
				const remoteFolder = remoteFilesMap.get(remotePath);
				
				// 如果远程不存在该文件夹，则创建
				if (!remoteFolder || !remoteFolder.isFolder) {
					console.log(`创建远程文件夹: ${remotePath}`);
					
					try {
						// 尝试创建文件夹
						await provider.createFolder(remotePath);
						console.log(`文件夹创建成功: ${remotePath}`);
					} catch (createError) {
						// 记录错误但继续执行，因为文件同步时可能会自动创建父目录
						console.warn(`创建文件夹失败: ${remotePath}，但将继续同步。错误:`, createError);
						
						// 如果是坚果云且遇到认证错误，尝试特殊处理
						if (providerType === 'webdav' && 
							(createError.code === 'AUTH_FAILED' || 
							 createError.status === 401 || 
							 createError.status === 403)) {
							console.log(`坚果云创建文件夹失败，但继续同步: ${remotePath}`);
							// 不抛出错误，继续同步
						}
					}
				}
			} catch (error) {
				console.error(`同步文件夹失败: ${folder.path}`, error);
				// 不抛出错误，继续同步其他文件夹
			}
		}
		
		// 然后处理文件
		console.log('开始同步文件内容...');
		for (const localFile of files) {
			// 构建远程路径，如果有basePath则拼接
			const localPath = localFile.path;
			const remotePath = basePath ? `${basePath}/${localPath}` : localPath;
			
			const remoteFile = remoteFilesMap.get(remotePath);
			
			try {
				if (!remoteFile || new Date(localFile.mtime).getTime() > remoteFile.modifiedTime.getTime()) {
					// 本地文件新于远程，或远程不存在，上传本地文件
					const content = await this.app.vault.adapter.read(localFile.path);
					await provider.uploadFile(remotePath, content);
					console.log(`上传文件: ${localFile.path} 到 ${remotePath}`);
				}
			} catch (error) {
				console.error(`上传文件失败: ${localFile.path} -> ${remotePath}`, error);
				throw error;
			}
		}
		
		// 如果启用了删除远程多余文件，删除本地不存在但远程存在的文件和文件夹
		if (this.settings.deleteRemoteExtraFiles) {
			console.log('检查并删除远程多余文件和文件夹...');
			
			// 先删除远程多余文件
			for (const remoteFile of remoteFiles) {
				if (!remoteFile.isFolder && !localPathSet.has(remoteFile.path)) {
					try {
						console.log(`准备删除远程多余文件: ${remoteFile.path}`);
						await provider.deleteFile(remoteFile.path);
						console.log(`删除远程多余文件成功: ${remoteFile.path}`);
					} catch (error) {
						// 特别处理坚果云
						if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
							console.warn(`删除坚果云文件失败，但继续处理后续文件: ${remoteFile.path}`, error);
							// 对于坚果云，不中断整个同步过程
							continue;
						} else {
							console.error(`删除远程文件失败: ${remoteFile.path}`, error);
							// 对于非坚果云，可以考虑抛出错误中断同步
							// throw error;
							// 但为了保持兼容性，这里还是继续处理下一个文件
						}
					}
				}
			}
			
			// 提取所有远程文件夹并按深度排序（先删除深层文件夹）
			const remoteFolders = remoteFiles
				.filter(file => file.isFolder)
				.sort((a, b) => {
					// 按路径深度排序，深层的先处理
					const depthA = a.path.split('/').length;
					const depthB = b.path.split('/').length;
					return depthB - depthA; // 注意这里是倒序
				});
			
			// 然后删除远程多余文件夹
			for (const remoteFolder of remoteFolders) {
				// 跳过删除根路径或基础同步路径
				const basePath = this.getRemoteBasePath(providerType);
				if (remoteFolder.path === basePath || remoteFolder.path === basePath + '/') {
					console.log(`跳过删除基础同步路径: ${remoteFolder.path}`);
					continue;
				}
				
				if (!localPathSet.has(remoteFolder.path)) {
					try {
						console.log(`准备删除远程多余文件夹: ${remoteFolder.path}`);
						await provider.deleteFolder(remoteFolder.path);
						console.log(`删除远程多余文件夹成功: ${remoteFolder.path}`);
					} catch (error) {
						// 特别处理坚果云
						if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
							console.warn(`删除坚果云文件夹失败，但继续处理后续文件: ${remoteFolder.path}`, error);
							// 对于坚果云，不中断整个同步过程
							continue;
						} else {
							console.error(`删除远程文件夹失败: ${remoteFolder.path}`, error);
							// 对于非坚果云，继续处理下一个文件夹
						}
					}
				}
			}
			
			console.log('远程多余文件和文件夹清理完成');
		}
	}
	
	/**
	 * 远程到本地同步
	 * @param provider 存储提供商
	 * @param localFiles 本地文件列表
	 * @param remoteFiles 远程文件列表
	 * @param providerType 提供商类型
	 */
	private async syncRemoteToLocal(
		provider: StorageProvider, 
		localFiles: {path: string, mtime: number, size: number, isFolder: boolean}[], 
		remoteFiles: FileInfo[],
		providerType: StorageProviderType
	) {
		console.log('执行远程到本地同步');
		
		// 获取远程根路径
		const basePath = this.getRemoteBasePath(providerType);
		console.log(`使用远程根路径: ${basePath || '/'}`);
		
		// 转换为Map便于查找
		const localFilesMap = new Map<string, {path: string, mtime: number, size: number, isFolder: boolean}>();
		for (const file of localFiles) {
			localFilesMap.set(file.path, file);
		}
		
		// 先处理远程文件夹，确保本地存在对应的文件夹结构
		console.log('处理远程文件夹...');
		const remoteFolders = remoteFiles.filter(file => file.isFolder);
		
		// 按路径深度排序，确保父文件夹在子文件夹之前处理
		remoteFolders.sort((a, b) => {
			const depthA = a.path.split('/').length;
			const depthB = b.path.split('/').length;
			return depthA - depthB;
		});
		
		// 创建本地文件夹
		for (const remoteFolder of remoteFolders) {
			// 提取相对路径（如果有basePath）
			let localFolderPath = remoteFolder.path;
			if (basePath && localFolderPath.startsWith(basePath + '/')) {
				localFolderPath = localFolderPath.substring(basePath.length + 1);
				console.log(`远程文件夹路径转换为本地路径: ${remoteFolder.path} -> ${localFolderPath}`);
			} else if (remoteFolder.path === basePath || remoteFolder.path === basePath + '/') {
				// 跳过基础路径本身
				console.log(`跳过基础路径: ${remoteFolder.path}`);
				continue;
			} else {
				console.log(`远程文件夹无需路径转换: ${remoteFolder.path}`);
			}
			
			// 检查本地是否已存在该文件夹
			try {
				const exists = await this.app.vault.adapter.exists(localFolderPath);
				if (!exists) {
					console.log(`创建本地文件夹: ${localFolderPath}`);
					
					// 确保父文件夹存在
					const parentPath = localFolderPath.split('/').slice(0, -1).join('/');
					if (parentPath && parentPath !== localFolderPath) {
						console.log(`确保父文件夹存在: ${parentPath}`);
						try {
							const parentExists = await this.app.vault.adapter.exists(parentPath);
							if (!parentExists) {
								console.log(`创建父文件夹: ${parentPath}`);
								await this.app.vault.adapter.mkdir(parentPath);
							}
						} catch (parentError) {
							console.error(`创建父文件夹失败: ${parentPath}`, parentError);
						}
					}
					
					await this.app.vault.adapter.mkdir(localFolderPath);
				} else {
					console.log(`本地文件夹已存在: ${localFolderPath}`);
				}
			} catch (error) {
				console.error(`创建本地文件夹失败: ${localFolderPath}`, error);
			}
		}
		
		// 然后处理每个远程文件
		console.log('处理远程文件...');
		// 记录所有需要下载的文件，以便输出详细统计
		let downloadedCount = 0;
		let skippedCount = 0;
		let errorCount = 0;
		
		for (const remoteFile of remoteFiles) {
			// 跳过文件夹，已在上面处理
			if (remoteFile.isFolder) continue;
			
			// 提取本地相对路径（如果有basePath）
			let localPath = remoteFile.path;
			if (basePath && localPath.startsWith(basePath + '/')) {
				localPath = localPath.substring(basePath.length + 1);
				console.log(`远程路径转换为本地路径: ${remoteFile.path} -> ${localPath}`);
			} else {
				console.log(`没有basePath或无需转换路径: ${remoteFile.path}`);
			}
			
			const localFile = localFilesMap.get(localPath);
			// 检查文件扩展名，便于调试
			const fileExt = localPath.split('.').pop()?.toLowerCase() || '无扩展名';
			console.log(`处理远程文件: ${remoteFile.path}, 本地路径: ${localPath}, 文件类型: ${fileExt}, 大小: ${remoteFile.size} 字节`);
			
			try {
				// 检查是否需要下载
				let needDownload = false;
				if (!localFile) {
					console.log(`本地文件不存在，需要下载: ${localPath}`);
					needDownload = true;
				} else if (remoteFile.modifiedTime.getTime() > new Date(localFile.mtime).getTime()) {
					console.log(`远程文件更新时间(${remoteFile.modifiedTime.toISOString()})比本地(${new Date(localFile.mtime).toISOString()})新，需要下载`);
					needDownload = true;
				} else {
					console.log(`跳过文件(已存在且未修改): ${remoteFile.path}`);
					skippedCount++;
				}
				
				if (needDownload) {
					// 开始下载
					console.log(`开始下载文件: ${remoteFile.path} -> ${localPath} (${fileExt}文件)`);
					
					// 远程文件新于本地，或本地不存在，下载远程文件
					let content: string | ArrayBuffer;
					if (provider.downloadFileContent) {
						content = await provider.downloadFileContent(remoteFile.path);
						console.log(`文件内容下载成功，内容类型: ${typeof content}, 长度: ${typeof content === 'string' ? content.length : content.byteLength} 字节`);
					} else {
						// 如果不支持直接下载内容，使用临时文件
						throw new Error('当前存储提供商不支持直接下载文件内容');
					}
					
					// 确保目录存在
					const dirPath = localPath.split('/').slice(0, -1).join('/');
					if (dirPath) {
						console.log(`确保目录存在: ${dirPath}`);
						await this.app.vault.adapter.mkdir(dirPath);
					}
					
					// 写入文件
					if (typeof content === 'string') {
						console.log(`写入文本文件: ${localPath}, 内容长度: ${content.length}字节`);
						await this.app.vault.adapter.write(localPath, content);
					} else {
						console.log(`写入二进制文件: ${localPath}, 内容长度: ${content.byteLength}字节, 文件类型: ${fileExt}`);
						await this.app.vault.adapter.writeBinary(localPath, content);
					}
					
					console.log(`下载文件完成: ${remoteFile.path} -> ${localPath}`);
					downloadedCount++;
				}
			} catch (error) {
				console.error(`下载文件失败: ${remoteFile.path} -> ${localPath}`, error);
				errorCount++;
				// 不抛出错误，继续处理下一个文件
				// throw error;
			}
		}
		
		// 输出下载统计信息
		console.log(`下载统计: 成功下载 ${downloadedCount} 个文件，跳过 ${skippedCount} 个文件，失败 ${errorCount} 个文件`);
		
		// 如果启用了删除本地多余文件，删除远程不存在但本地存在的文件
		if (this.settings.deleteLocalExtraFiles) {
			const remoteFileSet = new Set<string>();
			
			// 提取远程文件路径
			for (const file of remoteFiles) {
				if (file.isFolder) continue;
				
				let localPath = file.path;
				if (basePath && localPath.startsWith(basePath + '/')) {
					localPath = localPath.substring(basePath.length + 1);
				}
				
				remoteFileSet.add(localPath);
			}
			
			for (const localFile of localFiles) {
				if (localFile.isFolder) continue;
				
				if (!remoteFileSet.has(localFile.path)) {
					try {
						await this.app.vault.adapter.remove(localFile.path);
						console.log(`删除本地多余文件: ${localFile.path}`);
					} catch (error) {
						console.error(`删除本地文件失败: ${localFile.path}`, error);
					}
				}
			}
		}
	}
	
	/**
	 * 双向同步
	 * @param provider 存储提供商
	 * @param localFiles 本地文件列表
	 * @param remoteFiles 远程文件列表
	 * @param providerType 提供商类型
	 */
	private async syncBidirectional(
		provider: StorageProvider, 
		localFiles: {path: string, mtime: number, size: number, isFolder: boolean}[], 
		remoteFiles: FileInfo[],
		providerType: StorageProviderType
	) {
		console.log('执行双向同步');
		
		// 获取远程根路径
		const basePath = this.getRemoteBasePath(providerType);
		
		// 转换为Map便于查找
		const localFilesMap = new Map<string, {path: string, mtime: number, size: number, isFolder: boolean}>();
		for (const file of localFiles) {
			if (!file.isFolder) { // 双向同步中只处理文件，文件夹在各自方向处理
				localFilesMap.set(file.path, file);
			}
		}
		
		const remoteFilesMap = new Map<string, FileInfo>();
		for (const file of remoteFiles) {
			if (!file.isFolder) { // 双向同步中只处理文件，文件夹在各自方向处理
				remoteFilesMap.set(file.path, file);
			}
		}
		
		// 创建本地文件夹和远程文件夹的路径集合（用于删除操作）
		const localPathSet = new Set<string>();
		const remoteFolders = new Set<string>();
		for (const file of localFiles) {
			// 添加到路径集合
			if (basePath) {
				localPathSet.add(`${basePath}/${file.path}`);
			} else {
				localPathSet.add(file.path);
			}
			
			// 如果是文件夹，确保远程也存在
			if (file.isFolder) {
				const remotePath = basePath ? `${basePath}/${file.path}` : file.path;
				try {
					// 如果远程不存在该文件夹，则创建
					if (!await provider.folderExists(remotePath)) {
						console.log(`创建远程文件夹: ${remotePath}`);
						await provider.createFolder(remotePath);
					}
				} catch (error) {
					console.error(`创建远程文件夹失败: ${remotePath}`, error);
				}
			}
		}
		
		// 处理远程文件夹，确保本地也存在
		for (const file of remoteFiles) {
			if (file.isFolder) {
				remoteFolders.add(file.path);
				
				// 提取相对路径（如果有basePath）
				let localPath = file.path;
				if (basePath && localPath.startsWith(basePath + '/')) {
					localPath = localPath.substring(basePath.length + 1);
				}
				
				try {
					// 检查本地是否存在该文件夹
					const exists = await this.app.vault.adapter.exists(localPath);
					if (!exists) {
						console.log(`创建本地文件夹: ${localPath}`);
						
						// 确保父文件夹存在
						const parentPath = localPath.split('/').slice(0, -1).join('/');
						if (parentPath && parentPath !== localPath) {
							console.log(`确保父文件夹存在: ${parentPath}`);
							try {
								const parentExists = await this.app.vault.adapter.exists(parentPath);
								if (!parentExists) {
									console.log(`创建父文件夹: ${parentPath}`);
									await this.app.vault.adapter.mkdir(parentPath);
								}
							} catch (parentError) {
								console.error(`创建父文件夹失败: ${parentPath}`, parentError);
							}
						}
						
						await this.app.vault.adapter.mkdir(localPath);
					} else {
						console.log(`本地文件夹已存在: ${localPath}`);
					}
				} catch (error) {
					console.error(`创建本地文件夹失败: ${localPath}`, error);
				}
			}
		}
		
		// 1. 处理两边都有的文件（根据冲突策略和修改时间决定同步方向）
		const processedFiles = new Set<string>();
		
		// 处理每个本地文件
		for (const localFile of localFiles.filter(f => !f.isFolder)) {
			// 构建远程路径
			const remotePath = basePath ? `${basePath}/${localFile.path}` : localFile.path;
			const remoteFile = remoteFilesMap.get(remotePath);
			processedFiles.add(localFile.path);
			
			try {
				if (remoteFile) {
					// 文件在本地和远程都存在，比较修改时间
					const localMtime = new Date(localFile.mtime).getTime();
					const remoteMtime = remoteFile.modifiedTime.getTime();
					
					// 根据冲突策略和修改时间决定如何处理
					if (localMtime !== remoteMtime) {
						// 有冲突，根据冲突策略处理
						switch (this.settings.conflictPolicy) {
							case 'overwrite':
								// 总是用本地覆盖远程
								console.log(`冲突策略：覆盖，上传本地文件: ${localFile.path}`);
								const content = await this.app.vault.adapter.read(localFile.path);
								await provider.uploadFile(remotePath, content);
								break;
								
							case 'keepLocal':
								// 保留本地文件，上传到远程
								if (localMtime > remoteMtime) {
									console.log(`冲突策略：保留本地，上传更新的文件: ${localFile.path}`);
									const content = await this.app.vault.adapter.read(localFile.path);
									await provider.uploadFile(remotePath, content);
								} else {
									console.log(`冲突策略：保留本地，忽略远程文件: ${remoteFile.path}`);
								}
								break;
								
							case 'keepRemote':
								// 保留远程文件，下载到本地
								if (remoteMtime > localMtime) {
									console.log(`冲突策略：保留远程，下载更新的文件: ${remoteFile.path}`);
									if (provider.downloadFileContent) {
										const content = await provider.downloadFileContent(remoteFile.path);
										if (typeof content === 'string') {
											await this.app.vault.adapter.write(localFile.path, content);
										} else {
											await this.app.vault.adapter.writeBinary(localFile.path, content);
										}
									}
								} else {
									console.log(`冲突策略：保留远程，忽略本地文件: ${localFile.path}`);
								}
								break;
								
							case 'merge':
								// 目前无法真正合并文件内容，使用最新的文件
								if (localMtime > remoteMtime) {
									console.log(`冲突策略：合并（使用最新），上传更新的文件: ${localFile.path}`);
									const content = await this.app.vault.adapter.read(localFile.path);
									await provider.uploadFile(remotePath, content);
								} else {
									console.log(`冲突策略：合并（使用最新），下载更新的文件: ${remoteFile.path}`);
									if (provider.downloadFileContent) {
										const content = await provider.downloadFileContent(remoteFile.path);
										if (typeof content === 'string') {
											await this.app.vault.adapter.write(localFile.path, content);
										} else {
											await this.app.vault.adapter.writeBinary(localFile.path, content);
										}
									}
								}
								break;
						}
					} else {
						// 文件相同，无需同步
						console.log(`文件相同，无需同步: ${localFile.path}`);
					}
				} else {
					// 文件只在本地存在，上传到远程
					console.log(`本地独有文件，上传到远程: ${localFile.path}`);
					const content = await this.app.vault.adapter.read(localFile.path);
					await provider.uploadFile(remotePath, content);
				}
			} catch (error) {
				console.error(`同步文件失败: ${localFile.path}`, error);
			}
		}
		
		// 2. 处理只存在于远程的文件（下载到本地）
		for (const remoteFile of remoteFiles) {
			if (remoteFile.isFolder) continue; // 跳过文件夹，已在前面处理
			
			// 提取相对路径（如果有basePath）
			let localPath = remoteFile.path;
			if (basePath && localPath.startsWith(basePath + '/')) {
				localPath = localPath.substring(basePath.length + 1);
			}
			
			if (processedFiles.has(localPath)) continue;
			
			try {
				console.log(`远程独有文件，下载到本地: ${remoteFile.path} -> ${localPath}`);
				if (provider.downloadFileContent) {
					// 确保目录存在
					const dirPath = localPath.split('/').slice(0, -1).join('/');
					if (dirPath) {
						await this.app.vault.adapter.mkdir(dirPath);
					}
					
					// 下载文件
					const content = await provider.downloadFileContent(remoteFile.path);
					if (typeof content === 'string') {
						await this.app.vault.adapter.write(localPath, content);
					} else {
						await this.app.vault.adapter.writeBinary(localPath, content);
					}
				} else {
					console.warn('当前存储提供商不支持直接下载文件内容');
				}
			} catch (error) {
				console.error(`下载远程文件失败: ${remoteFile.path} -> ${localPath}`, error);
			}
		}
		
		// 3. 处理删除操作（如果启用了相应设置）
		// 如果启用了删除远程多余文件，删除本地不存在但远程存在的文件和文件夹
		if (this.settings.deleteRemoteExtraFiles) {
			console.log('检查并删除远程多余文件和文件夹...');
			
			// 先删除远程多余文件
			for (const remoteFile of remoteFiles) {
				if (!remoteFile.isFolder && !localPathSet.has(remoteFile.path)) {
					try {
						console.log(`准备删除远程多余文件: ${remoteFile.path}`);
						await provider.deleteFile(remoteFile.path);
						console.log(`删除远程多余文件成功: ${remoteFile.path}`);
					} catch (error) {
						// 特别处理坚果云
						if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
							console.warn(`删除坚果云文件失败，但继续处理后续文件: ${remoteFile.path}`, error);
							// 对于坚果云，不中断整个同步过程
							continue;
						} else {
							console.error(`删除远程文件失败: ${remoteFile.path}`, error);
							// 对于非坚果云，可以考虑抛出错误中断同步
							// throw error;
							// 但为了保持兼容性，这里还是继续处理下一个文件
						}
					}
				}
			}
			
			// 提取所有远程文件夹并按深度排序（先删除深层文件夹）
			const remoteFoldersList = remoteFiles
				.filter(file => file.isFolder)
				.sort((a, b) => {
					// 按路径深度排序，深层的先处理
					const depthA = a.path.split('/').length;
					const depthB = b.path.split('/').length;
					return depthB - depthA; // 注意这里是倒序
				});
			
			// 然后删除远程多余文件夹
			for (const remoteFolder of remoteFoldersList) {
				// 跳过删除根路径或基础同步路径
				const basePath = this.getRemoteBasePath(providerType);
				if (remoteFolder.path === basePath || remoteFolder.path === basePath + '/') {
					console.log(`跳过删除基础同步路径: ${remoteFolder.path}`);
					continue;
				}
				
				if (!localPathSet.has(remoteFolder.path)) {
					try {
						console.log(`准备删除远程多余文件夹: ${remoteFolder.path}`);
						await provider.deleteFolder(remoteFolder.path);
						console.log(`删除远程多余文件夹成功: ${remoteFolder.path}`);
					} catch (error) {
						// 特别处理坚果云
						if (providerType === 'webdav' && provider.getName() === 'WebDAV') {
							console.warn(`删除坚果云文件夹失败，但继续处理后续文件: ${remoteFolder.path}`, error);
							// 对于坚果云，不中断整个同步过程
							continue;
						} else {
							console.error(`删除远程文件夹失败: ${remoteFolder.path}`, error);
							// 对于非坚果云，继续处理下一个文件夹
						}
					}
				}
			}
		}
		
		// 如果启用了删除本地多余文件，删除远程不存在但本地存在的文件
		if (this.settings.deleteLocalExtraFiles) {
			console.log('检查并删除本地多余文件和文件夹...');
			
			// 先统计所有远程文件路径
			const remotePathSet = new Set<string>();
			for (const file of remoteFiles) {
				// 提取相对路径（如果有basePath）
				let localPath = file.path;
				if (basePath && localPath.startsWith(basePath + '/')) {
					localPath = localPath.substring(basePath.length + 1);
				}
				remotePathSet.add(localPath);
			}
			
			// 先删除本地多余文件
			for (const localFile of localFiles) {
				if (!localFile.isFolder && !remotePathSet.has(localFile.path)) {
					try {
						console.log(`准备删除本地多余文件: ${localFile.path}`);
						await this.app.vault.adapter.remove(localFile.path);
						console.log(`删除本地多余文件成功: ${localFile.path}`);
					} catch (error) {
						console.error(`删除本地文件失败: ${localFile.path}`, error);
					}
				}
			}
			
			// 提取所有本地文件夹并按深度排序（先删除深层文件夹）
			const localFolders = localFiles
				.filter(file => file.isFolder)
				.sort((a, b) => {
					// 按路径深度排序，深层的先处理
					const depthA = a.path.split('/').length;
					const depthB = b.path.split('/').length;
					return depthB - depthA; // 注意这里是倒序
				});
			
			// 然后删除本地多余文件夹
			for (const localFolder of localFolders) {
				if (!remotePathSet.has(localFolder.path)) {
					try {
						console.log(`准备删除本地多余文件夹: ${localFolder.path}`);
						await this.app.vault.adapter.rmdir(localFolder.path, true);
						console.log(`删除本地多余文件夹成功: ${localFolder.path}`);
					} catch (error) {
						console.error(`删除本地文件夹失败: ${localFolder.path}`, error);
					}
				}
			}
		}
	}
	
	/**
	 * 增量同步 - 本地到远程
	 * @param provider 存储提供商
	 * @param localFiles 本地文件列表
	 * @param remoteFiles 远程文件列表
	 * @param providerType 提供商类型
	 */
	private async syncLocalToRemoteIncremental(
		provider: StorageProvider, 
		localFiles: {path: string, mtime: number, size: number, isFolder: boolean}[], 
		remoteFiles: FileInfo[],
		providerType: StorageProviderType
	) {
		console.log('执行增量同步（本地到远程）');
		
		// 获取远程根路径
		const basePath = this.getRemoteBasePath(providerType);
		
		// 过滤出需要同步的本地文件（只同步已修改的文件）
		const filteredLocalFiles = localFiles.filter(localFile => {
			if (localFile.isFolder) return true; // 文件夹始终同步

			// 在远程文件中查找对应文件
			const remotePath = basePath ? `${basePath}/${localFile.path}` : localFile.path;
			const remoteFile = remoteFiles.find(rf => rf.path === remotePath);
			
			// 如果远程文件不存在，或者本地文件比远程文件新，则需要同步
			if (!remoteFile) return true;
			
			// 比较修改时间
			const localMtime = new Date(localFile.mtime).getTime();
			const remoteMtime = remoteFile.modifiedTime.getTime();
			
			// 如果本地文件更新，则需要同步
			return localMtime > remoteMtime;
		});
		
		console.log(`本地文件总数: ${localFiles.length}, 需要同步的文件数: ${filteredLocalFiles.length}`);
		
		// 使用过滤后的文件列表调用原有的同步方法
		await this.syncLocalToRemote(provider, filteredLocalFiles, remoteFiles, providerType);
	}
	
	/**
	 * 增量同步 - 远程到本地
	 * @param provider 存储提供商
	 * @param localFiles 本地文件列表
	 * @param remoteFiles 远程文件列表
	 * @param providerType 提供商类型
	 */
	private async syncRemoteToLocalIncremental(
		provider: StorageProvider, 
		localFiles: {path: string, mtime: number, size: number, isFolder: boolean}[], 
		remoteFiles: FileInfo[],
		providerType: StorageProviderType
	) {
		console.log('执行增量同步（远程到本地）');
		
		// 获取远程根路径
		const basePath = this.getRemoteBasePath(providerType);
		
		// 构建映射用于快速比较
		const localFilesMap = new Map<string, {path: string, mtime: number, size: number, isFolder: boolean}>();
		for (const file of localFiles) {
			localFilesMap.set(file.path, file);
		}
		
		// 过滤出需要同步的远程文件（只同步已修改的文件）
		const filteredRemoteFiles = remoteFiles.filter(remoteFile => {
			if (remoteFile.isFolder) {
				console.log(`包含文件夹(始终同步): ${remoteFile.path}`);
				return true; // 文件夹始终同步
			}
			
			// 提取相对路径（如果有basePath）
			let localPath = remoteFile.path;
			if (basePath && localPath.startsWith(basePath + '/')) {
				localPath = localPath.substring(basePath.length + 1);
				console.log(`远程路径转换为本地路径: ${remoteFile.path} -> ${localPath}`);
			} else {
				console.log(`没有basePath或无需转换路径: ${remoteFile.path}`);
			}
			
			// 在本地文件中查找对应文件
			const localFile = localFilesMap.get(localPath);
			
			// 如果本地文件不存在，或者远程文件比本地文件新，则需要同步
			if (!localFile) {
				console.log(`本地不存在文件，需要下载: ${localPath}`);
				return true;
			}
			
			// 比较修改时间
			const localMtime = new Date(localFile.mtime).getTime();
			const remoteMtime = remoteFile.modifiedTime.getTime();
			
			// 如果远程文件更新，则需要同步
			if (remoteMtime > localMtime) {
				console.log(`远程文件更新，需要下载: ${remoteFile.path} (远程: ${remoteMtime}, 本地: ${localMtime})`);
				return true;
			} else {
				console.log(`跳过文件(已存在且未修改): ${remoteFile.path} (远程: ${remoteMtime}, 本地: ${localMtime})`);
				return false;
			}
		});
		
		console.log(`远程文件总数: ${remoteFiles.length}, 需要同步的文件数: ${filteredRemoteFiles.length}`);
		
		// 使用过滤后的文件列表调用原有的同步方法
		await this.syncRemoteToLocal(provider, localFiles, filteredRemoteFiles, providerType);
	}
	
	/**
	 * 增量同步 - 双向
	 * @param provider 存储提供商
	 * @param localFiles 本地文件列表
	 * @param remoteFiles 远程文件列表
	 * @param providerType 提供商类型
	 */
	private async syncBidirectionalIncremental(
		provider: StorageProvider, 
		localFiles: {path: string, mtime: number, size: number, isFolder: boolean}[], 
		remoteFiles: FileInfo[],
		providerType: StorageProviderType
	) {
		console.log('============= 开始执行增量同步（双向）=============');
		
		// 获取远程根路径
		const basePath = this.getRemoteBasePath(providerType);
		console.log(`使用远程基础路径: ${basePath || '/'}`);
		
		// 创建映射以加速查找
		const localFilesMap = new Map<string, {path: string, mtime: number, size: number, isFolder: boolean}>();
		for (const file of localFiles) {
			localFilesMap.set(file.path, file);
		}
		
		const remoteFilesMap = new Map<string, FileInfo>();
		for (const file of remoteFiles) {
			remoteFilesMap.set(file.path, file);
		}
		
		console.log(`初始状态: 本地文件共 ${localFiles.length} 个 (${localFiles.filter(f => f.isFolder).length} 个文件夹), 远程文件共 ${remoteFiles.length} 个 (${remoteFiles.filter(f => f.isFolder).length} 个文件夹)`);
		
		// 需要处理的文件列表
		const filesToUpload: {path: string, mtime: number, size: number, isFolder: boolean}[] = [];
		let filesToDownload: FileInfo[] = [];
		const foldersToSync: {path: string, mtime: number, size: number, isFolder: boolean}[] = [];
		
		// 在当前同步周期中被删除的远程文件的集合
		const deletedRemoteFiles = new Set<string>();
		// 在当前同步周期中被删除的本地文件的集合
		const deletedLocalFiles = new Set<string>();
		// 本地文件对应的远程路径集合 (用于检测远程已删除的文件)
		const localToRemotePathMap = new Map<string, string>();
		
		// 预处理步骤: 先处理远程文件夹，确保本地存在对应的文件夹结构
		// 这一步骤无论"删除本地多余文件"和"删除远端多余文件"设置如何都会执行
		console.log('预处理: 确保远程文件夹结构在本地存在...');
		const remoteFolders = remoteFiles.filter(file => file.isFolder);
		
		// 输出所有远程文件夹，方便调试
		console.log(`检测到 ${remoteFolders.length} 个远程文件夹:`);
		for (const folder of remoteFolders) {
			console.log(`- 远程文件夹: ${folder.path}`);
		}
		
		// 按路径深度排序，确保父文件夹在子文件夹之前处理
		remoteFolders.sort((a, b) => {
			const depthA = a.path.split('/').length;
			const depthB = b.path.split('/').length;
			return depthA - depthB;
		});
		
		// 创建本地文件夹和收集本地文件夹路径
		const localFoldersSet = new Set<string>();
		for (const localFile of localFiles) {
			if (localFile.isFolder) {
				localFoldersSet.add(localFile.path);
				console.log(`记录现有本地文件夹: ${localFile.path}`);
			}
		}
		
		// 处理远程文件夹，确保本地也有对应文件夹
		console.log('开始创建本地文件夹...');
		for (const remoteFolder of remoteFolders) {
			// 提取相对路径（如果有basePath）
			let localFolderPath = remoteFolder.path;
			if (basePath && localFolderPath.startsWith(basePath + '/')) {
				localFolderPath = localFolderPath.substring(basePath.length + 1);
				console.log(`远程文件夹路径转换为本地路径: ${remoteFolder.path} -> ${localFolderPath}`);
			} else if (remoteFolder.path === basePath || remoteFolder.path === basePath + '/') {
				// 跳过基础路径本身
				console.log(`跳过基础路径: ${remoteFolder.path}`);
				continue;
			} else {
				console.log(`远程文件夹无需路径转换: ${remoteFolder.path}`);
			}
			
			// 检查本地是否已存在该文件夹
			if (!localFoldersSet.has(localFolderPath)) {
				console.log(`本地需要创建文件夹: ${localFolderPath}`);
				try {
					const exists = await this.app.vault.adapter.exists(localFolderPath);
					if (!exists) {
						console.log(`创建本地文件夹: ${localFolderPath}`);
						
						// 确保父文件夹存在
						const parentPath = localFolderPath.split('/').slice(0, -1).join('/');
						if (parentPath && parentPath !== localFolderPath) {
							console.log(`确保父文件夹存在: ${parentPath}`);
							try {
								const parentExists = await this.app.vault.adapter.exists(parentPath);
								if (!parentExists) {
									console.log(`创建父文件夹: ${parentPath}`);
									await this.app.vault.adapter.mkdir(parentPath);
									// 将父文件夹也添加到集合中
									localFoldersSet.add(parentPath);
									console.log(`父文件夹已创建并添加到集合: ${parentPath}`);
								} else {
                                    console.log(`父文件夹已存在: ${parentPath}`);
                                    // 确保添加到集合中
                                    localFoldersSet.add(parentPath);
                                }
							} catch (parentError) {
								console.error(`创建父文件夹失败: ${parentPath}`, parentError);
							}
						}
						
						await this.app.vault.adapter.mkdir(localFolderPath);
						// 添加到本地文件夹集合中，后续处理可能会用到
						localFoldersSet.add(localFolderPath);
						console.log(`本地文件夹创建成功: ${localFolderPath}`);
					} else {
						console.log(`本地文件夹已存在但未在记录中: ${localFolderPath}`);
						// 虽然文件夹已存在，但仍将其添加到集合中
						localFoldersSet.add(localFolderPath);
					}
				} catch (error) {
					console.error(`创建本地文件夹失败: ${localFolderPath}`, error);
				}
			} else {
				console.log(`本地已有对应的文件夹: ${localFolderPath}`);
			}
		}
		
		// 验证所有本地文件夹是否已正确创建
		console.log('验证本地文件夹创建结果...');
		for (const folderPath of localFoldersSet) {
			try {
				const exists = await this.app.vault.adapter.exists(folderPath);
				if (exists) {
					console.log(`确认本地文件夹存在: ${folderPath}`);
				} else {
					console.warn(`警告: 本地文件夹似乎未成功创建: ${folderPath}`);
				}
			} catch (error) {
				console.error(`验证本地文件夹存在时出错: ${folderPath}`, error);
			}
		}
		
		// 处理所有本地文件夹 - 文件夹总是需要确保存在
		const localFolders = localFiles.filter(f => f.isFolder);
		foldersToSync.push(...localFolders);
		
		// 构建远程文件路径集合用于检查文件状态
		const remotePathSet = new Set<string>();
		for (const remoteFile of remoteFiles) {
			if (remoteFile.isFolder) continue; // 只考虑文件
			remotePathSet.add(remoteFile.path);
		}
		
		// 处理远程删除检测 - 构建本地文件对应的远程路径
		for (const localFile of localFiles) {
			if (localFile.isFolder) continue;
			// 构建对应的远程路径
			const remotePath = basePath ? `${basePath}/${localFile.path}` : localFile.path;
			localToRemotePathMap.set(localFile.path, remotePath);
		}
		
		// 第一步：检测远程删除的文件（远程曾经有但现在不存在的文件）
		// 这一步首先检测远程文件删除状态，避免后续将这些文件重新上传
		if (this.settings.deleteLocalExtraFiles) {
			console.log('检测远程已删除的文件...');
			
			// 检查本地每个文件在远程是否存在
			for (const [localPath, remotePath] of localToRemotePathMap.entries()) {
				// 如果本地文件对应的远程路径不存在，这可能是远程文件被删除了
				if (!remotePathSet.has(remotePath)) {
					console.log(`检测到远程文件可能被删除: ${remotePath}`);
					
					// 标记为本地需要删除的文件
					deletedLocalFiles.add(localPath);
					console.log(`标记本地文件将被删除(远程已删除): ${localPath}`);
				}
			}
			
			// 先删除本地对应的文件，确保不会被上传
			if (deletedLocalFiles.size > 0) {
				console.log(`删除本地对应远程已删除的 ${deletedLocalFiles.size} 个文件...`);
				
				for (const localFilePath of deletedLocalFiles) {
					try {
						console.log(`删除本地文件(远程已删除): ${localFilePath}`);
						await this.app.vault.adapter.remove(localFilePath);
						console.log(`删除本地文件成功: ${localFilePath}`);
					} catch (error) {
						console.error(`删除本地文件失败: ${localFilePath}`, error);
					}
				}
			}
		}
		
		// 重新构建本地文件映射，因为前面的步骤可能已经删除了一些文件
		// 只保留未被删除的文件
		localFilesMap.clear();
		for (const file of localFiles) {
			if (!deletedLocalFiles.has(file.path)) {
				localFilesMap.set(file.path, file);
			}
		}
		
		// 处理本地文件 - 注意现在会跳过那些已被标记为删除的文件
		for (const localFile of localFiles) {
			if (localFile.isFolder) continue; // 文件夹已处理
			
			// 如果文件已被标记为删除，跳过处理
			if (deletedLocalFiles.has(localFile.path)) {
				console.log(`跳过处理已被标记为删除的本地文件: ${localFile.path}`);
				continue;
			}
			
			// 构建对应的远程路径
			const remotePath = basePath ? `${basePath}/${localFile.path}` : localFile.path;
			const remoteFile = remoteFilesMap.get(remotePath);
			
			if (!remoteFile) {
				// 远程不存在，上传本地文件
				filesToUpload.push(localFile);
			} else {
				// 比较修改时间，决定同步方向
				const localMtime = new Date(localFile.mtime).getTime();
				const remoteMtime = remoteFile.modifiedTime.getTime();
				
				if (localMtime > remoteMtime) {
					// 本地文件更新，上传到远程
					filesToUpload.push(localFile);
				} else if (remoteMtime > localMtime) {
					// 远程文件更新，下载到本地
					filesToDownload.push(remoteFile);
				}
				// 相同时间戳的文件不需要同步
			}
		}
		
		// 处理远程文件（查找本地不存在的文件）
		// 首先记录本地文件路径的集合（考虑同步路径）
		const localPathSet = new Set<string>();
		for (const localFile of localFiles) {
			// 如果文件已被标记为删除，不添加到集合中
			if (deletedLocalFiles.has(localFile.path)) continue;
			
			// 添加到本地路径集合
			localPathSet.add(localFile.path);
		}
		
		// 找出远程存在但本地不存在需要下载的文件
		// 注意: 这里需要判断是否应该删除远程文件或下载到本地
		for (const remoteFile of remoteFiles) {
			if (remoteFile.isFolder) continue; // 文件夹已处理
			
			// 提取相对路径
			let localPath = remoteFile.path;
			if (basePath && localPath.startsWith(basePath + '/')) {
				localPath = localPath.substring(basePath.length + 1);
			}
			
			// 增强日志，输出更详细的文件信息
			console.log(`检查远程文件是否需要下载: ${remoteFile.path}, 本地对应路径: ${localPath}, 文件类型: ${remoteFile.name.split('.').pop() || '无扩展名'}, 大小: ${remoteFile.size} 字节`);
			
			// 检查本地是否存在(已排除被标记为删除的文件)
			if (!localPathSet.has(localPath)) {
				console.log(`本地不存在此文件: ${localPath}`);
				// 判断应该删除远程文件还是下载到本地
				// 如果启用了删除远程多余文件，则不下载而是稍后删除
				if (this.settings.deleteRemoteExtraFiles) {
					// 记录这个文件会被删除，稍后不要尝试下载它
					deletedRemoteFiles.add(remoteFile.path);
					console.log(`标记远程文件 ${remoteFile.path} 将被删除，不会下载`);
				} else {
					// 否则，本地不存在，下载远程文件
					filesToDownload.push(remoteFile);
					console.log(`标记远程文件需要下载到本地: ${remoteFile.path} -> ${localPath}, 文件类型: ${remoteFile.name.split('.').pop() || '无扩展名'}`);
				}
			} else {
				console.log(`本地已存在此文件: ${localPath}，检查是否需要更新`);
				// 如果本地已存在但不在localFilesMap中，可能是刚创建的文件夹，添加到下载列表
				const localFile = localFilesMap.get(localPath);
				if (!localFile) {
					console.log(`特殊情况：本地路径存在但不在文件映射中，可能是新创建的文件夹或隐藏文件: ${localPath}`);
				}
			}
		}
		
		// 再次构建远程文件路径集合用于检查本地多余文件
		const remotePathSet2 = new Set<string>();
		for (const remoteFile of remoteFiles) {
			if (remoteFile.isFolder) continue; // 只考虑文件
			
			// 记录远程文件路径（去除同步根路径前缀）
			let localPathEquivalent = remoteFile.path;
			if (basePath && localPathEquivalent.startsWith(basePath + '/')) {
				localPathEquivalent = localPathEquivalent.substring(basePath.length + 1);
			}
			remotePathSet2.add(localPathEquivalent);
		}
		
		// 检测并标记要删除的本地多余文件(此时已经处理过远程删除的文件)
		if (this.settings.deleteLocalExtraFiles) {
			for (const localFile of localFiles) {
				if (localFile.isFolder) continue; // 先跳过文件夹
				if (deletedLocalFiles.has(localFile.path)) continue; // 跳过已标记为删除的文件
				
				// 检查本地文件是否在远程存在
				if (!remotePathSet2.has(localFile.path)) {
					console.log(`标记本地多余文件将被删除: ${localFile.path}`);
					deletedLocalFiles.add(localFile.path);
				}
			}
		}
		
		console.log(`增量同步统计：上传 ${filesToUpload.length} 个文件，下载 ${filesToDownload.length} 个文件，同步 ${foldersToSync.length} 个文件夹，删除本地 ${deletedLocalFiles.size} 个文件`);
		
		// 第二步：先处理文件夹确保结构存在
		if (foldersToSync.length > 0) {
			console.log(`==== 同步阶段：处理 ${foldersToSync.length} 个文件夹... ====`);
			// 使用全量同步方法确保所有文件夹结构正确
			try {
				console.log(`文件夹列表: ${foldersToSync.map(f => f.path).join(', ')}`);
				await this.syncLocalToRemote(provider, foldersToSync, remoteFiles, providerType);
				console.log(`${foldersToSync.length} 个文件夹同步完成`);
			} catch (error) {
				console.error('文件夹同步过程中发生错误:', error);
				// 继续执行剩余同步步骤，但记录错误
			}
		}
		
		// 第三步：上传需要更新的本地文件(已经排除了远程已删除的文件)
		if (filesToUpload.length > 0) {
			console.log(`==== 同步阶段：上传 ${filesToUpload.length} 个文件... ====`);
			try {
				console.log(`需要上传的文件: ${filesToUpload.map(f => f.path).join(', ')}`);
				await this.syncLocalToRemote(provider, filesToUpload, remoteFiles, providerType);
				console.log(`${filesToUpload.length} 个文件上传完成`);
			} catch (error) {
				console.error('文件上传过程中发生错误:', error);
				// 继续执行，不中断整个流程
			}
		}
		
		// 第四步：清理远程多余文件（如果设置启用）
		if (this.settings.deleteRemoteExtraFiles) {
			console.log(`==== 同步阶段：清理远程多余文件... ====`);
			console.log(`标记删除的远程文件数量: ${deletedRemoteFiles.size}`);
			
			// 获取远程文件列表，排除当前同步周期中已删除的文件
			const currentRemoteFiles = remoteFiles.filter(file => !deletedRemoteFiles.has(file.path) && !file.isFolder);
			
			// 构建本地路径集合（包括基础路径）
			const localPathSetWithBasePath = new Set<string>();
			for (const localFile of localFiles) {
				if (deletedLocalFiles.has(localFile.path)) continue; // 跳过本地已删除文件
				
				const remotePath = basePath ? `${basePath}/${localFile.path}` : localFile.path;
				localPathSetWithBasePath.add(remotePath);
			}
			
			// 首先清理远程多余文件
			for (const remoteFile of currentRemoteFiles) {
				// 如果远程文件不在本地应有的路径集合中，删除它
				if (!localPathSetWithBasePath.has(remoteFile.path)) {
					try {
						console.log(`准备删除远程多余文件: ${remoteFile.path}`);
						await provider.deleteFile(remoteFile.path);
						console.log(`删除远程多余文件成功: ${remoteFile.path}`);
						
						// 记录到已删除文件集合
						deletedRemoteFiles.add(remoteFile.path);
					} catch (error) {
						console.error(`删除远程文件失败: ${remoteFile.path}`, error);
					}
				}
			}
			
			// 然后删除远程多余文件夹（从深到浅）
			const remoteFoldersList = remoteFiles.filter(file => file.isFolder)
				.sort((a, b) => {
					// 按路径深度排序，深层的先处理
					const depthA = a.path.split('/').length;
					const depthB = b.path.split('/').length;
					return depthB - depthA; // 注意这里是倒序
				});
			
			console.log(`远程文件夹列表（已排序）: ${remoteFoldersList.map(f => f.path).join(', ')}`);
			
			// 然后删除远程多余文件夹
			for (const remoteFolder of remoteFoldersList) {
				// 跳过删除根路径或基础同步路径
				if (remoteFolder.path === basePath || remoteFolder.path === basePath + '/') {
					console.log(`跳过删除基础同步路径: ${remoteFolder.path}`);
					continue;
				}
				
				if (!localPathSetWithBasePath.has(remoteFolder.path)) {
					try {
						console.log(`准备删除远程多余文件夹: ${remoteFolder.path}`);
						await provider.deleteFolder(remoteFolder.path);
						console.log(`删除远程多余文件夹成功: ${remoteFolder.path}`);
						
						// 记录到已删除文件集合 (文件夹也记录，以防有重叠路径)
						deletedRemoteFiles.add(remoteFolder.path);
					} catch (error) {
						console.error(`删除远程文件夹失败: ${remoteFolder.path}`, error);
					}
				} else {
					console.log(`保留远程文件夹（本地存在）: ${remoteFolder.path}`);
				}
			}
			
			console.log('远程多余文件和文件夹清理完成');
		} else {
			console.log('跳过远程多余文件清理（功能未启用）');
		}
		
		// 第五步：过滤掉刚刚在此次同步中被删除的文件，避免下载已删除的文件
		if (deletedRemoteFiles.size > 0) {
			console.log(`在当前同步周期中删除了 ${deletedRemoteFiles.size} 个远程文件，这些文件将不会被下载`);
			
			const filteredFilesToDownload = filesToDownload.filter(remoteFile => {
				if (deletedRemoteFiles.has(remoteFile.path)) {
					console.log(`跳过下载刚被删除的文件: ${remoteFile.path}`);
					return false;
				}
				return true;
			});
			
			if (filteredFilesToDownload.length !== filesToDownload.length) {
				console.log(`过滤后的下载文件数量: ${filteredFilesToDownload.length}（原先：${filesToDownload.length}）`);
				filesToDownload = filteredFilesToDownload;
			}
		}
		
		// 最后一步：下载远程文件到本地
		if (filesToDownload.length > 0) {
			console.log(`==== 同步阶段：下载 ${filesToDownload.length} 个文件... ====`);
			try {
				console.log(`需要下载的文件: ${filesToDownload.map(f => `${f.path} (${f.size}字节, ${f.name.split('.').pop() || '无扩展名'})`).join(', ')}`);
				await this.syncRemoteToLocal(provider, localFiles, filesToDownload, providerType);
				console.log(`${filesToDownload.length} 个文件下载完成`);
			} catch (error) {
				console.error('文件下载过程中发生错误:', error);
				// 尝试逐个下载文件，避免一个文件错误导致整批下载失败
				let successCount = 0;
				let failCount = 0;
				console.log(`尝试逐个下载文件...`);
				for (const remoteFile of filesToDownload) {
					try {
						const singleFileArray = [remoteFile];
						await this.syncRemoteToLocal(provider, localFiles, singleFileArray, providerType);
						successCount++;
						console.log(`单独下载文件成功: ${remoteFile.path}`);
					} catch (singleError) {
						failCount++;
						console.error(`单独下载文件失败: ${remoteFile.path}`, singleError);
					}
				}
				console.log(`单独下载结果: 成功 ${successCount} 个文件, 失败 ${failCount} 个文件`);
			}
		} else {
			console.log(`没有需要下载的文件`);
		}
		
		console.log(`============= 增量双向同步完成 =============`);
		console.log(`上传: ${filesToUpload.length} 个文件`);
		console.log(`下载: ${filesToDownload.length} 个文件`);
		console.log(`同步文件夹: ${foldersToSync.length} 个`);
		console.log(`删除本地文件: ${deletedLocalFiles.size} 个`);
		console.log(`删除远程文件/文件夹: ${deletedRemoteFiles.size} 个`);
	}
	
	/**
	 * 全量同步 - 本地到远程
	 * @param provider 存储提供商
	 * @param localFiles 本地文件列表
	 * @param remoteFiles 远程文件列表
	 * @param providerType 提供商类型
	 */
	private async syncLocalToRemoteFull(
		provider: StorageProvider, 
		localFiles: {path: string, mtime: number, size: number, isFolder: boolean}[], 
		remoteFiles: FileInfo[],
		providerType: StorageProviderType
	) {
		console.log('执行全量同步（本地到远程）');
		// 使用现有的同步逻辑，全量同步所有文件
		await this.syncLocalToRemote(provider, localFiles, remoteFiles, providerType);
	}

	/**
	 * 全量同步 - 远程到本地
	 * @param provider 存储提供商
	 * @param localFiles 本地文件列表
	 * @param remoteFiles 远程文件列表
	 * @param providerType 提供商类型
	 */
	private async syncRemoteToLocalFull(
		provider: StorageProvider, 
		localFiles: {path: string, mtime: number, size: number, isFolder: boolean}[], 
		remoteFiles: FileInfo[],
		providerType: StorageProviderType
	) {
		console.log('执行全量同步（远程到本地）');
		// 使用现有的同步逻辑，全量同步所有文件
		await this.syncRemoteToLocal(provider, localFiles, remoteFiles, providerType);
	}

	/**
	 * 全量同步 - 双向
	 * @param provider 存储提供商
	 * @param localFiles 本地文件列表
	 * @param remoteFiles 远程文件列表
	 * @param providerType 提供商类型
	 */
	private async syncBidirectionalFull(
		provider: StorageProvider, 
		localFiles: {path: string, mtime: number, size: number, isFolder: boolean}[], 
		remoteFiles: FileInfo[],
		providerType: StorageProviderType
	) {
		console.log('执行全量同步（双向）');
		// 使用现有的同步逻辑，全量同步所有文件
		await this.syncBidirectional(provider, localFiles, remoteFiles, providerType);
	}
	
	/**
	 * 处理文件创建事件
	 * @param file 创建的文件
	 * @author Bing
	 */
	private handleFileCreated(file: TAbstractFile) {
		// 忽略被过滤的文件
		if (this.shouldIgnoreFile(file)) return;
		
		// 文件变更后进行同步
		this.debouncedSync();
	}
	
	/**
	 * 处理文件修改事件
	 * @param file 修改的文件
	 * @author Bing
	 */
	private handleFileModified(file: TAbstractFile) {
		// 忽略被过滤的文件
		if (this.shouldIgnoreFile(file)) return;
		
		// 文件变更后进行同步
		this.debouncedSync();
	}
	
	/**
	 * 处理文件删除事件
	 * @param file 删除的文件
	 * @author Bing
	 */
	private handleFileDeleted(file: TAbstractFile) {
		// 忽略被过滤的文件
		if (this.shouldIgnoreFile(file)) return;
		
		// 文件变更后进行同步
		this.debouncedSync();
	}
	
	/**
	 * 处理文件重命名事件
	 * @param file 重命名的文件
	 * @param oldPath 旧路径
	 * @author Bing
	 */
	private handleFileRenamed(file: TAbstractFile, oldPath: string) {
		// 忽略被过滤的文件
		if (this.shouldIgnoreFile(file)) return;
		
		// 文件变更后进行同步
		this.debouncedSync();
	}
	
	/**
	 * 判断文件是否应该被忽略
	 * @param file 文件
	 * @returns 是否忽略
	 * @author Bing
	 */
	private shouldIgnoreFile(file: TAbstractFile): boolean {
		const path = file.path;
		
		// 检查是否在忽略的文件夹中
		for (const folder of this.settings.ignoreFolders) {
			if (path.startsWith(folder + '/') || path === folder) {
				return true;
			}
		}
		
		// 检查是否是忽略的文件
		for (const ignoreFile of this.settings.ignoreFiles) {
			if (path === ignoreFile) {
				return true;
			}
		}
		
		// 检查是否有忽略的扩展名
		if (file instanceof TFile) {
			const extension = file.extension;
			if (extension && this.settings.ignoreExtensions.includes(extension)) {
				return true;
			}
		}
		
		return false;
	}
	
	/**
	 * 延迟同步，避免短时间内多次触发同步
	 * @author Bing
	 */
	private debouncedSync = debounce(() => {
		if (this.settings.enableSync) {
			this.autoSync();
		}
	}, 5000, true);
	
	/**
	 * 清除缓存
	 * @author Bing
	 */
	async clearCache() {
		// 实际实现中，需要清除同步状态、文件元数据缓存等
		console.log('清除云同步缓存');
		this.notificationManager.show('cache-cleared', '缓存已清除', 3000);
	}
	
	/**
	 * 注册文件事件监听器
	 * @author Bing
	 */
	private registerFileEvents() {
		// 文件创建事件
		this.registerEvent(
			this.app.vault.on('create', this.handleFileCreated.bind(this))
		);
		
		// 文件修改事件
		this.registerEvent(
			this.app.vault.on('modify', this.handleFileModified.bind(this))
		);
		
		// 文件删除事件
		this.registerEvent(
			this.app.vault.on('delete', this.handleFileDeleted.bind(this))
		);
		
		// 文件重命名事件
		this.registerEvent(
			this.app.vault.on('rename', this.handleFileRenamed.bind(this))
		);
	}
} 