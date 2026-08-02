import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root not found — check web/index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
