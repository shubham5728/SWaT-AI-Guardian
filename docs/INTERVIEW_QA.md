# SWaT AI Guardian — Technical Q&A (50)

Accurate answers grounded in the actual implementation. Use alongside
`TECHNICAL_DOCUMENTATION.md`.

## A. Machine Learning — model & pipeline

**1. What models does the system use?**
An ensemble of an undercomplete **Autoencoder** (reconstruction-error detector) and
an **Isolation Forest** (isolation/density detector), both trained on normal data.

**2. Is this supervised or unsupervised?**
The detectors are **unsupervised** (trained only on normal data). Ground-truth
attack labels exist in the dataset and are used only for *evaluation* (the live
confusion matrix) and to pick the replay file — not for training.

**3. Describe the autoencoder architecture.**
Input(15) → Dense(15, tanh) → Dropout(0.1) → Dense(7, tanh, bottleneck) →
Dense(15, tanh) → Dense(15, linear). Input dim = 15 PCA components; bottleneck =
`int(15×0.5)=7`.

**4. Why an undercomplete autoencoder?**
The 7-unit bottleneck forces a compressed representation of normal behaviour. Normal
inputs reconstruct with low error; abnormal inputs reconstruct poorly → high error.

**5. What exactly is the anomaly score?**
Mean squared error between the 15-dim standardized-PCA input and its reconstruction:
`mean((x − x̂)²)`. It is the raw model output, unscaled.

**6. In which space is the MSE computed?**
In the **PCA-reduced, StandardScaler-normalized 15-dim space**, not in raw sensor
units.

**7. How is the detection threshold chosen?**
It is the **99.9th percentile** of reconstruction error over normal data, computed at
training time (`threshold.json: ae_threshold=3.6262`, type "Data-Driven (99.9th
Percentile)").

**8. Why a percentile threshold instead of a fixed number?**
It bounds the false-positive rate (~0.1% on normal data) and ties the cutoff to the
model's own error distribution, so it generalizes with the model rather than being
an arbitrary constant.

**9. What does the Isolation Forest add?**
A complementary detector: it isolates globally rare feature combinations using random
splits. It can catch anomalies the autoencoder reconstructs adequately, improving
recall.

**10. What is the ensemble rule?**
`is_anomaly = (mse > active_threshold) OR (iso_score < iso_threshold)`
(`iso_threshold=-0.0727`). OR maximises recall.

**11. Why RobustScaler and not StandardScaler first?**
RobustScaler uses median/IQR, which are insensitive to the outliers and attack spikes
in the data, so scaling isn't distorted by anomalies and the normal geometry is
preserved.

**12. Why PCA before the autoencoder?**
To decorrelate the 100 engineered features and reduce to 15 dominant components,
cutting noise and giving the autoencoder a compact, meaningful input.

**13. Why StandardScaler *after* PCA?**
PCA components have unequal variances; MSE weights all dimensions equally, so
standardizing post-PCA makes each component contribute fairly to the error.

**14. How many input features feed preprocessing?**
100: 50 base sensor tags + 50 5-sample SMA features (`model_columns.json`).

**15. What are the SMA features and why?**
5-sample simple moving averages of each base sensor (rolling window via a
`deque(maxlen=5)`), adding short-term temporal context to an otherwise per-frame model.

**16. How is feature attribution computed?**
`|RobustScaler(x)|` per feature, top-5 by absolute value. It's the per-sample
deviation magnitude in robust-scaled units.

**17. Is the attribution SHAP or gradient-based?**
No. It is a heuristic input-deviation magnitude. It ignores the model and feature
interactions — hence labelled "not causal".

**18. Why call it "robust-scaled units" and not σ?**
Because the value is `(x − median)/IQR`, not `(x − mean)/std`. Reporting "σ" would
falsely imply a Gaussian/StandardScaler basis.

**19. Where is the model trained?**
Offline in `src/notebooks/SWaT_Anomaly_Detection.ipynb` (GPU-assisted). The backend
only loads artifacts and runs inference.

**20. What artifacts are persisted?**
`scaler.pkl`, `pca.pkl`, `pca_scaler.pkl`, `iso_forest.pkl`, `model.h5`/
`model_weights.h5`, `model_columns.json`, `threshold.json`.

**21. How does the sensitivity control affect detection?**
It multiplies the AE threshold: Conservative ×2.0, Balanced ×1.0, Aggressive ×0.5.
Lower threshold → more alerts (higher recall, more false positives).

**22. What dataset is used?**
SWaT (Secure Water Treatment, iTrust/SUTD), 2015 collection — 50 sensors/actuators
across 6 treatment stages, with a Normal/Attack label.

**23. What's the difference between `is_anomaly` and the severity bucket?**
`is_anomaly` is the model's ensemble boolean. Severity is derived from a risk score
`min((mse/threshold)×50,100)` (>40 MEDIUM, >60 HIGH, >80 CRITICAL) — a graded view
used for UI/alerting.

**24. Could the model output a probability/confidence?**
Not natively; neither component yields a calibrated probability. The system instead
reports MSE, threshold distance, and labelled evaluation metrics — no fabricated
confidence.

**25. How would you evaluate this model offline?**
Reconstruction-error distribution on held-out normal vs attack, ROC/PR curves over
the threshold, and Precision/Recall/F1 — which the live panel computes online here.

