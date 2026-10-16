# CircuitDoctor
Understand your circuit. Trace the problem. An AI assistant for exploring KiCad circuit connections with FalkorDB.

## Project status

The local Python environment, FalkorDB Docker setup, two verified KiCad sample
netlists, and the Python netlist parser are ready. Graph loading, diagnostic
rules, the API, agent, and CircuitDoctor interface are not implemented yet.

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
the CircuitDoctor application will be built separately. If asked for a database
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

The list starts empty; circuit data will be added in the sample/parser/loader
steps.

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

These files are not loaded into FalkorDB yet. Graph loading is the next step.

## Read a netlist (Part 3)

From the repository root, with the virtual environment activated:

```bash
python -m circuitdoctor samples/clean.net
python -m circuitdoctor samples/missing_ground.net --json
python -m unittest discover -s tests -v
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
