#!/bin/bash

# AgentLens Quick Start —Start all services
# Usage: ./start-all.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "AgentLens Quick Start"
echo "=========================================="
echo ""

echo "Starting Docker containers (PostgreSQL, Redis, MinIO)..."
docker-compose up -d
echo "Docker containers started"
echo "Waiting for services to be ready..."
sleep 3

echo "Starting TypeScript backend on port 8001..."
if command -v tmux &> /dev/null; then
    tmux new-session -d -s agentlens-backend -c "$PROJECT_ROOT" \
        "pnpm --filter api-ts dev"
    echo "Backend started in tmux session 'agentlens-backend'"
else
    echo "Start backend manually: pnpm --filter api-ts dev"
fi

echo "Starting frontend on port 3000..."
if command -v tmux &> /dev/null; then
    tmux new-session -d -s agentlens-frontend -c "$PROJECT_ROOT" \
        "NEXT_PUBLIC_API_URL=http://localhost:8001 NEXT_PUBLIC_WS_URL=ws://localhost:8001 pnpm --filter web dev"
    echo "Frontend started in tmux session 'agentlens-frontend'"
else
    echo "Start frontend manually: NEXT_PUBLIC_API_URL=http://localhost:8001 NEXT_PUBLIC_WS_URL=ws://localhost:8001 pnpm --filter web dev"
fi

echo ""
echo "Access points:"
echo "   Frontend: http://localhost:3000"
echo "   Backend API: http://localhost:8001"
echo "   WebSocket: ws://localhost:8001/ws/missions/<mission-id>"
echo ""
echo "Run a demo:"
echo "   python examples/hitl_release_gate_demo.py"
echo "   python examples/hitl_incident_response_demo.py"
echo ""
echo "Stop all services:"
if command -v tmux &> /dev/null; then
    echo "   tmux kill-session -t agentlens-backend"
    echo "   tmux kill-session -t agentlens-frontend"
fi
echo "   docker-compose down"
