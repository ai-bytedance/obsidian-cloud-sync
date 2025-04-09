import { RequestDelayLevel } from '../../models/plugin-settings';

/**
 * 请求速率限制器
 * 根据坚果云API限制管理请求速率:
 * - 免费用户: 600次请求/30分钟(10次/30秒)
 * - 付费用户: 1500次请求/30分钟(25次/30秒)
 */
export class RequestRateLimiter {
  // 计数器和时间窗口
  private requestCount: number = 0;
  private resetTime: number = 0;
  
  // 根据账户类型的限制
  private readonly FREE_USER_LIMIT = 600; // 30分钟600次
  private readonly PAID_USER_LIMIT = 1500; // 30分钟1500次
  private readonly WINDOW_SIZE = 30 * 60 * 1000; // 30分钟(毫秒)
  
  // 自定义延迟(毫秒)
  private readonly DELAY_MAP = {
    'minimal': 100,
    'normal': 200,
    'conservative': 500
  };
  
  private limit: number;
  private requestDelay: number;
  
  /**
   * 创建请求限速器
   * @param isPaidUser 是否为付费用户
   * @param delayLevel 延迟级别(minimal/normal/conservative)
   */
  constructor(isPaidUser: boolean = false, delayLevel: string = 'normal') {
    // 根据账户类型设置限制
    this.limit = isPaidUser ? this.PAID_USER_LIMIT : this.FREE_USER_LIMIT;
    
    // 设置请求延迟
    this.requestDelay = this.DELAY_MAP[delayLevel as keyof typeof this.DELAY_MAP] || this.DELAY_MAP.normal;
    
    // 初始化重置时间
    this.resetTime = Date.now() + this.WINDOW_SIZE;
    
    console.log(`请求限速器初始化: 限制=${this.limit}, 延迟=${this.requestDelay}ms, 窗口=${this.WINDOW_SIZE}ms`);
  }
  
  /**
   * 检查是否可以执行请求
   * @returns 如果可以发送请求则返回true，否则返回false
   */
  canMakeRequest(): boolean {
    this.checkAndResetWindow();
    return this.requestCount < this.limit;
  }
  
  /**
   * 获取下一个请求应该等待的时间(毫秒)
   * @returns 等待时间(毫秒)
   */
  getWaitTime(): number {
    this.checkAndResetWindow();
    
    if (this.requestCount < this.limit) {
      return this.requestDelay;
    } else {
      // 如果已达到限制，则返回到重置时间的等待时间
      return Math.max(0, this.resetTime - Date.now());
    }
  }
  
  /**
   * 递增请求计数器
   */
  incrementCounter(): void {
    this.checkAndResetWindow();
    this.requestCount++;
    console.log(`请求计数: ${this.requestCount}/${this.limit}, 重置时间: ${new Date(this.resetTime).toLocaleTimeString()}`);
  }
  
  /**
   * 检查并在必要时重置计数窗口
   */
  private checkAndResetWindow(): void {
    const now = Date.now();
    if (now >= this.resetTime) {
      console.log('重置请求计数窗口');
      this.requestCount = 0;
      this.resetTime = now + this.WINDOW_SIZE;
    }
  }
  
  /**
   * 获取当前请求计数
   */
  getRequestCount(): number {
    this.checkAndResetWindow();
    return this.requestCount;
  }
  
  /**
   * 获取当前限制
   */
  getLimit(): number {
    return this.limit;
  }
  
  /**
   * 获取距离重置的剩余时间(秒)
   */
  getTimeToReset(): number {
    return Math.max(0, Math.floor((this.resetTime - Date.now()) / 1000));
  }
} 