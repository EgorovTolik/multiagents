#!/bin/bash
# Запуск сервера multiagents с синхронизацией компонентов в node_modules

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Останавливаем все существующие процессы сервера
echo "⏹ Остановка старых процессов..."
pkill -f "tsx.*src/index.ts" 2>/dev/null || true
pkill -f "npm exec tsx watch src/index.ts" 2>/dev/null || true
sleep 2

echo "🔗 Синхронизация компонента plan-manager..."
cd "$ROOT/components/plan-manager" && npm link 2>/dev/null | tail -1
cd "$ROOT/server" && npm link @multiagents/plan-manager 2>/dev/null | tail -1

echo "✅ Компоненты синхронизированы"
echo "🚀 Запуск сервера на http://localhost:3000..."

# Запуск через nohup — сервер не остановится при закрытии терминала
LOG_FILE="$ROOT/server.log"
cd "$ROOT/server" && nohup npx tsx src/index.ts > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "📋 PID: $SERVER_PID"

# Ждём пока сервер начнёт слушать порт (до 30 секунд)
echo "⏳ Ожидание запуска сервера..."
for i in {1..30}; do
  if curl -s http://localhost:3000/api/agents > /dev/null 2>&1; then
    echo "✅ Сервер успешно запущен на http://localhost:3000"
    exit 0
  fi
  sleep 1
done

echo "❌ Сервер не запустился в течение 30 секунд"
cat "$LOG_FILE" | tail -20
exit 1
