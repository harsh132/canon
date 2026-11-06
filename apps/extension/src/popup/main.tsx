import { createRoot } from 'react-dom/client';
import { App } from './App';

if (new URLSearchParams(location.search).has('window')) document.body.classList.add('window');
if (location.pathname.endsWith('onboard.html')) document.body.classList.add('tab');
createRoot(document.getElementById('root')!).render(<App />);
