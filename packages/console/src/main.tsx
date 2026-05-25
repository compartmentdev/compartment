import ReactDOM from 'react-dom/client';
import { AppRouter } from './app-router';
import './styles.css';

const rootElement: HTMLElement | null = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Expected #root element for the browser client.');
}

ReactDOM.createRoot(rootElement).render(<AppRouter />);
