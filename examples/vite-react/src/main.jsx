import React from 'react';
import { createRoot } from 'react-dom/client';

const buildGreeting = import.meta.env.VITE_PUBLIC_GREETING;
const highlights = ['Vite build pipeline', 'React client rendering', 'Railpack build.command example'];

function App() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Compartment Example</p>
        <h1>Vite + React</h1>
        <p className="lede">This example proves a repo-owned build step before runtime boot.</p>
        <p className="lede">{buildGreeting}</p>
        <ul>
          {highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
