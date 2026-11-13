import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CaptureApp } from './CaptureApp';
import { ToastProvider } from './components/ui';
import './styles.css';

// /capture is the minimal quick-note window (see scripts/quick-capture.sh).
const isCapture = window.location.pathname.replace(/\/+$/, '') === '/capture';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ToastProvider>{isCapture ? <CaptureApp /> : <App />}</ToastProvider>
    </StrictMode>,
  );
}

// Service worker (production only): required for Chrome's "Install app".
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker registration failed', err));
  });
}
