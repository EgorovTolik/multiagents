#!/bin/bash
# Запуск сервера multiagents с синхронизацией компонентов в node_modules

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "🔗 Синхронизация компонента plan-manager..."
cd "$ROOT/components/plan-manager" && npm link --silent
cd "$ROOT/server" && npm link @multiagents/plan-manager --silent

echo "✅ Компоненты синхронизированы"
echo "🚀 Запуск сервера на http://localhost:3000..."

# Останавливаем все существующие процессы сервера
echo "⏹ Остановка старых процессов..."
pkill -f "tsx.*src/index.ts" 2>/dev/null || true
pkill -f "npm exec tsx watch src/index.ts" 2>/dev/null || true
sleep 2

# Запуск через nohup — сервер не остановится при закрытии терминала
LOG_FILE="$ROOT/server.log"
cd "$ROOT/server" && nohup npx tsx src/index.ts > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "📋 PID: $SERVER_PID"
wait $SERVER_PID
