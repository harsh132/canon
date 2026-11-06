import { createRoot } from 'react-dom/client';
import { App } from './App';

if (new URLSearchParams(location.search).has('window')) document.body.classList.add('window');
createRoot(document.getElementById('root')!).render(<App />);
