import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { App, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { api, onEvent } from './api';
import type { Appearance, ThemeMode } from './types';

const AppearanceContext = createContext<{
  appearance: Appearance;
  changeTheme: (mode: ThemeMode) => Promise<void>;
} | null>(null);
export function AppearanceProvider({
  initial,
  children,
}: {
  initial: Appearance;
  children: ReactNode;
}) {
  const [appearance, setAppearance] = useState(initial);
  const latest = useRef(initial);
  const sequence = useRef(0);
  async function changeTheme(themeMode: ThemeMode) {
    const id = ++sequence.current;
    const result = await api<Appearance>('appearance.set', { themeMode });
    if (id === sequence.current) {
      latest.current = result;
      setAppearance(result);
    }
  }
  useEffect(
    () =>
      onEvent((event) => {
        if (event.event === 'appearance-changed') {
          const next = event.appearance as Appearance;
          latest.current = next;
          setAppearance(next);
        }
      }),
    [],
  );
  return (
    <AppearanceContext.Provider value={{ appearance, changeTheme }}>
      <ConfigProvider
        locale={zhCN}
        componentSize="middle"
        theme={{
          algorithm:
            appearance.resolvedTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: { fontFamily: "'Segoe UI', 'Microsoft YaHei UI', sans-serif", fontSize: 14 },
        }}
      >
        <App>
          <ThemeSurface>{children}</ThemeSurface>
        </App>
      </ConfigProvider>
    </AppearanceContext.Provider>
  );
}
function ThemeSurface({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  const { appearance } = useAppearance();
  useEffect(() => {
    document.documentElement.style.colorScheme = appearance.resolvedTheme;
    document.documentElement.style.backgroundColor = token.colorBgLayout;
    for (const [key, value] of Object.entries(vars))
      document.documentElement.style.setProperty(key, String(value));
  }, [appearance.resolvedTheme, token]);
  const vars = {
    '--surface': token.colorBgContainer,
    '--layout-bg': token.colorBgLayout,
    '--raised-bg': token.colorBgElevated,
    '--text': token.colorText,
    '--muted': token.colorTextSecondary,
    '--line': token.colorBorderSecondary,
    '--primary': token.colorPrimary,
    '--selected-bg': token.controlItemBgActive,
    '--hover-bg': token.controlItemBgHover,
    '--danger': token.colorError,
    '--success': token.colorSuccess,
    '--warning': token.colorWarning,
    '--shadow': token.boxShadowSecondary,
  } as CSSProperties;
  return (
    <div className="theme-surface" style={vars} data-theme={appearance.resolvedTheme}>
      {children}
    </div>
  );
}
export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('AppearanceProvider missing');
  return value;
}
