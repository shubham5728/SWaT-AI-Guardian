# SWaT AI Guardian — Technical Documentation

> Accurate technical reference derived from the actual codebase. No marketing
> language. Every described behaviour maps to real implementation. File/symbol
> references point to the source.

Key source files:
- `src/inference/streaming_inference.py` — ML model + preprocessing + ensemble (`AnomalyDetector`)
- `src/api/ws_server.py` — FastAPI WebSocket backend, streaming engine, incident/eval logic
- `src/utils.py` — config + system-state persistence
- `src/notifications.py` — email alerts (`NotificationManager`)
- `frontend/` — React + TypeScript dashboard
- `models/threshold.json`, `models/*.pkl`, `models/model.h5` — trained artifacts

---

## 1. Executive Summary

SWaT AI Guardian is a real-time anomaly-detection dashboard for a water-treatment
plant, built on the Secure Water Treatment (SWaT) testbed dataset. It continuously
scores streaming sensor telemetry, flags abnormal operating conditions that may
indicate cyber-physical attacks or faults, and presents the results to an operator
through a live web interface.

**Problem it solves.** Industrial control systems expose dozens of sensors and
actuators. Hand-written rules cannot anticipate novel ("zero-day") attacks or
subtle process faults. The system learns the plant's *normal* behaviour from data
and flags deviations from it, without needing labelled attack examples to train.

**Who it is for.** Plant operators / SOC analysts (the dashboard), and ML/industrial
engineers evaluating the detection approach. In its current form it is a
demonstration/portfolio-grade system running on a labelled offline dataset, not a
production deployment against a live plant.

**Why this architecture.** An **Autoencoder** learns to reconstruct normal sensor
patterns; large reconstruction error signals "this doesn't look normal." An
**Isolation Forest** adds a complementary, density-based detector that catches rare
points the autoencoder may still reconstruct well. The two run as an **ensemble**.
The model is trained offline (notebook) and only does **inference** at runtime, so a
lightweight Python backend can serve it. The backend streams scored frames over a
**WebSocket** to a decoupled **React** frontend — the same separation of concerns
used in real monitoring systems, and what makes the UI swappable and the backend
independently testable.

The project deliberately avoids fabricated metrics: it shows reconstruction error,
threshold distance, and (because the dataset is labelled) a live confusion matrix —
not invented "confidence" percentages.

---

## 2. End-to-End System Architecture

```
Data Source (CSV replay / Kafka)
        ↓
Streaming Consumer (FileSimulatedConsumer | KafkaConsumer)
        ↓
Preprocessing (rolling-window SMA feature engineering, 100-dim vector)
        ↓
RobustScaler            (median/IQR normalization)
        ↓
PCA (15 components)     (decorrelate + reduce)
        ↓
StandardScaler          (normalize PCA components)
        ↓
Autoencoder             (reconstruction error / MSE)        ┐
        ↓                                                   ├─ run on the same 15-dim vector
Isolation Forest        (isolation/decision_function score) ┘
        ↓
Ensemble Decision       (MSE > threshold) OR (iso_score < iso_threshold)
        ↓
Incident Engine         (severity, aggregation, lifecycle, event log, confusion matrix)
        ↓
WebSocket (/ws/stream)  (JSON ServerMessages)
        ↓
React Dashboard         (Zustand store → panels)
```

**Data Source.** SWaT 2015 sensor records. In Docker the backend replays
`data/attack.csv` or `data/normal.csv` (`DISABLE_KAFKA=1`); if a Kafka broker is
present it can consume a live topic instead. Each record is a dict of 50 sensor
tags plus a `Normal/Attack` ground-truth label and a timestamp.
- *Input:* none (it is the source). *Output:* one raw sensor dict per frame.

**Streaming Consumer** (`build_consumer`, `FileSimulatedConsumer` in `ws_server.py`).
Yields records one batch at a time, paced by the configured simulation speed. Kafka
is tried first, then CSV replay; if a mode is selected the matching file is used.
- *Input:* CSV/Kafka. *Output:* `poll()` → batches of raw records.

**Preprocessing** (`AnomalyDetector.preprocess`). Maintains a `deque(maxlen=5)`
buffer. For each of the 50 base sensors it computes a 5-sample **Simple Moving
Average (SMA)**, producing the engineered `*_SMA` features. It then aligns values to
the exact 100-column order the model was trained on (`model_columns.json` = 50 base
+ 50 SMA) and returns a `(1, 100)` float array.
- *Input:* raw sensor dict. *Output:* 100-dim feature vector.

