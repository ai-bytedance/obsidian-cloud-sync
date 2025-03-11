// 覆盖 https 模块的类型定义，使其从 http 模块导出所有内容
declare module 'https' {
  import * as http from 'http';
  export = http;
}

// 添加 NodeJS 命名空间中的 Timeout 和 Timer 接口定义
declare namespace NodeJS {
  interface Timeout {}
  interface Timer {}
}

// 扩展 http 模块，添加 MyRequestListener 类型别名
declare module 'http' {
  export type MyRequestListener = (req: any, res: any) => void;
} 