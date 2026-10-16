# CircuitDoctor
Understand your circuit. Trace the problem. An AI assistant for exploring KiCad circuit connections with FalkorDB.

## Project status

The parser, upload API, FalkorDB loader and TypeScript circuit workspace are
connected. Uploaded circuits are stored as Component → Pin → Net graphs and
read back through Cypher for the website. Diagnostic rules and the AI agent
are not implemented yet.

## Open the website

The frontend uses TypeScript, Vite and Cytoscape. It needs Node.js 22.12+ (Node
24 also works) and the Python environment described below.

Start FalkorDB first (`docker compose up -d --wait`; use `sudo` if your Docker
installation requires it). From the repository root, start the API in one terminal:

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn circuitdoctor.api:app --host 127.0.0.1 --port 8000 --reload --reload-dir circuitdoctor
```

In a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Frontend edits appear automatically. Stop each
server with Ctrl+C when finished.

- Upload your KiCad S-expression `.net` to open its circuit workspace.
- Click graph nodes or table rows to inspect the actual exported pins.
- Search components/nets, show unused pins, or view/copy parsed JSON.
- Original file bytes are parsed in memory. Extracted connections and metadata
  are saved in the local FalkorDB volume until explicitly deleted. They are not
  sent to an AI service. Each upload gets its own random circuit ID and graph.
- Expand **File details** to see the graph name and read query.
  **Reload saved circuit**, or refresh the page, to reopen the same stored circuit.
  No file re-upload is required; the circuit ID is kept in the URL fragment.
- A single-pin net is shown as an observation, not an electrical diagnosis.
  Electrical checks and AI explanations are still in development.

For a built preview, run `npm run build` in `frontend`, then start (or restart)
the Python API. It also serves the built website at **http://localhost:8000**.

Checks from the repository root:

```bash
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
npm --prefix frontend run build
```

## Initial scope (planned)

The first version will target circuits built with:

- Arduino Uno R3.
- Classic Arduino Nano (ATmega328P).

Users will upload their own KiCad `.net` circuits. Components, pin connections
and nets will come from the uploaded file; the application must not depend on
the sample's component names, D13 pin choice or LED wiring.

Diagnosis will use the available board and component information. When the
information needed for a check is missing, the result must say that the check
could not be completed, rather than assume the circuit is correct.

The current Uno LED samples are test fixtures. They do not represent the full
range of circuits the application is intended to handle, and do not establish
working Uno or Nano diagnostic support yet.

## Local development setup

Requires Git and Python 3.12 with virtual environment support.

```bash
git clone https://github.com/n0y0nD/CircuitDoctor.git
cd CircuitDoctor
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

If the repository and `.venv` already exist, skip cloning and creating the
environment. Activate it, then install the requirements as shown above.

The `.venv` folder and local `.env` files are excluded from Git.

## Start FalkorDB

Requires Docker with Docker Compose and a running Docker engine (Docker Desktop
works too). Run these commands from the repository folder:

```bash
docker compose up -d --wait
docker compose ps
docker compose exec -T falkordb redis-cli ping
```

The last command should print `PONG`. The first startup downloads the image.

Open **http://localhost:3000** for FalkorDB Browser. This is the database viewer;
the CircuitDoctor website runs separately at port 5173. If asked for a database
connection, use host `127.0.0.1`, port `6379`, and leave credentials empty.

- Database address for local Python code: `127.0.0.1:6379`.
- Both published ports are bound to this laptop's loopback interface. This local
  development setup uses no database password.
- The official `falkordb/falkordb:6.0.2` image includes the database and Browser.
- Data is stored in the `circuitdoctor_falkordb_data` Docker volume. AOF
  persistence is enabled and syncs once per second.

List graphs from the terminal:

```bash
docker compose exec -T falkordb redis-cli GRAPH.LIST
```

Uploaded circuits appear as `circuitdoctor_<id>`. Select the matching graph in
FalkorDB Browser and run:

```cypher
MATCH (c:Component)-[:HAS_PIN]->(p:Pin)-[:ON_NET]->(n:Net)
RETURN c, p, n
```

Uploads are isolated by graph, not authenticated user accounts. This is a
loopback-only development app: anyone with local API access and a circuit ID
can read it. It is not yet a public multi-user service.

