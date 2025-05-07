import { Notice } from 'obsidian';
import { ModuleLogger } from '@services/log/log-service';
import CloudSyncPlugin from '@main';

/**
 * 通知管理器类，用于管理通知的显示，确保正确的顺序并防止重复通知
 * @author Bing
 */
export class NotificationManager {
    // 活动通知映射(id -> Notice对象)
    private activeNotifications: Map<string, Notice> = new Map();
    // 通知队列
    private queue: Array<{id: string, message: string, timeout: number}> = [];
    // 队列处理标志
    private isProcessingQueue: boolean = false;
    // 日志记录器
    private logger: ModuleLogger | null = null;

    /**
     * 构造函数
     * @param plugin 插件实例
     */
    constructor(plugin?: CloudSyncPlugin) {
        if (plugin && plugin.logService) {
            this.logger = plugin.logService.getModuleLogger('NotificationManager');
            this.logger.info('通知管理器初始化');
        }
    }

    /**
     * 显示通知并管理队列
     * @param id 通知的唯一标识
     * @param message 通知消息内容
     * @param timeout 通知显示时间(毫秒)
     * @author Bing
     */
    public show(id: string, message: string, timeout: number = 4000): void {
        this.logger?.info(`显示通知: ${id}, 内容: ${message}, 超时: ${timeout}ms`);
        
        // 如果存在相同ID的通知，先清除它
        if (this.activeNotifications.has(id)) {
            this.logger?.info(`替换已存在的通知: ${id}`);
            this.activeNotifications.get(id)?.hide();
            this.activeNotifications.delete(id);
        }
        
        // 将新通知加入队列
        this.queue.push({id, message, timeout});
        this.logger?.info(`通知已加入队列, 当前队列长度: ${this.queue.length}`);
        
        // 如果队列未在处理中，开始处理
        if (!this.isProcessingQueue) {
            this.logger?.info('开始处理通知队列');
            this.processQueue();
        }
    }

    /**
     * 处理通知队列
     * @author Bing
     */
    private async processQueue(): Promise<void> {
        if (this.queue.length === 0) {
            this.logger?.info('通知队列为空，停止处理');
            this.isProcessingQueue = false;
            return;
        }

        this.isProcessingQueue = true;
        const item = this.queue.shift()!;
        this.logger?.info(`显示队列中的通知: ${item.id}`);
        
        // 创建并显示通知
        const notice = new Notice(item.message, item.timeout);
        this.activeNotifications.set(item.id, notice);
        this.logger?.info(`通知已显示: ${item.id}, 等待 ${item.timeout}ms 后自动关闭`);
        
        try {
            // 等待通知显示完毕
            await new Promise(resolve => setTimeout(resolve, item.timeout));
            
            // 从活动通知中移除
            this.activeNotifications.delete(item.id);
            this.logger?.info(`通知已自动关闭: ${item.id}`);
        } catch (error) {
            this.logger?.error(`处理通知时发生错误: ${item.id}`, error);
        }
        
        // 继续处理队列中的下一个通知
        this.logger?.info(`继续处理通知队列，剩余${this.queue.length}个通知`);
        this.processQueue();
    }

    /**
     * 清除特定ID的通知
     * @param id 通知ID
     * @author Bing
     */
    public clear(id: string): void {
        this.logger?.info(`手动清除通知: ${id}`);
        
        if (this.activeNotifications.has(id)) {
            this.logger?.info(`清除活动通知: ${id}`);
            this.activeNotifications.get(id)?.hide();
            this.activeNotifications.delete(id);
        }
        
        // 从队列中移除未显示的相同ID通知
        const queueLengthBefore = this.queue.length;
        this.queue = this.queue.filter(item => item.id !== id);
        const removed = queueLengthBefore - this.queue.length;
        
        if (removed > 0) {
            this.logger?.info(`从队列中移除了${removed}个未显示的通知: ${id}`);
        }
    }

    /**
     * 清除所有通知
     * @author Bing
     */
    public clearAll(): void {
        const activeCount = this.activeNotifications.size;
        const queueCount = this.queue.length;
        
        this.logger?.info(`清除所有通知: ${activeCount}个活动通知, ${queueCount}个队列中的通知`);
        
        for (const notice of this.activeNotifications.values()) {
            notice.hide();
        }
        this.activeNotifications.clear();
        this.queue = [];
        
        this.logger?.info('所有通知已清除');
    }
} 
