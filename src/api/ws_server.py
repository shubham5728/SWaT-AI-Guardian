"""
SWaT AI Guardian — WebSocket streaming backend
==============================================

Thin real-time shim that feeds the React frontend (frontend/). It wraps the
existing `AnomalyDetector` + Kafka/CSV consumer (the same pipeline the old
Streamlit dashboard ran in-process) and pushes the exact `ServerMessage` shapes
defined in frontend/src/types/index.ts over a WebSocket.

Run:
    uvicorn api.ws_server:app --host 0.0.0.0 --port 8000
    # or:  python -m api.ws_server   (from the src/ directory)

Endpoints:
    GET  /api/health    → liveness + engine status
    GET  /api/snapshot  → current state (REST mirror of the WS snapshot)
    WS   /ws/stream     → live ServerMessage stream; accepts ClientCommand frames
"""
import os
import sys
import json
import time
import asyncio
import logging
import threading
from collections import deque
from datetime import datetime
from typing import Any, Deque, Dict, List, Optional

# --- path setup so `import utils`, `inference...` resolve from src/ ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_PATH = os.path.abspath(os.path.join(BASE_DIR, ".."))
if SRC_PATH not in sys.path:
    sys.path.insert(0, SRC_PATH)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from utils import (  # type: ignore
    get_kafka_config,
    get_system_state,
    set_system_status,
    setup_structured_logging,
)

setup_structured_logging()
logger = logging.getLogger("WSServer")

DATA_DIR = os.path.abspath(os.path.join(SRC_PATH, "..", "data"))
HISTORY_LEN = 120
INCIDENT_RESOLVE_SECONDS = 60
INCIDENT_ARCHIVE_SECONDS = 180  # resolved -> archived after this long
NEW_TO_ONGOING_COUNT = 3  # occurrences before a "New" incident becomes "Ongoing"
# Statuses still considered "live" for matching/counting.
ACTIVE_STATUSES = frozenset({"New", "Ongoing", "Acknowledged"})
SENSITIVITY_MULTIPLIER = {"Conservative": 2.0, "Balanced": 1.0, "Aggressive": 0.5}


# ---------------------------------------------------------------------------
# Derivation helpers (ported verbatim from the Streamlit update_dashboard_view)
# ---------------------------------------------------------------------------
def compute_risk(mse: float, threshold: float) -> float:
    if threshold <= 0:
        return 0.0
    return min((mse / threshold) * 50.0, 100.0)


def risk_to_severity(risk: float) -> str:
    if risk > 80:
        return "CRITICAL"
    if risk > 60:
        return "HIGH"
    if risk > 40:
        return "MEDIUM"
    return "NORMAL"


# ---------------------------------------------------------------------------
# CSV fallback consumer (mirrors FileSimulatedConsumer from the Streamlit app)
# ---------------------------------------------------------------------------
class _MockMessage:
    __slots__ = ("value",)

    def __init__(self, value: Dict[str, Any]):
        self.value = value


class FileSimulatedConsumer:
    """Replays a CSV file forever as if it were a Kafka topic."""

    def __init__(self, file_path: str):
        import pandas as pd  # local import keeps module import cheap

        self._pd = pd
        self.file_path = file_path
        self._generator = self._record_generator()
        logger.warning(f"Kafka unavailable — simulating from {file_path}")

    def _record_generator(self):
        while True:
            try:
                for chunk in self._pd.read_csv(self.file_path, chunksize=1000):
                    for record in chunk.to_dict("records"):
                        record.setdefault("Normal/Attack", "Unknown")
                        yield _MockMessage(record)
            except FileNotFoundError:
                time.sleep(5)
            except Exception as exc:  # pragma: no cover - defensive
                logger.error(f"CSV replay error: {exc}")
                time.sleep(1)

    def poll(self, timeout_ms: int = 0, max_records: int = 50) -> Dict[str, List[_MockMessage]]:
        records = [next(self._generator) for _ in range(max_records)]
        return {"partition_0": records}


