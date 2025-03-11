// 全局类型定义，用于解决编译错误
declare module 'crypto-js';

import 'obsidian';

declare module 'obsidian' {
  interface Plugin {
    addStatusBarItem(): HTMLElement;
  }
} 