Database settings may be supplied as process environment variables:
`FALKORDB_HOST`, `FALKORDB_PORT`, `FALKORDB_USERNAME`, `FALKORDB_PASSWORD`.
Defaults connect to `127.0.0.1:6379` without credentials. `.env` is not auto-loaded.

To stop and later start the service:

```bash
docker compose stop
docker compose up -d --wait
```

`docker compose down` removes the container but keeps the data volume. Adding
`--volumes` would delete the saved database, so omit it to keep your graphs.

For startup troubleshooting, run `docker compose logs --tail=50 falkordb`.

Reference: [FalkorDB Docker documentation](https://docs.falkordb.com/operations/docker).

## Sample circuits (Part 2)

- [Clean Arduino LED blink circuit](samples/clean.net)
- [Same circuit with the LED ground connection missing](samples/missing_ground.net)
- [Sample documentation and editable KiCad sources](samples/README.md)

Both samples use the existing Arduino Uno + 330 ohm resistor + red LED example.
The clean path is D13 -> resistor -> LED -> GND. The faulty sample removes only
the wire from the LED cathode to GND. Both were exported with KiCad and checked
against the original circuit's connectivity.

These files are development test fixtures. The website has no example buttons
and starts with a simple upload screen for the user’s own circuit.

## Read a netlist (Part 3)

From the repository root, with the virtual environment activated:

```bash
python -m circuitdoctor samples/clean.net
python -m circuitdoctor samples/missing_ground.net --json
```

Replace the sample path with your own KiCad S-expression `.net` file. The first
command prints every component and net connection; `--json` prints the full
parsed dictionary. No running database or KiCad installation is required.

Python callers can use `from circuitdoctor import load_netlist` and then
`circuit = load_netlist("path/to/circuit.net")`. The result contains:

- `components`: references, values, library identities, fields and properties.
- `libparts`: exported library pin numbers, names and electrical types.
- `nets`: net codes/names and nodes with `ref`, `pin`, `pinfunction`, `pintype`.
- `version` and `design`: the export's format version and source metadata.

Pin IDs and net codes remain strings, including leading zeros. Missing node
pin metadata becomes `unknown`; library definitions remain separate. Unused
pins and their `+no_connect` markers are retained. Neither a singleton net nor
a successful parse is reported as an electrical diagnosis.

This step reads connectivity without hardcoded Uno/Nano pin maps. Checks cover
the real Uno exports and a small Nano-format fixture with different names and
pins. Board-specific diagnostic support is still planned.

Input must be UTF-8 KiCad S-expression, up to 10 MiB. XML, SPICE, schematic and
PCB files are not supported by this reader. Malformed input, duplicate pin
assignments and references to missing components produce an error; the CLI
exits with status 2 without printing a partial circuit.

Format references: [KiCad netlist documentation](https://docs.kicad.org/9.0/en/eeschema/eeschema.html#netlist_formats)
and the [sexpdata parser](https://github.com/jd-boyd/sexpdata).

## Circuit storage API

- `POST /api/circuits?filename=example.net`: bounded raw UTF-8 `.net` body; returns
  a circuit ID after import completes.
- `GET /api/circuits/{id}`: reconstructs components and connectivity from FalkorDB.
- `POST /api/circuits/samples/{name}`: explicitly import an optional example.
- `GET /api/status`: reports database availability; diagnostics remain unimplemented.
- `/api/parse` and `/api/samples/{name}` remain parser-only inspection endpoints;
  the website uses the stored-circuit endpoints above.

Library pin definitions are preserved, including pins absent from exported nets.
No connectivity is invented for those pins. Incomplete imports are not exposed;
a failed import attempts to clean up only its newly generated graph. Database
errors return 503 instead of silently falling back to parser output.

Run the real database integration checks after starting FalkorDB:

```bash
CIRCUITDOCTOR_TEST_DB=1 python -m unittest discover -s tests -v
```

The checks cover generic Uno/Nano exports, unknown components, multiple pins on
a net, upload isolation, database read-back and failed-import cleanup. They
create and remove only their own temporary graphs. Without the environment
flag, the real-database tests are skipped.