def build_consumer(mode: str):
    """Try Kafka first, then fall back to CSV replay. Returns (consumer, backend_mode)."""
    # Set DISABLE_KAFKA=1 (e.g. in Docker without a broker) to skip the Kafka probe
    # and go straight to CSV replay — avoids a slow metadata-fetch timeout.
    if os.environ.get("DISABLE_KAFKA", "").lower() in ("1", "true", "yes"):
        logger.info("DISABLE_KAFKA set — using CSV simulation directly.")
    else:
        try:
            from kafka import KafkaConsumer  # type: ignore

            cfg = get_kafka_config()
            consumer = KafkaConsumer(
                cfg.get_topic("sensor_data"),
                bootstrap_servers=cfg.get_bootstrap_servers(),
                value_deserializer=lambda x: json.loads(x.decode("utf-8")),
                auto_offset_reset="latest",
                enable_auto_commit=True,
                consumer_timeout_ms=100,
            )
            consumer.topics()  # force a connection attempt
            logger.info("Connected to Kafka sensor stream.")
            return consumer, "KAFKA"
        except Exception as exc:
            logger.warning(f"Kafka not available ({exc}); using CSV simulation.")

    file_name = "normal.csv" if mode == "Normal" else "attack.csv"
    path = os.path.join(DATA_DIR, file_name)
    if not os.path.exists(path):
        # normal.csv is huge / optional — fall back to the bundled sample.
        alt = os.path.join(DATA_DIR, "normal_sample.csv" if mode == "Normal" else "attack.csv")
        path = alt if os.path.exists(alt) else os.path.join(DATA_DIR, "attack.csv")
    return FileSimulatedConsumer(path), "SIMULATION"


# ---------------------------------------------------------------------------
# Connection manager — broadcasts JSON frames to all connected clients
# ---------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self) -> None:
        self.active: List[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self.active.append(ws)
        logger.info(f"Client connected ({len(self.active)} total).")

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            if ws in self.active:
                self.active.remove(ws)
        logger.info(f"Client disconnected ({len(self.active)} total).")

    async def broadcast(self, message: Dict[str, Any]) -> None:
        dead: List[WebSocket] = []
        for ws in list(self.active):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)


