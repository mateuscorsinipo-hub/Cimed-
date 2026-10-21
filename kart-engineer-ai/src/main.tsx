import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Build de pré-visualização hospedada em iframe: rotas em memória (o caminho da URL não é do app).
const Router = import.meta.env.VITE_PREVIEW_EMBED ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
