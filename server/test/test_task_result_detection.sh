#!/bin/bash
# Тест логики сопоставления task и result файлов по номерам

TESTDIR="/tmp/test-task-result-detection"
rm -rf $TESTDIR

echo "=== Test 1: Task exists, no result (incomplete) ==="
mkdir -p "$TESTDIR/tasks"
echo "# Задание: Тест" > "$TESTDIR/tasks/task-001.md"

# Find last task number
LAST_TASK=$(ls "$TESTDIR/tasks" | grep "^task-" | sort -t'-' -k2 -n | tail -1)
TASK_NUM=${LAST_TASK##*-}
TASK_NUM=${TASK_NUM%.md}

# Check for result file
if [ -f "$TESTDIR/results/result-${TASK_NUM}.md" ]; then
    echo "FAILED: Found result file when none should exist"
else
    echo "PASSED: Task exists without corresponding result (incomplete detected)"
fi

echo ""
echo "=== Test 2: Both task and result exist (completed) ==="
mkdir -p "$TESTDIR/results"
echo "# Результат: Готово" > "$TESTDIR/results/result-${TASK_NUM}.md"

if [ -f "$TESTDIR/tasks/task-${TASK_NUM}.md" ] && [ -f "$TESTDIR/results/result-${TASK_NUM}.md" ]; then
    echo "PASSED: Task and result both exist (completed)"
else
    echo "FAILED: Missing files"
fi

echo ""
echo "=== Test 3: Multiple tasks, only last incomplete ==="
rm -rf $TESTDIR
mkdir -p "$TESTDIR/tasks" "$TESTDIR/results"
echo "# Задание: 1" > "$TESTDIR/tasks/task-001.md"
echo "# Результат: 1" > "$TESTDIR/results/result-001.md"
echo "# Задание: 2" > "$TESTDIR/tasks/task-002.md"

LAST_TASK=$(ls "$TESTDIR/tasks" | grep "^task-" | sort -t'-' -k2 -n | tail -1)
TASK_NUM=${LAST_TASK##*-}
TASK_NUM=${TASK_NUM%.md}

if [ "$TASK_NUM" = "002" ] && [ ! -f "$TESTDIR/results/result-002.md" ]; then
    echo "PASSED: Detected incomplete task-002 (last task has no result)"
else
    echo "FAILED: Did not detect incomplete last task"
fi

rm -rf $TESTDIR
echo ""
echo "All tests completed."