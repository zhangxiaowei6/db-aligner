import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import './style.css';
import App from './App';
import { AppearanceProvider } from './appearance';
import { api } from './api';
import type { Appearance } from './types';

async function bootstrap() {
  const initial = await api<Appearance>('appearance.get').catch(
    () =>
      ({
        themeMode: 'system',
        resolvedTheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      }) as Appearance,
  );
  createRoot(document.getElementById('app')!).render(
    <AppearanceProvider initial={initial}>
      <App />
    </AppearanceProvider>,
  );
}
void bootstrap();
