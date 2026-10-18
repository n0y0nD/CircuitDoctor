"""Local netlist upload, FalkorDB storage and workspace API."""

from contextlib import asynccontextmanager
import logging
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .parser import MAX_FILE_BYTES, NetlistParseError, load_netlist, parse_netlist
from .storage import AmbiguousConnection, ConnectionNotFound, CircuitNotFound, StorageUnavailable, get_store
from .tools import explain_net
from .review import check_rules
from .compare import compare_circuits
from .power import trace_power
from .paths import find_path
from .chat import ask_circuit, chat_status, ChatError, CHAT_LOCK

ROOT = Path(__file__).resolve().parents[1]
# One bundled demo netlist for "Try a sample circuit": an Uno R3 whose 5V shares a wire with GND.
SAMPLE_NETLIST = Path(__file__).resolve().parent / "samples" / "uno_short.net"


def migrate_saved_paths():
    return get_store().migrate_path_models()


@asynccontextmanager
async def lifespan(app):
    try:
        await run_in_threadpool(migrate_saved_paths)
    except StorageUnavailable:
        # Upload/review remain available; legacy paths fail explicitly rather
        # than reporting a false "no route". Restart retries interrupted work.
        logging.getLogger(__name__).exception("Saved connection path preparation failed")
    yield


app = FastAPI(title="CircuitDoctor workspace", lifespan=lifespan)


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
            "review": "connectivity_and_board_rails"}


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


@app.post("/api/samples/uno_short", status_code=201)
def store_sample():
    # Same receipt as an upload, so the browser follows the identical flow.
    circuit = load_netlist(SAMPLE_NETLIST)
    return get_store().save(circuit, filename=SAMPLE_NETLIST.name)


@app.get("/api/circuits/{circuit_id}")
def stored_circuit(circuit_id: str):
    return get_store().read(circuit_id)


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    corrected_id: str = Field(pattern=r"^[0-9a-f]{32}$")


@app.post("/api/circuits/{circuit_id}/compare")
def verify_fix(circuit_id: str, body: CompareRequest):
    return compare_circuits(get_store(), circuit_id, body.corrected_id)


class ExplainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    net_code: str | None = Field(default=None, min_length=1)
    net_name: str | None = Field(default=None, min_length=1)
    ref: str | None = Field(default=None, min_length=1)
    pin: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def exactly_one_selector(self):
        pin_selector = self.ref is not None or self.pin is not None
        if sum((self.net_code is not None, self.net_name is not None, pin_selector)) != 1:
            raise ValueError("Supply net_code, net_name, or both ref and pin.")
        if pin_selector and (self.ref is None or self.pin is None):
            raise ValueError("A pin lookup needs both ref and pin.")
        return self


@app.post("/api/circuits/{circuit_id}/explain")
def explain_connection(circuit_id: str, selection: ExplainRequest):
    try:
        return explain_net(get_store(), circuit_id, **selection.model_dump())
    except ConnectionNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except AmbiguousConnection as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/api/circuits/{circuit_id}/review")
def review_circuit(circuit_id: str):
    return check_rules(get_store(), circuit_id)


@app.post("/api/circuits/{circuit_id}/power-trace")
def power_trace(circuit_id: str, selection: ExplainRequest):
    try:
        return trace_power(get_store(), circuit_id, **selection.model_dump())
    except ConnectionNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except AmbiguousConnection as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


class PathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_ref: str = Field(min_length=1, max_length=512)
    from_pin: str = Field(min_length=1, max_length=512)
    to_ref: str = Field(min_length=1, max_length=512)
    to_pin: str = Field(min_length=1, max_length=512)


@app.post("/api/circuits/{circuit_id}/path")
def connection_path(circuit_id: str, selection: PathRequest):
    try:
        return find_path(get_store(), circuit_id, **selection.model_dump())
    except ConnectionNotFound as exc:
        raise HTTPException(404, str(exc)) from exc


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12000)


class ChatComparison(BaseModel):
    model_config = ConfigDict(extra="forbid")
    original_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    corrected_id: str = Field(pattern=r"^[0-9a-f]{32}$")


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    comparison: ChatComparison | None = None
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def valid_conversation(self):
        if not self.message.strip():
            raise ValueError("Enter a question.")
        if len(self.history) % 2 or any(m.role != ("user" if i % 2 == 0 else "assistant") for i, m in enumerate(self.history)):
            raise ValueError("History must contain user/assistant pairs.")
        return self


@app.get("/api/chat/status")
def ai_status():
    try:
        return chat_status()
    except ChatError as exc:
        raise HTTPException(exc.status, str(exc)) from None


@app.post("/api/circuits/{circuit_id}/chat")
def chat(circuit_id: str, body: ChatRequest):
    if not CHAT_LOCK.acquire(blocking=False):
        raise HTTPException(429, "A chat request is already running. Please wait for it to finish.")
    try:
        return ask_circuit(get_store(), circuit_id, body.message.strip(), [m.model_dump() for m in body.history], comparison=body.comparison.model_dump() if body.comparison else None)
    except ChatError as exc:
        raise HTTPException(exc.status, str(exc)) from None
    finally:
        CHAT_LOCK.release()


# After `npm run build`, the same local API can serve the complete workspace.
DIST = ROOT / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="workspace")