**RobustScaler.** Scales each of the 100 features using **median and IQR**
(`(x − median) / IQR`). Chosen over StandardScaler because sensor data contains
outliers/attacks; median/IQR are not skewed by them, so the learned "normal"
geometry is preserved.
- *Input:* 100-dim. *Output:* 100-dim robust-scaled.

**PCA (15 components).** Projects the scaled 100-dim vector to 15 principal
components — decorrelating features and reducing dimensionality so the autoencoder
models the dominant structure rather than noise.
- *Input:* 100-dim. *Output:* 15-dim.

**StandardScaler (post-PCA, `pca_scaler`).** Standardizes the 15 PCA components to
zero mean / unit variance so each component contributes comparably to the
reconstruction-error (MSE) calculation.
- *Input:* 15-dim. *Output:* 15-dim (the model's actual input space).

**Autoencoder.** Reconstructs the 15-dim vector; the mean squared error between
input and reconstruction is the anomaly score.
- *Input:* 15-dim. *Output:* scalar MSE.

**Isolation Forest.** `decision_function` on the same 15-dim vector; lower score =
more isolated = more anomalous.
- *Input:* 15-dim. *Output:* scalar iso score.

**Ensemble Decision.** `is_anomaly = (mse > active_threshold) OR (iso_score < iso_threshold)`.
- *Input:* MSE, iso score. *Output:* boolean + scores + top-feature attribution.

**Incident Engine** (`StreamEngine` in `ws_server.py`). Converts a stream of scored
frames into operator-facing state: severity bucket, de-duplicated incidents with a
lifecycle, an event log, and a running confusion matrix vs ground truth.
- *Input:* per-frame prediction + label. *Output:* incidents, log, metrics, ticks.

**WebSocket.** Pushes JSON `ServerMessage`s (`snapshot`, `tick`, `incidents`, `log`,
`metrics`, `state`) and accepts `ClientCommand`s.

**React Dashboard.** A WebSocket client feeds a Zustand store; components render
purely from store state. No values are hardcoded in the UI.

---

## 3. Machine Learning Pipeline

(All from `src/inference/streaming_inference.py` and `models/`.)

### Autoencoder architecture (`build_autoencoder_scientific`)
With `input_dim = 15` (PCA components) and `h_factor = 0.5` → `bottleneck = 7`:

```
Input(15)
→ Dense(15, tanh)        # encoder
→ Dropout(0.1)
→ Dense(7,  tanh)        # bottleneck
→ Dense(15, tanh)        # decoder
→ Dense(15, linear)      # output (reconstruction)
```

An undercomplete autoencoder: the 7-unit bottleneck forces it to learn a compressed
representation of *normal* data. Normal inputs reconstruct well (low error); abnormal
inputs reconstruct poorly (high error).

### Reconstruction error
`mse = mean((final_features − reconstruction)²)` over the 15 dimensions. This is the
raw, unscaled model output ("the honest model output", per code comment). It is
computed in the **PCA-reduced, standardized space**, not on raw sensor units.

### Threshold calculation
Loaded from `models/threshold.json`:
- `ae_threshold = 3.6262`, `threshold_type = "Data-Driven (99.9th Percentile)"`.
The threshold is the 99.9th percentile of reconstruction error over normal data
computed at training time. Rationale: it caps the expected false-positive rate
(~0.1% on normal data) and ties the cutoff to the model's own error distribution
instead of an arbitrary constant. At runtime it is multiplied by a sensitivity
factor (Conservative ×2.0, Balanced ×1.0, Aggressive ×0.5).

### Isolation Forest
`iso_threshold = -0.0727` (`threshold.json`). `decision_function` < threshold ⇒
flagged. It isolates rare points using random splits; fewer splits to isolate ⇒ more
anomalous. It complements the autoencoder by catching globally rare feature
combinations that may still sit inside the autoencoder's learned manifold.

### Ensemble logic
`is_anomaly = (mse > active_threshold) OR (iso_score < iso_threshold)`. An OR rule
maximises recall: a frame is flagged if *either* detector considers it anomalous.

### Feature preprocessing — design rationale
- **Why RobustScaler:** median/IQR are robust to the outliers and attack spikes in
  the data, so scaling does not get distorted by anomalies; normal structure is
  preserved.
- **Why PCA:** decorrelates the 100 engineered features and reduces to 15 dominant
  components, lowering noise and giving the autoencoder a compact, meaningful input.
- **Why StandardScaler *after* PCA:** PCA components have different variances; the
  autoencoder's MSE treats all dimensions equally, so standardizing post-PCA ensures
  each component contributes fairly to the error.

### Training process
Done offline in `src/notebooks/SWaT_Anomaly_Detection.ipynb` on normal data
(GPU-assisted). It fits RobustScaler, PCA, StandardScaler, the autoencoder, and the
Isolation Forest, then computes the 99.9th-percentile threshold, and saves all
artifacts to `models/` (`scaler.pkl`, `pca.pkl`, `pca_scaler.pkl`, `iso_forest.pkl`,
`model.h5` / `model_weights.h5`, `model_columns.json`, `threshold.json`). The backend
never trains.

### Inference process (`AnomalyDetector.predict`)
1. RobustScaler.transform → 100-dim scaled.
2. Attribution: `|scaled[0]|`, take the top-5 features by absolute value.
3. PCA.transform → 15-dim; StandardScaler.transform → 15-dim.
4. Autoencoder.predict → reconstruction → MSE.
5. Isolation Forest.decision_function → iso score.
6. Ensemble OR → `is_anomaly`; return MSE, flags, scores, top features.

---

## 4. Backend Documentation

(`src/api/ws_server.py`, FastAPI + `uvicorn`.)

- **FastAPI app.** CORS-open; lifespan starts/stops the streaming engine.
- **WebSocket `/ws/stream`.** On connect sends a `snapshot` (full current state),
  then streams `tick` / `incidents` / `log` / `metrics` / `state` messages. Receives
  `ClientCommand`s. `ConnectionManager` broadcasts to all clients and prunes dead
  sockets.
- **REST APIs.**
  - `GET /api/health` — liveness, detector status (`loaded`/`synthetic`), backend
    mode, connected client count.
  - `GET /api/snapshot` — REST mirror of the WS snapshot.
  - `POST /api/test-email` — sends a one-off test alert email (bypasses cooldown).
- **Streaming consumer.** Kafka or CSV replay (`build_consumer`,
  `FileSimulatedConsumer`). `DISABLE_KAFKA=1` skips the Kafka probe. Rebuilds when
  the data mode changes.
- **StreamEngine (worker thread).** Daemon thread runs the poll→score→update loop;
  broadcasts to the asyncio loop via `run_coroutine_threadsafe`. Holds: a 120-frame
  history (for charts), incidents, a 50-entry event log, the confusion matrix, the
  system state, and model metadata.
- **Incident manager.** `_upsert_incident` aggregates by `(alarm type, base sensor)`
  — raw and `_SMA` variants collapse to one base sensor. Lifecycle: `New → Ongoing`
  (after ≥3 occurrences) `→ Acknowledged` (operator) `→ Resolved` (manual, or
  auto after 60s with no recurrence) `→ Archived` (180s after resolution). Each
  incident carries `createdAt / acknowledgedAt / resolvedAt / acknowledgedBy /
  resolutionReason`.
- **Evaluation metrics.** Per frame, prediction = "alert raised" (`severity != NORMAL`)
  vs ground-truth label → updates a running confusion matrix `{tp, fp, fn, tn}`,
  emitted each cycle. Precision/Recall/F1 are derived on the frontend.
- **Email alerts** (`NotificationManager`). On a new CRITICAL frame, an email is sent
  asynchronously (daemon thread) with a 5-minute cooldown. Credentials come from
  `src/.env`, injected at runtime via compose `env_file` (not baked into the image).
  Failures are logged and never block the stream.
- **State management.** Run/speed/mode persist to `models/system_state.json`
  (`utils.set_system_status`). The engine **always boots in Normal mode** regardless
  of the persisted value. Sensitivity is in-memory.
- **Severity / risk.** `risk = min((mse / threshold) × 50, 100)`; `>80 CRITICAL`,
  `>60 HIGH`, `>40 MEDIUM`, else `NORMAL`.

---

## 5. Frontend Documentation

(`frontend/src/`, React + TypeScript + Tailwind + Apache ECharts + Zustand. All
panels render from the Zustand store, which is fed only by `ServerMessage`s.)

- **System Status** (`TopBar`/`useDerivedMetrics`). The *effective* severity = the
  higher of the latest frame's severity and the worst active-incident severity, so
  active incidents are never hidden by a momentarily-normal frame.
- **Risk Score.** `min((latest mse / threshold) × 50, 100)` — instantaneous.
- **Active Incidents.** Count of incidents whose status ∈ {New, Ongoing,
  Acknowledged}, with Crit/High/Med breakdown and oldest-active age.
- **Stream Status.** Freshness from time since last tick (`lastTickAt`); shows lag
  and ACTIVE/LOST.
- **Dashboard Health.** Connection state, data source (Kafka/Simulated), engine
  run state, throughput (msgs/sec, derived from recent tick timestamps), and average
  inference latency (`latencyMs` measured around `predict()` in the backend).
- **Incident Feed.** Cards from the `incidents` message: friendly sensor name, status
  badge, duration (frozen at resolution), occurrences, trend, last-seen, and
  Acknowledge/Resolve buttons that dispatch commands.
- **Correlation & Analysis.** Dropdown to select an incident → highlights its time
  span on the anomaly chart (`markArea`).
- **Largest Deviations.** Top contributing sensors (see §6), as a relative
  contribution share, grouped by base sensor. Includes context-derived Recommended
  Actions.
- **Recommended Actions.** Generated from the top contributing sensors' types
  (template mapping in `RootCausePanel`), e.g. a pressure sensor → "Check pressure
  at …". Not an LLM, not a static list.
- **Sensor Telemetry.** Multi-line chart of selected **analog** sensors only
  (FIT/LIT/PIT/DPIT/AIT); discrete valves/pumps (0/1/2 states) are excluded.
- **Security Event Log.** Per-detection rows: time, severity type, ground-truth
  Truth, Result (TP/FP), score, component.
- **Live Evaluation.** Confusion matrix + Precision/Recall/F1 from the `metrics`
  message (see §4).
- **Control Center.** Data mode (Normal/Attack), sensitivity (+ live numeric
  threshold), streaming speed, run/pause, reset, test email, and a Model metadata
  block (pipeline, PCA components, base + active threshold) from the `meta` payload.
- **Charts (ECharts).** Anomaly chart: MSE line (no smoothing, so it passes exactly
  through samples), dashed threshold line with value, red breach shading, breach
  scatter, and a highlighted live "Now" point.

---

## 6. Explainability Documentation

The "Largest Deviations" panel answers *which signals look most abnormal right now*.

- **What it computes.** After RobustScaler, each feature value is
  `(x − median) / IQR`. The panel ranks features by the **absolute robust-scaled
  value** `|(x − median)/IQR|` and shows the top contributors (raw + SMA variants
  grouped per base sensor), as a relative share of the total deviation.
- **Why "Not causal".** This is a per-sample, univariate magnitude — how far each
  signal is from its own normal centre. It does **not** account for the model's
  decision, feature interactions, or each feature's contribution to the actual
  anomaly *score*. So it indicates deviation, not cause; the label says so explicitly.
- **Why it is NOT SHAP.** SHAP/Integrated-Gradients attribute the **model output** to
  inputs, accounting for the model and interactions. This panel ignores the model
  entirely and just measures input deviation — far cheaper, but a different and weaker
  claim. Calling it "feature importance" or "root cause" would be inaccurate.
- **Why it is still useful.** During an anomaly, the most robust-scaled-deviated
  sensors are a strong, fast first place for an operator to look, and they are
  reported in honest units ("robust-scaled / IQR-normalized units"), not as σ
  (which would imply a Gaussian/StandardScaler assumption that does not hold here).

---

## 7. Limitations (honest, code-accurate)

- **Static threshold.** `ae_threshold` is fixed at load from `threshold.json`; only a
  manual sensitivity multiplier changes it. No automatic adjustment.
- **Simulated data source.** In the demo configuration the backend replays
  `data/*.csv`; it is not connected to a live plant/SCADA feed (Kafka path exists but
  is off by default).
- **No drift detection.** If sensors drift, reconstruction error rises and the system
  will flag drift as anomalies/false positives; it cannot distinguish drift from attack.
- **No online / continual learning.** The model is trained once offline; the backend
  only does inference and never updates weights.
- **No causal inference.** Attribution is deviation magnitude, explicitly "not
  causal" (see §6). No root-cause graph or dependency analysis.
- **No adaptive thresholding.** Related to the static threshold; thresholds do not
  adapt to time-of-day, regime, or drift.
- **No probabilistic confidence.** An autoencoder/Isolation-Forest ensemble does not
  yield a calibrated probability; the system deliberately shows reconstruction error,
  threshold distance, and labelled evaluation metrics instead of a fabricated
  "confidence %".
- **Attribution uses raw deviation, not SHAP/gradients** (a known approximation).
- **Single-tenant state.** Engine state is global; control commands affect all
  connected clients (appropriate for a single-plant view, not multi-user RBAC).

---

## 8. Future Improvements

**Production improvements**
- Real SCADA/Kafka/Historian ingestion instead of CSV replay.
- Adaptive / time-aware thresholding and per-stage thresholds.
- Drift detection with alerting (distinguish drift from attack).
- Incident export (CSV/PDF) and a searchable historical incident explorer.
- Alert-stability classification (transient / persistent / flapping) to reduce
  operator fatigue.
- AuthN/RBAC, audit trail, multi-user, persistent storage (DB) for incidents.
- Model-version pinning and inference latency/throughput SLOs.

**Research improvements**
- True explainability (SHAP / Integrated Gradients) over the model output.
- Temporal/contextual attribution (trend-aware, e.g. "pressure rising for N seconds
  while valve open") rather than single-frame deviation.
- Online / incremental learning and adaptive baselines.
- Graph-based root-cause analysis using plant topology/sensor dependencies.
- Sequence models (LSTM/Temporal CNN/Transformer autoencoders) for temporal context.
- Calibrated anomaly scoring / probability estimates.

---

## 10. Demo Walkthrough (what each section does, how values are computed, why useful)

> Written as technical documentation, not a pitch.

1. **Top metric strip.**
   - *System Status* — `SEVERITY_LABEL[effectiveSeverity]`, where effectiveSeverity =
     max(latest-frame severity, worst active-incident severity). Useful because it
     reflects open incidents, not just the instantaneous frame.
   - *Active Incidents* — count of {New, Ongoing, Acknowledged} incidents with
     severity breakdown. Useful for triage load.
   - *Risk Score* — `min((mse/threshold)×50,100)` of the latest frame. A normalized,
     bounded view of "how far over the line" the current frame is.
   - *Stream Status* — `now − lastTickAt`; flags a stalled/dead feed.
   - *Dashboard Health* — connection, source, engine state, throughput (derived from
     recent tick `ts` deltas), inference latency (measured around `predict()`).

2. **Live Anomaly Detection chart.** Plots per-frame **MSE** (reconstruction error)
   vs the dashed **active threshold**. Breach points and shaded breach intervals mark
   `mse > threshold`; the "Now" point is the latest sample (red if breaching). Useful
   to *see* when and how hard the plant crossed the safe limit.

3. **Sensor Telemetry chart.** Live values of selected analog sensors (the current
   top contributors plus baseline FIT101/LIT101/DPIT301). Lets an engineer correlate
   the anomaly score with the underlying physical signals.

4. **Largest Deviations + Recommended Actions.** Top robust-scaled-deviation sensors
   (grouped by base sensor) as relative shares, plus type-derived inspection hints.
   Useful as the first place to look; explicitly "not causal".

5. **Live Evaluation.** Confusion matrix `{tp,fp,fn,tn}` (alert decision vs label) and
   derived Precision = tp/(tp+fp), Recall = tp/(tp+fn), F1 = harmonic mean. Useful
   because it shows *real* detector quality, including misses (FN), with no fabricated
   confidence.

6. **Incident Feed.** Aggregated incidents with lifecycle, duration (frozen at
   resolution), occurrences, trend, and Acknowledge/Resolve actions. Useful as an
   operator workflow rather than a raw alert stream.

7. **Event Timeline + Security Event Log.** Per-detection records. The log's Truth +
   Result columns show, per event, whether the alert was a true or false positive
   against ground truth.

8. **Control Center.** Switches data mode (which rebuilds the consumer), sensitivity
   (which scales the active threshold immediately — visible numerically), speed,
   run/pause, reset, test email, and shows model metadata. Every control maps to a
   backend command; nothing is UI-only state.
