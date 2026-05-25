import React from 'react';
import { createRoot } from 'react-dom/client';

const buildGreeting = import.meta.env.VITE_PUBLIC_GREETING;
const highlights = ['Static service kind', 'Vite build output publish root', 'Railpack static serving image'];

function App() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Compartment Static Example</p>
        <h1>Static Vite + React</h1>
        <p className="lede">This example publishes build.outputDirectory instead of booting an authored app server.</p>
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
