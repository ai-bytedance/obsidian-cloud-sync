declare module 'monkey-around' {
  /**
   * 包装对象的方法，返回一个卸载函数
   * @param object 要修改的对象
   * @param methodWrappers 方法包装器对象
   * @returns 卸载函数，调用时会移除所有包装器
   */
  export function around<T extends object>(
    object: T,
    methodWrappers: {
      [K in keyof T]?: (originalMethod: T[K]) => any;
    }
  ): () => void;

  /**
   * 去重复包装，确保只有一个包装器被执行
   * @param key 唯一标识符
   * @param oldMethod 原始方法
   * @param newMethod 新方法
   * @returns 包装后的方法
   */
  export function dedupe<T extends (...args: any[]) => any>(
    key: string | symbol,
    oldMethod: T | undefined,
    newMethod: T
  ): T;

  /**
   * 序列化异步方法的执行
   * @param asyncMethod 异步方法
   * @returns 序列化执行的异步方法
   */
  export function serialize<T extends (...args: any[]) => Promise<any>>(
    asyncMethod: T
  ): T & { after(): Promise<void> };
} 