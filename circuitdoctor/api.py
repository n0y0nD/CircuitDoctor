"""Local HTTP adapter for the existing parser and the TypeScript workspace."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .parser import MAX_FILE_BYTES, NetlistParseError, load_netlist, parse_netlist

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = {"clean": "clean.net", "missing-ground": "missing_ground.net"}
app = FastAPI(title="CircuitDoctor local parser")


@app.get("/api/status")
def status():
    return {"parser": "ready", "graph_storage": "not_connected", "review": "not_implemented"}


@app.get("/api/samples/{name}")
def sample(name: str):
    if name not in SAMPLES:
        raise HTTPException(404, "Sample not found.")
    return load_netlist(ROOT / "samples" / SAMPLES[name])


@app.post("/api/parse")
async def parse_upload(request: Request):
    # Read the actual bytes, not the supplied filename. No uploads are saved.
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


# After `npm run build`, the same local API can serve the complete workspace.
DIST = ROOT / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="workspace")
