---
name: commit-and-push
description: Создание коммитов, работа с staging и пуш в удалённый репозиторий.
---

# Коммиты и пуш

## Просмотр изменений
```bash
git status                  # статус файлов
git diff                    # изменения без staging
git diff --staged           # изменения в staging
git log --oneline -10       # последние коммиты
```

## Добавление и коммит
```bash
# Добавить все изменённые файлы
git add .

# Добавить конкретный файл
git add путь/к/файлу

# Добавить все изменённые + удалить удалённые
git add -A

# Коммит с сообщением
git commit -m "feat: добавить авторизацию пользователей"
```

## Пуш в удалённый репозиторий
```bash
# Первый пуш с привязкой upstream
git push -u origin feature/название

# Обычный пуш
git push origin feature/название

# Пуш с rebase перед отправкой
git pull --rebase origin develop
git push origin feature/название
```

## Отмена последнего коммита
```bash
# Отменить коммит, оставить изменения в staging
git reset --soft HEAD~1

# Отменить коммит, оставить изменения в working tree
git reset --hard HEAD~1

# Изменить последний коммит
git commit --amend -m "новое сообщение"
```

**Правило:** Перед пушем в main/master обязательно спроси пользователя.