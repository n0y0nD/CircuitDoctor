# CircuitDoctor

Upload a KiCad netlist, explore its connections, check Arduino power-rail wiring,
and ask Gemini questions backed by evidence from FalkorDB.

I2C review checks the exact ER-OLEDM0.91-1 I2C symbol's SDA/SCL pins against
Uno R3 and classic Nano hardware I2C pins through FalkorDB wire routes. It highlights
missing wires, crossed hardware signals and joined SDA/SCL lines. Unknown parts,
conflicting metadata and paths through intermediate parts remain unverified.
External pull-up inspection traces signal → one two-pin `Device:R`/`R_Small` →
known board rail in FalkorDB and shows the supporting wires. A positive imported
resistor value establishes a candidate path, not suitable sizing or voltage.
No external route does **not** mean missing pull-ups: onboard/internal resistors
are not modeled. Software I2C, logic levels and successful communication are not assessed.

## Run with Docker

Install Git and Docker with Docker Compose, and start the Docker engine. No local
Python, Node.js or KiCad installation is needed to run the website.

```bash
git clone https://github.com/n0y0nD/CircuitDoctor.git
cd CircuitDoctor
docker compose up -d --build --wait
```

Open **http://localhost:8080**. The first build downloads dependencies and builds
the TypeScript frontend. On Linux, prefix Docker commands with `sudo` if your
installation requires it. For an existing checkout, skip cloning.

Upload your own UTF-8 KiCad S-expression `.net` file (up to 10 MiB). In KiCad's
Schematic Editor, use **File → Export → Netlist** and choose the KiCad format.
Images, Gerbers, `.kicad_sch`, `.kicad_pcb`, XML and SPICE are not supported inputs.

### Enable Gemini chat (optional)

