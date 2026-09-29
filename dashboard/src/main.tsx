import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { removeBoot } from './lib/boot';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

// Never leave the pre-JS poster behind (e.g. Arrival's data failed to load).
window.setTimeout(removeBoot, 12_000);
