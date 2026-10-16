"""Local netlist upload, FalkorDB storage and workspace API."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .parser import MAX_FILE_BYTES, NetlistParseError, load_netlist, parse_netlist
from .storage import CircuitNotFound, StorageUnavailable, get_store

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = {"clean": "clean.net", "missing-ground": "missing_ground.net"}
app = FastAPI(title="CircuitDoctor workspace")


@app.exception_handler(StorageUnavailable)
async def storage_error(request: Request, exc: StorageUnavailable):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(CircuitNotFound)
async def missing_circuit(request: Request, exc: CircuitNotFound):
    return JSONResponse(status_code=404, content={"detail": "Stored circuit not found. Upload the netlist again."})


@app.get("/api/status")
def status():
    try:
        connected = get_store().available()
    except StorageUnavailable:
        connected = False
    return {"parser": "ready", "graph_storage": "connected" if connected else "unavailable",
            "review": "not_implemented"}


@app.get("/api/samples/{name}")
def sample(name: str):
    if name not in SAMPLES:
        raise HTTPException(404, "Sample not found.")
    return load_netlist(ROOT / "samples" / SAMPLES[name])


@app.post("/api/parse")
async def parse_upload(request: Request):
    # Parser-only endpoint for inspecting a file without storing it.
    return await read_upload(request)


async def read_upload(request: Request):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_FILE_BYTES:
            raise HTTPException(413, "The netlist exceeds the 10 MiB limit.")
        body.extend(chunk)
    try:
        text = body.decode("utf-8-sig")
        return await run_in_threadpool(parse_netlist, text)
    except UnicodeDecodeError as exc:
        raise HTTPException(400, "The netlist must be UTF-8 encoded.") from exc
    except NetlistParseError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/circuits", status_code=201)
async def upload_circuit(request: Request):
    circuit = await read_upload(request)
    filename = request.query_params.get("filename", "circuit.net")[:255] or "circuit.net"
    return await run_in_threadpool(get_store().save, circuit, filename=filename)


@app.post("/api/circuits/samples/{name}", status_code=201)
def store_sample(name: str):
    if name not in SAMPLES:
        raise HTTPException(404, "Sample not found.")
    return get_store().save(load_netlist(ROOT / "samples" / SAMPLES[name]),
                            filename=SAMPLES[name], sample=name)


@app.get("/api/circuits/{circuit_id}")
def stored_circuit(circuit_id: str):
    return get_store().read(circuit_id)


# After `npm run build`, the same local API can serve the complete workspace.
DIST = ROOT / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="workspace")
