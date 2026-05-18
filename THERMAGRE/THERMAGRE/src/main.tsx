import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {UrlTrackingProvider} from './context/UrlTrackingContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UrlTrackingProvider>
      <App />
    </UrlTrackingProvider>
  </StrictMode>,
);
