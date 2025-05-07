import { RequestRateLimiter } from './request-rate-limiter';
import { ModuleLogger } from '@services/log/log-service';
import CloudSyncPlugin from '@main';

/**
 * 请求优先级定义
 */
export enum RequestPriority {
  HIGH = 0,     // 高优先级（用户发起的操作）
  NORMAL = 1,   // 普通优先级（常规同步操作）
  LOW = 2       // 低优先级（后台任务）
}

/**
 * 请求任务类型
 */
export interface RequestTask<T> {
  id: string;
  priority: RequestPriority;
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  retries?: number;
  maxRetries?: number;
}

/**
 * WebDAV请求队列
 * 管理请求执行顺序、优先级和并发数量
 */
export class RequestQueue {
  private queue: RequestTask<any>[] = [];
  private activeRequests: number = 0;
  private rateLimiter: RequestRateLimiter;
  private maxConcurrent: number;
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private taskIdCounter: number = 0;
  private logger: ModuleLogger | null = null;
  
  /**
   * 创建请求队列
   * @param rateLimiter 请求速率限制器
   * @param maxConcurrent 最大并发请求数
   * @param plugin 插件实例，用于获取日志服务
   */
  constructor(rateLimiter: RequestRateLimiter, maxConcurrent: number = 2, plugin?: CloudSyncPlugin) {
    this.rateLimiter = rateLimiter;
    this.maxConcurrent = maxConcurrent;
    
    if (plugin && plugin.logService) {
      this.logger = plugin.logService.getModuleLogger('RequestQueue');
    }
    
    this.logger?.info(`请求队列初始化: 最大并发数=${maxConcurrent}`);
  }
  
  /**
   * 添加请求到队列
   * @param task 执行函数
   * @param priority 请求优先级
   * @param maxRetries 最大重试次数
   * @returns Promise 返回请求结果
   */
  enqueue<T>(
    task: () => Promise<T>, 
    priority: RequestPriority = RequestPriority.NORMAL,
    maxRetries: number = 3
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = `task-${++this.taskIdCounter}`;
      
      const requestTask: RequestTask<T> = {
        id,
        priority,
        execute: task,
        resolve,
        reject,
        retries: 0,
        maxRetries
      };
      
      // 根据优先级插入队列
      this.insertByPriority(requestTask);
      
      this.logger?.info(`添加任务: ${id}, 优先级: ${RequestPriority[priority]}, 队列长度: ${this.queue.length}`);
      
      // 如果队列处理未运行，启动它
      if (!this.isProcessing && !this.isPaused) {
        this.processQueue();
      }
    });
  }
  
  /**
   * 根据优先级插入队列
   * @param task 要插入的任务
   */
  private insertByPriority<T>(task: RequestTask<T>): void {
    // 队列为空或优先级低于最后一个任务，直接添加到末尾
    if (this.queue.length === 0 || task.priority >= this.queue[this.queue.length - 1].priority) {
      this.queue.push(task);
      return;
    }
    
    // 按优先级插入队列
    for (let i = 0; i < this.queue.length; i++) {
      if (task.priority < this.queue[i].priority) {
        this.queue.splice(i, 0, task);
        return;
      }
    }
    
    // 以防万一，添加到队尾
    this.queue.push(task);
  }
  
  /**
   * 开始处理队列
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.isPaused) {
      return;
    }
    
    this.isProcessing = true;
    
    while (this.queue.length > 0 && !this.isPaused) {
      // 检查并发请求数是否已达到上限
      if (this.activeRequests >= this.maxConcurrent) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      
      // 检查速率限制
      if (!this.rateLimiter.canMakeRequest()) {
        const waitTime = this.rateLimiter.getWaitTime();
        this.logger?.debug(`等待速率限制: ${waitTime}ms, 当前计数: ${this.rateLimiter.getRequestCount()}/${this.rateLimiter.getLimit()}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // 获取下一个任务
      const task = this.queue.shift();
      if (!task) continue;
      
      // 增加活跃请求计数
      this.activeRequests++;
      
      // 记录请求计数
      this.rateLimiter.incrementCounter();
      
      this.logger?.debug(`执行任务: ${task.id}, 活跃请求: ${this.activeRequests}, 队列长度: ${this.queue.length}`);
      
      // 执行任务
      this.executeTask(task).finally(() => {
        this.activeRequests--;
      });
    }
    
    this.isProcessing = false;
  }
  
  /**
   * 执行单个任务
   * @param task 要执行的任务
   */
  private async executeTask<T>(task: RequestTask<T>): Promise<void> {
    try {
      // 添加随机延迟，防止请求过于集中
      const requestDelay = this.rateLimiter.getWaitTime();
      if (requestDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, requestDelay));
      }
      
      // 执行请求
      const result = await task.execute();
      task.resolve(result);
    } catch (error) {
      this.logger?.error(`任务出错: ${task.id}`, error);
      
      // 检查是否需要重试
      if (task.retries !== undefined && task.maxRetries !== undefined && task.retries < task.maxRetries) {
        task.retries++;
        
        // 计算重试延迟(指数退避)
        const retryDelay = Math.min(1000 * Math.pow(2, task.retries), 30000);
        
        this.logger?.info(`重试任务: ${task.id}, 尝试: ${task.retries}/${task.maxRetries}, 延迟: ${retryDelay}ms`);
        
        // 重新添加到队列
        setTimeout(() => {
          this.insertByPriority(task);
          
          if (!this.isProcessing && !this.isPaused) {
            this.processQueue();
          }
        }, retryDelay);
      } else {
        // 已达到最大重试次数或不需要重试
        task.reject(error);
      }
    }
  }
  
  /**
   * 暂停队列处理
   */
  pause(): void {
    if (!this.isPaused) {
      this.logger?.info('暂停处理');
      this.isPaused = true;
    }
  }
  
  /**
   * 恢复队列处理
   */
  resume(): void {
    if (this.isPaused) {
      this.logger?.info('恢复处理');
      this.isPaused = false;
      
      if (!this.isProcessing && this.queue.length > 0) {
        this.processQueue();
      }
    }
  }
  
  /**
   * 清空队列
   */
  clear(): void {
    const queueLength = this.queue.length;
    
    if (queueLength > 0) {
      this.logger?.info(`清空队列, 丢弃 ${queueLength} 个任务`);
      
      // 拒绝所有排队的任务
      for (const task of this.queue) {
        task.reject(new Error('任务被取消'));
      }
      
      this.queue = [];
    }
  }
  
  /**
   * 获取队列状态
   * @returns 队列状态对象
   */
  getStatus(): {
    queueLength: number; 
    activeRequests: number; 
    isPaused: boolean;
    requestCount: number;
    requestLimit: number;
    timeToReset: number;
  } {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      isPaused: this.isPaused,
      requestCount: this.rateLimiter.getRequestCount(),
      requestLimit: this.rateLimiter.getLimit(),
      timeToReset: this.rateLimiter.getTimeToReset()
    };
  }
} 