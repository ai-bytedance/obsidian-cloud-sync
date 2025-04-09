import { Notice } from 'obsidian';

/**
 * 通知管理器类，用于管理通知的显示，确保正确的顺序并防止重复通知
 */
export class NotificationManager {
    // 活动通知映射(id -> Notice对象)
    private activeNotifications: Map<string, Notice> = new Map();
    // 通知队列
    private queue: Array<{id: string, message: string, timeout: number}> = [];
    // 队列处理标志
    private isProcessingQueue: boolean = false;

    /**
     * 显示通知并管理队列
     * @param id 通知的唯一标识
     * @param message 通知消息内容
     * @param timeout 通知显示时间(毫秒)
     */
    public show(id: string, message: string, timeout: number = 4000): void {
        // 如果存在相同ID的通知，先清除它
        if (this.activeNotifications.has(id)) {
            this.activeNotifications.get(id)?.hide();
            this.activeNotifications.delete(id);
        }
        
        // 将新通知加入队列
        this.queue.push({id, message, timeout});
        
        // 如果队列未在处理中，开始处理
        if (!this.isProcessingQueue) {
            this.processQueue();
        }
    }

    /**
     * 处理通知队列
     */
    private async processQueue(): Promise<void> {
        if (this.queue.length === 0) {
            this.isProcessingQueue = false;
            return;
        }

        this.isProcessingQueue = true;
        const item = this.queue.shift()!;
        
        // 创建并显示通知
        const notice = new Notice(item.message, item.timeout);
        this.activeNotifications.set(item.id, notice);
        
        // 等待通知显示完毕
        await new Promise(resolve => setTimeout(resolve, item.timeout));
        
        // 从活动通知中移除
        this.activeNotifications.delete(item.id);
        
        // 继续处理队列中的下一个通知
        this.processQueue();
    }

    /**
     * 清除特定ID的通知
     * @param id 通知ID
     */
    public clear(id: string): void {
        if (this.activeNotifications.has(id)) {
            this.activeNotifications.get(id)?.hide();
            this.activeNotifications.delete(id);
        }
        
        // 从队列中移除未显示的相同ID通知
        this.queue = this.queue.filter(item => item.id !== id);
    }

    /**
     * 清除所有通知
     */
    public clearAll(): void {
        for (const notice of this.activeNotifications.values()) {
            notice.hide();
        }
        this.activeNotifications.clear();
        this.queue = [];
    }
} 
