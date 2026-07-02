# SWaT AI Guardian — Frontend

A **React + TypeScript + Tailwind CSS + Apache ECharts** dashboard that replaces
the legacy Streamlit UI (`src/dashboard/app_kafka_live.py`). It is a **pure
frontend**: it renders live anomaly-detection state pushed from a backend over a
WebSocket. No ML runs in the browser.

## Stack

| Concern        | Choice                          |
| -------------- | ------------------------------- |
| Build / dev    | Vite                            |
| UI             | React 18 + TypeScript (strict)  |
| Styling        | Tailwind CSS (tokens ported from the Streamlit CSS) |
| Charts         | Apache ECharts (`echarts-for-react`) |
| State          | Zustand                         |
| Live data      | WebSocket (pluggable transport) |

## Quick start

```bash
cd frontend
npm install
cp .env.example .env      # defaults to VITE_TRANSPORT=mock
npm run dev               # http://localhost:5173
```

Out of the box it runs in **mock mode** — an in-browser simulator
(`src/services/mockTransport.ts`) fabricates `AnomalyDetector`-style output so
the entire UI is demoable with zero backend.

### Live mode (real backend)

The backend is implemented at `src/api/ws_server.py` — it wraps the existing
`AnomalyDetector` + Kafka/CSV consumer and speaks the contract below. Start it:

```bash
# from the repo root, using the project venv
cd src
python -m uvicorn api.ws_server:app --host 0.0.0.0 --port 8000
```

Then point the frontend at it:

```env
VITE_TRANSPORT=ws
VITE_WS_URL=/ws/stream      # proxied to ws://localhost:8000 in dev (see vite.config.ts)
```

It auto-detects Kafka and falls back to replaying `data/*.csv`; if the ML
artifacts can't load it degrades to a synthetic stream so the UI still runs.

## Architecture

```
transport (WebSocket | Mock)  ──ServerMessage──▶  Zustand store  ──▶  React panels
        ▲                                                                  │
        └────────────────────  ClientCommand  ◀───────  Control Center ────┘
```

- **`src/types/index.ts`** — the single source of truth for the wire protocol.
- **`src/services/`** — `Transport` interface + `WebSocketTransport` (auto-reconnect,
  command buffering) + `MockTransport`. Selected via `createTransport()`.
- **`src/store/useDashboardStore.ts`** — applies `ServerMessage`s; keeps a rolling
  120-tick window for the charts.
- **`src/hooks/`** — `useLiveData` (transport lifecycle), `useDerivedMetrics`
  (risk/severity/lag), `CommandContext` (dispatch).
- **`src/components/`** — `layout/` (TopBar, MetricCard), `panels/` (charts, feed,
  control center, root cause, timeline, log), `ui/` (Panel, Badge).

The risk/severity math and stream-freshness thresholds are ported verbatim from
the Streamlit `update_dashboard_view()` (see `src/utils/severity.ts`).

## Backend contract (what the WebSocket must speak)

The backend should accept a WebSocket at `VITE_WS_URL` and push JSON frames
(`ServerMessage`). This is a thin shim over the existing pipeline
(`AnomalyDetector.predict()` + the Streamlit session state).

**Server → Client** (`type` discriminates):

- `snapshot` — full hydrate on connect: `{ state, ticks[], incidents[], log[] }`
- `tick` — one scored frame: `{ ts, mse, threshold, isAnomaly, isIso, isoScore, label, topFeatures, sensors }`
- `incidents` — full aggregated incident list (replace, not append)
- `log` — latest event-log rows (replace)
- `state` — `SystemState` (run/speed/mode/sensitivity/backendMode)

**Client → Server** (`ClientCommand`):

- `{ type: "setMode", mode: "Normal" | "Attack" }`
- `{ type: "setSensitivity", sensitivity: "Conservative" | "Balanced" | "Aggressive" }`
- `{ type: "setSpeed", speed: number }`
- `{ type: "setRun", run: boolean }`
- `{ type: "reset" }`

Mapping to the existing Python: `setMode/setSpeed/setRun` → `utils.set_system_status`;
`setSensitivity` → threshold multiplier (`Conservative 2.0 / Balanced 1.0 /
Aggressive 0.5`) applied to `AnomalyDetector.ae_threshold`; ticks come straight
from `predict()`. See the field-level docs in `src/types/index.ts`.

## Scripts

- `npm run dev` — dev server
- `npm run build` — typecheck + production build
- `npm run typecheck` — types only
- `npm run lint` — ESLint