# ---------------------------------------------------------------------------
# Streaming engine — the heart. Runs in a daemon thread, broadcasts to the loop.
# ---------------------------------------------------------------------------
class StreamEngine:
    def __init__(self, manager: ConnectionManager) -> None:
        self.manager = manager
        self.loop: Optional[asyncio.AbstractEventLoop] = None

        # Live state
        self.history: Deque[Dict[str, Any]] = deque(maxlen=HISTORY_LEN)
        self.incidents: List[Dict[str, Any]] = []
        self.event_log: Deque[Dict[str, Any]] = deque(maxlen=50)
        self._last_is_anomaly = False
        # Live confusion matrix: alert decision (severity != NORMAL) vs label.
        self.cm: Dict[str, int] = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
        # Static model metadata (filled in _load_detector).
        self.meta: Optional[Dict[str, Any]] = None

        # System state (seeded from models/system_state.json), but always boot in
        # "Normal" data mode — every dashboard start shows the stable baseline
        # first; the operator switches to "Attack" from the Control Center.
        gs = get_system_state()
        self.system: Dict[str, Any] = {
            "runSystem": gs.get("run_system", True),
            # Always boot at 1 record/second (1x) — matches the SWaT dataset's
            # real 1 Hz sampling cadence.
            "simulationSpeed": 1.0,
            "dataMode": "Normal",
            "sensitivity": "Balanced",
            "backendMode": "OFFLINE",
            "lastUpdated": datetime.now().isoformat(),
        }
        # Persist the forced defaults so the shared state file agrees on startup.
        set_system_status(mode="Normal", speed=1.0)

        # Email notifier (optional — disabled gracefully if deps/creds missing).
        self.notifier = None
        try:
            from notifications import NotificationManager  # type: ignore

            self.notifier = NotificationManager()
        except Exception as exc:
            logger.warning(f"Email notifier unavailable: {exc}")
        self._last_email_ts = 0.0
        self._email_cooldown = 300.0  # 5 min between alert emails (anti-spam)

        self.detector = None
        self.base_threshold = 3.626
        self._consumer = None
        self._consumer_mode = None  # the data mode the consumer was built for
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # --- lifecycle ---
    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self._load_detector()
        self._thread = threading.Thread(target=self._run, name="StreamEngine", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _load_detector(self) -> None:
        try:
            from inference.streaming_inference import AnomalyDetector  # type: ignore

            self.detector = AnomalyDetector(init_kafka=False)
            self.base_threshold = float(getattr(self.detector, "ae_threshold", 3.626))
            pca = getattr(self.detector, "pca", None)
            self.meta = {
                "model": "Autoencoder + Isolation Forest",
                "pcaComponents": int(getattr(pca, "n_components_", getattr(pca, "n_components", 15)) or 15),
                "aeThreshold": self.base_threshold,
            }
            logger.info(f"AnomalyDetector loaded (ae_threshold={self.base_threshold:.4f}).")
        except Exception as exc:
            logger.error(f"AnomalyDetector unavailable ({exc}); using synthetic engine.")
            self.detector = None
            self.meta = {
                "model": "Synthetic (models unavailable)",
                "pcaComponents": 15,
                "aeThreshold": self.base_threshold,
            }

    # --- threshold helper ---
    def _adj_threshold(self) -> float:
        return self.base_threshold * SENSITIVITY_MULTIPLIER[self.system["sensitivity"]]

    # --- broadcasting from the worker thread ---
    def _emit(self, message: Dict[str, Any]) -> None:
        if self.loop is None:
            return
        asyncio.run_coroutine_threadsafe(self.manager.broadcast(message), self.loop)

    def snapshot(self) -> Dict[str, Any]:
        return {
            "state": self.system,
            "ticks": list(self.history),
            "incidents": self.incidents,
            "log": list(self.event_log),
            "metrics": dict(self.cm),
            "meta": self.meta,
        }

    # --- command handling (called from the async websocket handler) ---
    def apply_command(self, cmd: Dict[str, Any]) -> None:
        ctype = cmd.get("type")
        if ctype == "setMode":
            self.system["dataMode"] = cmd["mode"]
            self._consumer = None  # force rebuild for the new stream
        elif ctype == "setSensitivity":
            self.system["sensitivity"] = cmd["sensitivity"]
        elif ctype == "setSpeed":
            self.system["simulationSpeed"] = max(0.1, float(cmd["speed"]))
        elif ctype == "setRun":
            self.system["runSystem"] = bool(cmd["run"])
        elif ctype == "reset":
            self.history.clear()
            self.incidents = []
            self.event_log.clear()
            self._last_is_anomaly = False
            self.cm = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
        elif ctype == "acknowledgeIncident":
            self.acknowledge_incident(cmd["id"])
            self._emit({"type": "incidents", "payload": self.incidents})
            return
        elif ctype == "resolveIncident":
            self.resolve_incident(cmd["id"], cmd.get("reason", "Manually resolved"))
            self._emit({"type": "incidents", "payload": self.incidents})
            return
        else:
            logger.warning(f"Unknown command: {ctype}")
            return

        # Persist run/speed/mode to the shared state file (parity with Streamlit).
        set_system_status(
            run=self.system["runSystem"],
            speed=self.system["simulationSpeed"],
            mode=self.system["dataMode"],
        )
        self.system["lastUpdated"] = datetime.now().isoformat()
        self._emit({"type": "state", "payload": self.system})

    # --- worker loop ---
    def _run(self) -> None:
        while not self._stop.is_set():
            if not self.system["runSystem"]:
                time.sleep(0.2)
                continue

            mode = self.system["dataMode"]
            if self._consumer is None or self._consumer_mode != mode:
                self._consumer, backend = build_consumer(mode)
                self._consumer_mode = mode
                self.system["backendMode"] = backend
                self._emit({"type": "state", "payload": self.system})

            try:
                batch = self._consumer.poll(timeout_ms=100, max_records=20)
            except Exception as exc:
                logger.error(f"poll() failed: {exc}")
                time.sleep(0.5)
                continue

            changed = False
            for records in (batch or {}).values():
                for record in records:
                    raw = record.value
                    if self._consume_record(raw):
                        changed = True
                    # Pace the stream: 1 record per second at 1x (SWaT's real
                    # 1 Hz cadence); the speed slider scales it.
                    time.sleep(max(0.05, 1.0 / self.system["simulationSpeed"]))

            if changed:
                self._emit({"type": "log", "payload": list(self.event_log)})
            # Run lifecycle transitions and push incidents every cycle so
            # auto-resolve/archive propagate even when the stream is quiet.
            self._resolve_stale_incidents()
            self._emit({"type": "incidents", "payload": self.incidents})
            # Push the running evaluation metrics once per poll cycle.
            self._emit({"type": "metrics", "payload": dict(self.cm)})

    def _maybe_email(self, tick: Dict[str, Any], component: str) -> None:
        """Fire a CRITICAL-alert email, throttled to one per cooldown window."""
        if self.notifier is None:
            return
        if not (self.notifier.sender_email and self.notifier.sender_password):
            return
        now = time.time()
        if now - self._last_email_ts < self._email_cooldown:
            return
        self._last_email_ts = now
        alert = {
            "Time": tick.get("time"),
            "Type": f"CRITICAL — {component}",
            "Score": f"{tick['mse']:.6f}",
            "Label": tick.get("label"),
        }
        # SMTP is blocking — send off-thread so the stream loop never stalls.
        threading.Thread(
            target=self.notifier.send_email, args=(alert,), daemon=True
        ).start()
        logger.info(f"CRITICAL email dispatched (component={component}).")

    def _consume_record(self, raw: Dict[str, Any]) -> bool:
        label = str(raw.get("Normal/Attack", "Unknown"))
        mode = self.system["dataMode"]
        # Match the dataset to the selected stream, like the Streamlit loop did.
        if mode == "Normal" and "Attack" in label:
            return False
        if mode == "Attack" and "Normal" in label:
            return False

        threshold = self._adj_threshold()
        tick = self._score(raw, threshold, label)
        self.history.append(tick)
        self._emit({"type": "tick", "payload": tick})

        risk = compute_risk(tick["mse"], threshold)
        severity = risk_to_severity(risk)
        # Group incidents by the *base* sensor — collapse raw + "_SMA" variants
        # so one physical sensor doesn't spawn duplicate incidents.
        top_feature = next(iter(tick["topFeatures"]), "System")
        component = top_feature[:-4] if top_feature.endswith("_SMA") else top_feature

        # Live confusion matrix: prediction = alert raised (severity != NORMAL),
        # ground truth = dataset label.
        predicted_alert = severity != "NORMAL"
        actual_attack = "Attack" in label
        if predicted_alert and actual_attack:
            self.cm["tp"] += 1
        elif predicted_alert and not actual_attack:
            self.cm["fp"] += 1
        elif not predicted_alert and actual_attack:
            self.cm["fn"] += 1
        else:
            self.cm["tn"] += 1

        changed = False
        if severity != "NORMAL":
            self._record_event(tick, severity, component)
            self._upsert_incident(tick, risk, severity, component)
            changed = True
            if severity == "CRITICAL":
                self._maybe_email(tick, component)

        self._last_is_anomaly = tick["isAnomaly"] or tick["isIso"]
        return changed

    def _score(self, raw: Dict[str, Any], threshold: float, label: str) -> Dict[str, Any]:
        ts = time.time()
        time_str = time.strftime("%H:%M:%S", time.localtime(ts))
        sensors = {k: float(v) for k, v in raw.items() if isinstance(v, (int, float))}

        if self.detector is not None:
            t0 = time.perf_counter()
            features = self.detector.preprocess(raw)
            res = self.detector.predict(features, threshold)
            latency_ms = (time.perf_counter() - t0) * 1000.0
            mse = float(res.get("mse", 0.0))
            return {
                "ts": ts,
                "time": time_str,
                "mse": mse,
                "threshold": threshold,
                "isAnomaly": bool(res.get("is_anomaly", False)),
                "isIso": bool(res.get("is_iso", False)),
                "isoScore": float(res.get("iso_score", 0.0)),
                "label": label,
                "topFeatures": {k: float(v) for k, v in res.get("top_features", {}).items()},
                "sensors": sensors,
                "latencyMs": round(latency_ms, 1),
            }

        # Synthetic fallback (detector/models unavailable): keep the UI alive.
        import random

        attack = self.system["dataMode"] == "Attack"
        mse = threshold * (random.uniform(0.1, 0.6) + (random.uniform(0.8, 2.4) if attack and random.random() < 0.3 else 0))
        is_anom = mse > threshold
        top = {}
        if is_anom:
            for i, s in enumerate(list(sensors)[:4] or ["FIT101", "LIT101", "P102"][:4]):
                top[s] = round(2.5 - i * 0.5 + random.random(), 3)
        return {
            "ts": ts,
            "time": time_str,
            "mse": mse,
            "threshold": threshold,
            "isAnomaly": is_anom,
            "isIso": is_anom and random.random() < 0.5,
            "isoScore": -0.25 if is_anom else 0.05,
            "label": label,
            "topFeatures": top,
            "sensors": sensors or {"FIT101": 0.0, "LIT101": 0.0, "P102": 0.0},
            "latencyMs": round(random.uniform(0.3, 1.5), 1),
        }

    # --- incident / event-log bookkeeping (ported from the Streamlit loop) ---
    def _record_event(self, tick: Dict[str, Any], severity: str, component: str) -> None:
        self.event_log.appendleft(
            {
                "ts": tick["ts"],
                "time": tick["time"],
                "type": severity,
                "score": f"{tick['mse']:.6f}",
                "limit": f"{tick['threshold']:.5f}",
                "label": tick["label"],
                "component": component,
            }
        )

    def _upsert_incident(self, tick: Dict[str, Any], risk: float, severity: str, component: str) -> None:
        alarm = "PERSISTENT THREAT" if self._last_is_anomaly else f"{severity} ALERT"
        now = tick["ts"]

        # Match an existing *active* incident (not yet resolved/archived).
        for inc in self.incidents:
            if inc["status"] in ACTIVE_STATUSES and inc["type"] == alarm and inc["component"] == component:
                inc["occurrences"] += 1
                inc["lastSeen"] = now
                inc["riskHistory"].append(risk)
                inc["riskHistory"] = inc["riskHistory"][-20:]
                inc["trend"] = self._trend(inc["riskHistory"])
                inc["severity"] = severity
                # Promote New -> Ongoing once it has clearly persisted.
                if inc["status"] == "New" and inc["occurrences"] >= NEW_TO_ONGOING_COUNT:
                    inc["status"] = "Ongoing"
                return

        self.incidents.insert(
            0,
            {
                "id": f"{now:.3f}-{component}",
                "type": alarm,
                "component": component,
                "severity": severity,
                "status": "New",
                "trend": "Stable",
                "occurrences": 1,
                "startTime": now,
                "lastSeen": now,
                "createdAt": now,
                "acknowledgedAt": None,
                "resolvedAt": None,
                "acknowledgedBy": None,
                "resolutionReason": None,
                "riskHistory": [risk],
            },
        )
        self.incidents = self.incidents[:30]

    def acknowledge_incident(self, incident_id: str, by: str = "operator") -> None:
        for inc in self.incidents:
            if inc["id"] == incident_id and inc["status"] in ACTIVE_STATUSES:
                inc["status"] = "Acknowledged"
                inc["acknowledgedAt"] = time.time()
                inc["acknowledgedBy"] = by
                return

    def resolve_incident(self, incident_id: str, reason: str = "Manually resolved") -> None:
        for inc in self.incidents:
            if inc["id"] == incident_id and inc["status"] in ACTIVE_STATUSES:
                inc["status"] = "Resolved"
                inc["resolvedAt"] = time.time()
                inc["resolutionReason"] = reason
                return

    @staticmethod
    def _trend(history: List[float]) -> str:
        if len(history) < 3:
            return "Stable"
        diffs = [history[i] - history[i - 1] for i in range(1, len(history))]
        avg = sum(diffs) / len(diffs)
        if avg > 0.5:
            return "Increasing"
        if avg < -0.5:
            return "Decreasing"
        return "Stable"

    def _resolve_stale_incidents(self) -> None:
        now = time.time()
        for inc in self.incidents:
            # Active but unseen for a while -> auto-resolve.
            if inc["status"] in ACTIVE_STATUSES and now - inc["lastSeen"] > INCIDENT_RESOLVE_SECONDS:
                inc["status"] = "Resolved"
                inc["resolvedAt"] = now
                inc["resolutionReason"] = "Auto-resolved (no recurrence)"
            # Resolved for a while -> archive (drops out of the active feed).
            elif (
                inc["status"] == "Resolved"
                and inc.get("resolvedAt")
                and now - inc["resolvedAt"] > INCIDENT_ARCHIVE_SECONDS
            ):
                inc["status"] = "Archived"


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="SWaT AI Guardian — Streaming API", version="2.0.0")

