import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { iniciar } from './lib/store';
import './styles/base.css';
import './styles/cognose.css';
import './styles/app.css';

const root = createRoot(document.getElementById('root')!);
iniciar().finally(() => root.render(<StrictMode><App /></StrictMode>));
