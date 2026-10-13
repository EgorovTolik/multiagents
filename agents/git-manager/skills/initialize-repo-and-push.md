---
name: initialize-repo-and-push
description: Инициализация нового git-репозитория в папке проекта и первый пуш в пустой удалённый репозиторий (remote, .gitignore, коммит, push на master).
---

# Инициализация репозитория и первый пуш

Применяй, когда рабочая папка — **обычная директория без `.git`**, а пользователь дал URL **пустого** удалённого репозитория (например, только что созданного на GitHub/GitLab) с поручением «оформи/залей сам».

## 1. Убедись, что это не уже репозиторий и ты в правильной папке
```bash
git rev-parse --show-toplevel   # должен быть путь к твоему контексту/проекту, НЕ .../multiagents
ls -la                         # есть ли тут .git? какие файлы проекта
```
Если `.git` уже есть — работай с ним как есть (см. `commit-and-push`). Если папка без `.git` — инициализируй.

## 2. Инициализация с веткой master
Пустой remote обычно ждёт `master`. Создаём репозиторий сразу на ней:
```bash
git init -b master            # Git >= 2.28
# если git init -b не поддерживается:
git init
git checkout -b master
```

## 3. .gitignore — что НЕ добавлять
Создай `.gitignore`, чтобы в коммит не попали системный мусор и артефакты окружения:
```gitignore
# Системные / OS
.DS_Store
Thumbs.db
*.swp

# Зависимости и локальное
node_modules/
vendor/
.env
.env.*

# Артефакты контекста multiagents (НЕ в репозиторий проекта)
results/
tasks/
.pi/

# Логи и прочее
*.log
```
Адаптиру под проект: если это, например, Python-проект — добавь `__pycache__/`, `.venv/`.

## 4. Добавить файлы проекта (not вслепую)
Сначала проверь, что именно попадает в коммит:
```bash
git add -A
git status                      # осмотреться — нет ли чужого/лишнего
git diff --cached --stat
```
Если рядом с кодом есть контекстный шум (папки `results/`, `tasks/` и т.п.), а `.gitignore` его уже отсек — можно смело `git add -A`. Если что-то не закрыто gitignore и это не файл проекта — добавляй точечно:
```bash
git add index.html css/style.css js/app.js js/storage.js .gitignore
```

## 5. Первый коммит
```bash
git commit -m "feat: начальный коммит Todo-трекера (CRUD + localStorage)"
```
Сообщение — в формате `тип: описание` (см. `commit-messages`).

## 6. Привязка remote и пуш на master
```bash
git remote add origin https://github.com/EgorovTolik/test-ai-todo.git
git push -u origin master
```
- `-u` закрепляет upstream, чтобы дальше достаточно `git push`.
- Пустой remote → конфликт невозможен, прямой push на `master` корректен (пользователь уже дал URL и поручил действовать сам).

## Если в remote уже есть файлы
Сначала подтяни их, чтобы не перезаписать историю:
```bash
git fetch origin
git branch --set-upstream-to=origin/master master   # или merge основной ветки remote
git push -u origin master
```

**Правило:** после успешного пуша запиши результат через `handoff_file(type='result')` и передай оркестратору/пользователю (ссылка на репозиторий + имя коммита).