# CORS so the Vite dev server (5173) can hit REST directly if not proxied.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = ConnectionManager()
engine = StreamEngine(manager)


@app.on_event("startup")
async def _startup() -> None:
    engine.start(asyncio.get_running_loop())


@app.on_event("shutdown")
async def _shutdown() -> None:
    engine.stop()


@app.get("/api/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "online",
        "detector": "loaded" if engine.detector is not None else "synthetic",
        "backendMode": engine.system["backendMode"],
        "clients": len(manager.active),
        "timestamp": time.time(),
    }


@app.get("/api/snapshot")
async def snapshot() -> Dict[str, Any]:
    return engine.snapshot()


@app.post("/api/test-email")
async def test_email() -> Dict[str, Any]:
    """Send a one-off test alert email (bypasses the cooldown)."""
    if engine.notifier is None:
        return {"ok": False, "error": "Email notifier not available."}
    if not (engine.notifier.sender_email and engine.notifier.sender_password):
        return {"ok": False, "error": "Email credentials missing in .env."}
    alert = {
        "Time": time.strftime("%H:%M:%S"),
        "Type": "TEST ALERT",
        "Score": "0.000000",
        "Label": "Test",
    }
    ok = await asyncio.to_thread(engine.notifier.send_email, alert, True)
    return {"ok": bool(ok), "to": engine.notifier.receiver_email}


@app.websocket("/ws/stream")
async def stream(ws: WebSocket) -> None:
    await manager.connect(ws)
    try:
        # Hydrate the new client with the full current state.
        await ws.send_json({"type": "snapshot", "payload": engine.snapshot()})
        while True:
            cmd = await ws.receive_json()
            engine.apply_command(cmd)
    except WebSocketDisconnect:
        await manager.disconnect(ws)
    except Exception as exc:  # pragma: no cover - defensive
        logger.error(f"WebSocket error: {exc}")
        await manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api.ws_server:app", host="0.0.0.0", port=8000, reload=False)
