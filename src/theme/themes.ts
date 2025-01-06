// 定义主题类型
export interface ThemeOption {
  name: string;
  primary: string;
  secondary: string;
}

// 预定义的主题选项
export const themeOptions: ThemeOption[] = [
  {
    name: '默认蓝',
    primary: '#1976d2',
    secondary: '#f5f5f5',
  },
  {
    name: '暗夜黑',
    primary: '#212121',
    secondary: '#424242',
  },
  {
    name: '森林绿',
    primary: '#2e7d32',
    secondary: '#f1f8e9',
  },
  {
    name: '深紫色',
    primary: '#7b1fa2',
    secondary: '#f3e5f5',
  },
  {
    name: '橙色',
    primary: '#f57c00',
    secondary: '#fff3e0',
  },
  {
    name: '红色',
    primary: '#d32f2f',
    secondary: '#ffebee',
  },
  {
    name: '青色',
    primary: '#0097a7',
    secondary: '#e0f7fa',
  },
  {
    name: '棕色',
    primary: '#795548',
    secondary: '#efebe9',
  },
  {
    name: '粉色',
    primary: '#c2185b',
    secondary: '#fce4ec',
  },
  {
    name: '靛蓝',
    primary: '#303f9f',
    secondary: '#e8eaf6',
  },
]; 