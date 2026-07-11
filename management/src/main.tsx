import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installManagementBrowserDebugBridge } from './shared/browserDebugBridge';
import './styles/tokens.css';
import './styles/app.css';

if (import.meta.env.DEV && !window.jatoManagement) {
  installManagementBrowserDebugBridge();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
