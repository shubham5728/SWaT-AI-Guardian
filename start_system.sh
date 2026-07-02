#!/bin/bash
# SWaT AI Guardian - WSL/Linux Startup Script

echo "==========================================="
echo "  SWaT AI GUARDIAN - WSL STARTUP"
echo "==========================================="
echo "  Running in Docker (WSL + GPU)"
echo "==========================================="
echo ""

# 1. Cleanup existing containers
echo "[1/3] Clean Shutdown of previous sessions..."
docker compose down --remove-orphans || true

# This fixes the "container name already in use" error
echo "Force removing potentially stuck containers..."
docker rm -f swat-zookeeper swat-kafka swat-kafka-ui swat-init swat-api swat-inference swat-producer swat-spark 2>/dev/null || true

# 2. Start System
echo ""
echo "[2/3] Building and Starting Services with GPU Support..."
echo "    - Kafka Infrastructure"
echo "    - API Backend"
echo "    - Inference Engine (GPU)"
echo "    - Spark Engine (GPU)"
echo "  (React dashboard: run 'docker compose -f docker-compose.web.yml up --build' → http://localhost:8080)"
echo ""

docker compose up --build -d

if [ $? -ne 0 ]; then
    echo ""
    echo "[!] ERROR: Docker Startup Failed!"
    exit 1
fi

# 3. Launching Log Monitors
echo ""
echo "[3/3] Launching Log Monitors in background tabs..."
echo "Tip: Use ./monitor_logs.sh to view logs later."

echo ""
echo "Opening monitoring UIs in Windows Browser..."
sleep 5
# Try to open browser from WSL using cmd.exe
# Function to open URL in Windows browser from WSL
open_url() {
    local url=$1
    if command -v cmd.exe &> /dev/null; then
        cmd.exe /c start "$url" 2>/dev/null
    elif command -v explorer.exe &> /dev/null; then
        explorer.exe "$url" 2>/dev/null
    elif command -v wslview &> /dev/null; then
        wslview "$url" 2>/dev/null
    else
        echo "  - Please open manually: $url"
        return 1
    fi
}

echo "Opening Kafka UI and API Docs..."
open_url "http://localhost:8081"
open_url "http://localhost:8000/docs"

echo ""
echo "==========================================="
echo "  System Started Successfully."
echo "==========================================="
