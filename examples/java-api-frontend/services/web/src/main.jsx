import React from 'react';
import { createRoot } from 'react-dom/client';

const highlights = ['Vite frontend', 'Java API behind /api/*', 'Mixed Railpack + Dockerfile build'];
const pageStyles = `
  :root {
    color-scheme: light;
    font-family: "Avenir Next", "Trebuchet MS", sans-serif;
    background:
      radial-gradient(circle at top left, rgba(255, 207, 156, 0.45), transparent 34%),
      linear-gradient(150deg, #13233a 0%, #1b3457 52%, #21486c 100%);
    color: #f5efe7;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-height: 100vh;
  }

  .shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem;
  }

  .panel {
    width: min(720px, 100%);
    padding: 2.5rem;
    border: 1px solid rgba(245, 239, 231, 0.16);
    border-radius: 28px;
    background: rgba(10, 18, 31, 0.7);
    box-shadow: 0 28px 90px rgba(5, 8, 14, 0.34);
    backdrop-filter: blur(18px);
  }

  .eyebrow {
    margin: 0 0 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.28em;
    font-size: 0.78rem;
    color: #ffd6a2;
  }

  h1 {
    margin: 0;
    font-size: clamp(2.8rem, 8vw, 5rem);
    line-height: 0.94;
  }

  .lede {
    margin: 1rem 0 0;
    max-width: 36rem;
    color: rgba(245, 239, 231, 0.82);
    font-size: 1.08rem;
    line-height: 1.6;
  }

  ul {
    margin: 1.6rem 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.7rem;
  }

  li {
    padding: 0.95rem 1rem;
    border-radius: 16px;
    background: rgba(255, 214, 162, 0.1);
    border: 1px solid rgba(255, 214, 162, 0.16);
  }

  .status {
    margin: 1.8rem 0 0;
    padding: 1rem 1.1rem;
    border-radius: 18px;
    background: rgba(120, 230, 176, 0.12);
    border: 1px solid rgba(120, 230, 176, 0.2);
    color: #dff9ea;
    display: grid;
    gap: 1rem;
  }

  .statusHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .statusCopy {
    margin: 0;
    flex: 1 1 18rem;
  }

  .refreshButton {
    border: 1px solid rgba(255, 214, 162, 0.28);
    border-radius: 999px;
    padding: 0.8rem 1.1rem;
    background: rgba(255, 214, 162, 0.14);
    color: #fff4e4;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 160ms ease,
      border-color 160ms ease,
      background 160ms ease;
  }

  .refreshButton:hover:enabled {
    transform: translateY(-1px);
    border-color: rgba(255, 214, 162, 0.44);
    background: rgba(255, 214, 162, 0.22);
  }

  .refreshButton:disabled {
    cursor: progress;
    opacity: 0.72;
  }
`;

function App() {
  const [apiStatus, setApiStatus] = React.useState('Checking the Java API route...');
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setIsRefreshing(true);

    readApiStatusMessage()
      .then((statusMessage) => {
        if (cancelled) {
          return;
        }

        setApiStatus(statusMessage);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setApiStatus(`Proxy check failed: ${readErrorMessage(error)}`);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setIsRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const refreshButtonLabel = isRefreshing ? 'Refreshing...' : 'Refresh API status';

  return (
    <>
      <style>{pageStyles}</style>
      <main className="shell">
        <section className="panel">
          <p className="eyebrow">Compartment Example</p>
          <h1>Java API + Frontend</h1>
          <p className="lede">
            One repo, two services: a Vite client on the primary route and a Java API behind a browser-facing proxy.
          </p>
          <ul>
            {highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
          <div className="status">
            <div className="statusHeader">
              <p className="statusCopy">{apiStatus}</p>
              <button
                className="refreshButton"
                disabled={isRefreshing}
                onClick={() => {
                  setRefreshKey((currentValue) => currentValue + 1);
                }}
                type="button"
              >
                {refreshButtonLabel}
              </button>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

async function readApiStatusMessage() {
  const payload = await readApiReadyPayload();
  return `Proxy check passed: ${payload.service} is ${payload.status}.`;
}

async function readApiReadyPayload() {
  const response = await fetch('/api/ready');

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.json();
}

function readErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unknown error';
}

createRoot(document.getElementById('root')).render(<App />);
