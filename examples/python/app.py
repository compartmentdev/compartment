from flask import Flask, jsonify, request
from html import escape
import os

port = os.environ.get("PORT", "3000")

print("python booting", flush=True)
print(f"python listening on {port}", flush=True)

app = Flask(__name__)


@app.get("/ready")
def ready():
    return jsonify({"status": "ok"})


@app.get("/__example_probe")
def example_probe():
    return jsonify(
        {
            "cookie": request.headers.get("Cookie"),
            "compartmentHeaders": {
                "accessMode": read_header("X-Compartment-Access-Mode"),
                "organizationId": read_header("X-Compartment-Organization-Id"),
                "organizationSlug": read_header("X-Compartment-Organization-Slug"),
                "principalEmail": read_header("X-Compartment-Principal-Email"),
                "principalId": read_header("X-Compartment-Principal-Id"),
                "principalType": read_header("X-Compartment-Principal-Type"),
                "role": read_header("X-Compartment-Role"),
                "upstreamPort": read_header("X-Compartment-Upstream-Port"),
            },
        }
    )


@app.get("/")
def index():
    log_level = read_variable("LOG_LEVEL")
    feature_flag = read_variable("FEATURE_FLAG")

    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Python</title>
    <style>
      :root {{
        color-scheme: light;
        font-family: "Baskerville", "Georgia", serif;
        background:
          radial-gradient(circle at top left, rgba(255, 224, 170, 0.75), transparent 32%),
          linear-gradient(160deg, #18344d 0%, #24516e 52%, #1d425b 100%);
        color: #f7f3eb;
      }}

      body {{
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }}

      main {{
        padding: 3rem;
        border: 1px solid rgba(247, 243, 235, 0.18);
        background: rgba(15, 28, 39, 0.64);
        box-shadow: 0 28px 84px rgba(6, 14, 22, 0.34);
      }}

      h1 {{
        margin: 0 0 1rem;
        font-size: clamp(2rem, 6vw, 4rem);
      }}

      p {{
        margin: 0 0 1rem;
        font-size: 1.05rem;
      }}

      dl {{
        margin: 1.5rem 0 0;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.5rem 1rem;
      }}

      dt {{
        font-weight: 700;
      }}

      dd {{
        margin: 0;
        opacity: 0.92;
      }}
    </style>
  </head>
  <body>
    <main>
      <h1>Python</h1>
      <p>Railpack Python deployment path is alive.</p>
      <dl>
        <dt>LOG_LEVEL</dt>
        <dd>{escape(log_level)}</dd>
        <dt>FEATURE_FLAG</dt>
        <dd>{escape(feature_flag)}</dd>
      </dl>
    </main>
  </body>
</html>"""


def read_header(name):
    values = request.headers.getlist(name)
    return values[0] if values else None


def read_variable(name):
    return os.environ.get(name) or "(unset)"
