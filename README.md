# CircuitDoctor
Understand your circuit. Trace the problem. An AI assistant for exploring KiCad circuit connections with FalkorDB.

## Project status

Local project initialization is complete. The parser, FalkorDB configuration,
API, agent, and browser interface are planned and are not implemented yet.

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

The `.venv` folder and local `.env` files are excluded from Git. Project
dependencies and Docker startup instructions will be added with the next
implementation steps.
