# CircuitDoctor
Understand your circuit. Trace the problem. An AI assistant for exploring KiCad circuit connections with FalkorDB.

## Project status

The local Python environment, FalkorDB Docker setup, and two verified KiCad
sample netlists are ready. The parser, API, agent, and CircuitDoctor interface
are planned and are not implemented yet.

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
```

If the repository and `.venv` already exist, only run `cd CircuitDoctor` and
`source .venv/bin/activate` from the parent directory.

The `.venv` folder and local `.env` files are excluded from Git. Python project
dependencies will be added with the next implementation steps.

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

These files are not loaded into FalkorDB yet. Parsing and graph loading are the
next steps.
