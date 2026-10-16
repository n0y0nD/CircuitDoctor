"""Local netlist upload, FalkorDB storage and workspace API."""

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
from .power import trace_power
from .chat import ask_circuit, chat_status, ChatError, CHAT_LOCK

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
            "review": "connectivity_and_board_rails"}


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


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
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
        return ask_circuit(get_store(), circuit_id, body.message.strip(), [m.model_dump() for m in body.history])
    except ChatError as exc:
        raise HTTPException(exc.status, str(exc)) from None
    finally:
        CHAT_LOCK.release()


# After `npm run build`, the same local API can serve the complete workspace.
DIST = ROOT / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="workspace")
