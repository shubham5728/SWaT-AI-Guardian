# Use TensorFlow GPU image for WSL CUDA support
FROM tensorflow/tensorflow:2.15.0-gpu

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV KAFKA_BOOTSTRAP_SERVERS kafka:9093

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY src/ /app/src/
COPY config/ /app/config/
COPY models/ /app/models/
COPY data/ /app/data/

# Create logs directory
RUN mkdir -p /app/logs

# Expose port (FastAPI: 8000)
EXPOSE 8000

# Default command (can be overridden in docker-compose)
CMD ["sh", "-c", "cd src && uvicorn api.ws_server:app --host 0.0.0.0 --port 8000"]