Create an API key in [Google AI Studio](https://aistudio.google.com/apikey), then run:

```bash
docker compose exec app python -m circuitdoctor.configure_gemini
```

Paste the key at the hidden prompt. It is stored in the persistent
`gemini_config` volume with owner-only permissions, outside the image and Git.
The next chat request reads it; no restart is needed. Upload, review and connection
exploration work without a key. Each person running the app supplies their own key.

If you already configured this checkout locally, import its existing key instead:

```bash
docker compose exec -T app python -c 'import os; from circuitdoctor.configure_gemini import KEY_FILE; import sys; fd=os.open(KEY_FILE, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600); os.fchmod(fd, 0o600); f=os.fdopen(fd, "w"); f.write(sys.stdin.read()); f.close()' < .gemini-api-key
```

Alternatively, Compose accepts `GEMINI_API_KEY` and `GEMINI_MODEL` from the shell
or an ignored root `.env` file. The default model is `gemini-3.5-flash-lite`.
The key stays on the backend. Chat sends the conversation and circuit facts to
Google; API availability and quota depend on the project/model. See
[Google's pricing and data-use table](https://ai.google.dev/gemini-api/docs/pricing).

### Stop, restart and troubleshoot

```bash
docker compose ps
docker compose logs --tail=50 app falkordb
docker compose stop
docker compose up -d --wait
```

`docker compose down` also keeps saved circuits and the configured key. Do not
add `--volumes` unless you intend to delete both. After changing application
source, use `docker compose up -d --build --wait` to rebuild it.

If a published port is already occupied, stop the conflicting service or change
the host port in `compose.yaml`. Website: 8080; database: 6379; database viewer: 3000.

## What works

- Each uploaded circuit gets its own FalkorDB graph, reconstructed through Cypher
  as **Component → Pin → Net**. Refreshing its URL reloads the saved circuit.
- An interactive circuit view shows parts, exact exported pins, movable components
  and adjustable wires. Components and Connections tabs also expose the data.
- Review finds unmarked single-pin connections and direct power-to-ground or
  different nominal-voltage rail conflicts for identified **Uno R3 / classic Nano**
  symbols. Findings include the relevant connections and board specification sources.
- Required power/GND checks use exact, source-backed part identities in
  `circuitdoctor/required_parts.json` (currently ER-OLEDM0.91-1 I2C OLED and
  LCD-016N002L). FalkorDB checks each required pin’s wire neighbours and routes
  to known Arduino rails/ground. A required pin with no connected peer gets a
  warning and pin evidence; other supply arrangements remain unverified.
  Corrected uploads are checked independently. Supply-voltage review compares the ER-OLEDM0.91-1 I2C OLED’s documented 3–5V operating range against direct nominal Uno/Nano rails with a common board ground reference. It does not propagate voltage through parts. LCD-016N002L remains unverified because its symbol does not identify the 3V/5V variant. Unknown supplies, conflicting metadata and unknown parts stay unverified; an in-range nominal supply does not prove operation or signal compatibility.
- Direct power tracing shows pins sharing a known board rail. It stops at parts;
  it does not treat a resistor or common ground as a proven power dependency.
- **Trace a connection:** choose any two exported pins in your uploaded circuit.
  FalkorDB computes a bounded `shortestPath` over `ON_NET` and derived resistor
  `THROUGH` edges. The UI lists the steps and highlights only route memberships.
  Resistor passages require exact `Device:R` / `Device:R_Small` identities and two
  exported pins; MCU, display, diode and other internal paths are not inferred.
  Searches stop at 32 graph edges with a five-second query timeout. No route is
  not a fault verdict, and a route does not prove current flow or operation.
  Existing saved graphs are enriched when tracing, without changing the export.
- **Separate groups:** review runs FalkorDB `algo.WCC` on `Component`, `Pin`
  and `Net` nodes using `HAS_PIN` / `ON_NET`. Groups without an identified
  Arduino are shown as information with whole-group highlighting. Without a
  supported board, separate groups are reported without choosing a main group.
  This is structural grouping, not conduction or power-dependency analysis;
  intentional isolated circuits are not declared faulty. Gemini can inspect
  the groups through `check_rules`.
- Gemini calls `circuit_overview`, `explain_net`, `check_rules`, `trace_power`
  and `find_path`.
  Responses expose their graph evidence and queries; supported evidence can be
  highlighted in the circuit. Requests are bounded to five model calls/eight tool
  calls, with quota errors returned without automatic retries.

Other component connections are retained, but unknown parts do not inherit guessed
voltage/current limits. A review without warnings does not prove that hardware
works. Firmware, soldering, component health, general GPIO voltage compatibility,
current consumption and required pull-ups are not verified. This is not a simulator.

All published ports bind to loopback. This package is for local use; it has no
user accounts and is not an authenticated public hosting setup.

## Inspect FalkorDB

Open **http://localhost:3000**. Use host `127.0.0.1`, port `6379`, no credentials
and no TLS in the included Browser. The app container itself uses host `falkordb`.
Choose the `circuitdoctor_<id>` graph shown under the website's **File details**:

```cypher
MATCH (c:Component)-[:HAS_PIN]->(p:Pin)-[:ON_NET]->(n:Net)
RETURN c, p, n
```

The existing `circuitdoctor_falkordb_data` volume is retained. AOF persistence
is enabled with a one-second sync interval.

## Develop locally

Requires Python 3.12 and Node.js 22.12+ (Node 24 works). Start only the database
when using the Python/Vite development servers:

```bash
docker compose up -d --wait falkordb
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m uvicorn circuitdoctor.api:app --host 127.0.0.1 --port 8000 --reload --reload-dir circuitdoctor
```

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. The Vite server proxies API requests to port 8000.
For a local built preview, run `npm run build` in `frontend`, then restart the
Python API and open **http://localhost:8000**.

For local Gemini setup, run `.venv/bin/python -m circuitdoctor.configure_gemini`.
The backend reads `GEMINI_API_KEY`, or `.gemini-api-key` in the repo root.
`GEMINI_API_KEY_FILE` can override the file path for both setup and reading.
For a local API process, `.env` is not automatically loaded.
Database environment overrides: `FALKORDB_HOST`, `FALKORDB_PORT`,
`FALKORDB_USERNAME`, `FALKORDB_PASSWORD`; default is `127.0.0.1:6379`.

### Checks

From the repo root with the virtual environment activated:

```bash
CIRCUITDOCTOR_TEST_DB=1 python -m unittest discover -s tests -v
node --test frontend/tests/*.test.mjs
npm --prefix frontend run build
```

Without `CIRCUITDOCTOR_TEST_DB=1`, database integration tests are skipped.
Integration tests create and delete only their own temporary graphs. Automated
chat tests mock the external model while exercising its tool calls; they do not
spend Gemini quota.

`tests/fixtures/kicad/` contains KiCad-exported Uno/Nano normal and shorted wiring
for automated regression checks only. The application processes uploaded `.net`
files and does not bundle example circuits.

The parser also runs without a database:

```bash
python -m circuitdoctor path/to/circuit.net --json
```

## API

- `GET /api/status`: database readiness.
- `POST /api/circuits?filename=circuit.net`: upload raw UTF-8 `.net` bytes.
- `GET /api/circuits/{id}`: read the saved circuit.
- `POST /api/circuits/{id}/review`: deterministic connectivity and board-rail checks.
- `POST /api/circuits/{id}/explain`: inspect a connection.
- `POST /api/circuits/{id}/power-trace`: trace a direct board rail.
- `POST /api/circuits/{id}/chat`: ask Gemini using `{ "message": "...", "history": [] }`.
- `GET /api/chat/status`: whether chat has a configured key (never returns it).

Explain/trace accept JSON containing `net_code`, `net_name`, or both `ref` and
`pin`. Use exact exported pin IDs, which can differ from board labels such as D13.
Interactive API documentation is at **http://localhost:8080/docs**.