## B. Data Science — evaluation & data

**26. How is the live confusion matrix defined?**
Per frame, prediction = "alert raised" (`severity != NORMAL`); ground truth = dataset
label. Counts accumulate into `{tp, fp, fn, tn}`.

**27. How are Precision/Recall/F1 computed?**
Precision = tp/(tp+fp), Recall = tp/(tp+fn), F1 = 2PR/(P+R), with division-by-zero
guarded (returns 0).

**28. Why can recall be < 100% in the demo?**
The model genuinely misses some attack frames (FN); the dashboard shows this honestly
rather than hiding it.

**29. Is the confusion matrix on the model's raw `is_anomaly` or the alert decision?**
On the **alert decision** (`severity != NORMAL`), i.e. what the system actually acts
on. This is stated explicitly in the panel ("alert decision vs label").

**30. How is class imbalance handled in the metrics?**
It isn't reweighted — raw counts are shown. Normal frames dominate (large TN), which
is why Precision/Recall/F1 (not accuracy) are the headline metrics.

**31. Why might precision look very high?**
In sustained-attack windows almost every flagged frame is truly attack, so FP is low.
This is dataset/segment dependent and visible live.

**32. What preprocessing could leak information?**
None across train/serve here: scalers/PCA are fit on training data and only
`transform` is applied at inference. SMA uses only past samples in the buffer.

## C. Backend / systems

**33. What is the backend stack?**
FastAPI + uvicorn (Python). WebSocket `/ws/stream` plus REST `/api/health`,
`/api/snapshot`, `/api/test-email`. No Flask/Node.

**34. How is real-time delivery implemented?**
A daemon `StreamEngine` thread runs the poll→score→update loop and broadcasts JSON
to connected WebSocket clients via `asyncio.run_coroutine_threadsafe`.

**35. Why a thread plus the asyncio loop, not pure async?**
Inference (TensorFlow/scikit-learn) and the CSV/Kafka consumer are blocking; running
them in a daemon thread keeps the event loop responsive while still broadcasting
through it safely.

**36. What messages does the server send?**
`snapshot` (on connect), then `tick`, `incidents`, `log`, `metrics`, `state`.

**37. What commands does it accept?**
`setMode`, `setSensitivity`, `setSpeed`, `setRun`, `reset`, `acknowledgeIncident`,
`resolveIncident`.

**38. How does the consumer fall back?**
`build_consumer` tries Kafka, else replays `data/*.csv` via `FileSimulatedConsumer`.
`DISABLE_KAFKA=1` skips the Kafka probe (used in Docker).

**39. How is the stream paced?**
`sleep(max(0.02, 0.30 / simulation_speed))` per record, so speed controls throughput.

**40. How are incidents aggregated and de-duplicated?**
By `(alarm type, base sensor)`; raw and `_SMA` variants collapse to the base sensor
(`_SMA` suffix stripped) so one physical sensor yields one incident.

**41. Describe the incident lifecycle.**
`New → Ongoing` (≥3 occurrences) `→ Acknowledged` (operator) `→ Resolved` (manual or
auto after 60s idle) `→ Archived` (180s after resolution), with timestamps and
`acknowledgedBy`/`resolutionReason`.

**42. How is inference latency measured?**
`time.perf_counter()` around `preprocess`+`predict` in `_score`, attached to each tick
as `latencyMs`; the UI averages recent values.

**43. How do email alerts avoid spam and blocking?**
Sent only on a new CRITICAL frame, on a daemon thread (non-blocking), with a 5-minute
cooldown. SMTP failures are logged, never crash the stream.

**44. How are credentials handled in Docker?**
`src/.env` is excluded from the image (`.dockerignore`) and injected at runtime via
compose `env_file` — secrets are not baked into the image.

**45. What state is persisted across restarts?**
Run/speed/mode in `models/system_state.json`. On boot the engine forces **Normal**
mode regardless. Incidents/metrics are in-memory (reset on restart).

**46. What happens on WebSocket disconnect?**
The client auto-reconnects with capped backoff and buffers commands; on reconnect it
receives a fresh `snapshot`, so server-side state (incidents, metrics) is preserved.

## D. Frontend / AI-engineering

**47. How does the frontend stay consistent with backend state?**
All panels read from a single Zustand store fed only by `ServerMessage`s. Derived
values (risk, severity, throughput, latency) are computed from store data; nothing is
hardcoded.

**48. Why exclude valves/pumps from the telemetry chart?**
MV (valves) and P (pumps) are discrete 0/1/2 states, not continuous signals; plotting
them as trend lines on a shared analog axis is misleading, so only FIT/LIT/PIT/DPIT/AIT
are shown.

**49. Why is the anomaly line drawn without smoothing?**
A smoothed spline overshoots on steep rises and would not pass through the actual
samples (and the breach markers). Straight segments keep the line faithful to the data.

**50. (Industrial AI) If a sensor drifts over weeks, what happens, and how would you fix it?**
With a static threshold, drift raises reconstruction error and the system flags it as
persistent anomalies / false positives — it cannot tell drift from attack. Fixes:
drift detection (e.g. distribution monitoring), adaptive/time-aware thresholding, and
periodic re-training or online baseline updates (all listed as future work).
