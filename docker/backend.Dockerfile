# SWaT AI Guardian — streaming backend (FastAPI + AnomalyDetector)
FROM python:3.10-slim

# h5py / scipy wheels need libgomp at runtime; build-essential helps any sdist.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-backend.txt .
# Large wheels (tensorflow-cpu ~207MB) on a slow link can exceed pip's default
# 15s socket timeout — raise the timeout and add retries so the build is robust.
RUN pip install --no-cache-dir --timeout 1000 --retries 10 \
    -r requirements-backend.txt

# App code only — models/, data/, config/ are mounted as volumes at runtime.
COPY src /app/src

WORKDIR /app/src
EXPOSE 8000

# CSV replay by default (no Kafka broker inside the container).
ENV DISABLE_KAFKA=1

CMD ["uvicorn", "api.ws_server:app", "--host", "0.0.0.0", "--port", "8000"]
