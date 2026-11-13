import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/geist.css';
import App from './App';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // ignore service worker registration errors in unsupported contexts
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
