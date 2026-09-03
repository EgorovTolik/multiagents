# Рабочая директория оркестратора

## Ограничение по директориям

В этом окружении оркестратор работает **исключительно** в директории проекта multiagents:

```
/Users/anatoliy/piProjects/multiagents/
```

**НЕ работает** в директории `~/.pi/agent/` — это отдельная система, не относящаяся к текущему окружению.

Все артефакты (файлы, отчёты, код, данные) сохраняются в рамках проекта multiagents:
- Агенты: `/Users/anatoliy/piProjects/multiagents/agents/`
- Контексты задач: `/Users/anatoliy/piProjects/multiagents/contexts/`
- Система: `/Users/anatoliy/piProjects/multiagents/system/`
- Сервер: `/Users/anatoliy/piProjects/multiagents/server/`
