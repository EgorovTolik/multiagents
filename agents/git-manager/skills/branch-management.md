---
name: branch-management
description: Создание, переключение, удаление и управление git-ветками в соответствии с Git-Flow.
---

# Управление ветками

## Создание веток

### Feature-ветка (от develop)
```bash
git checkout develop
git pull origin develop
git checkout -b feature/название-задачи
```

### Release-ветка (от develop)
```bash
git checkout develop
git pull origin develop
git checkout -b release/v1.2.0
```

### Hotfix-ветка (от main)
```bash
git checkout main
git pull origin main
git checkout -b hotfix/описание-проблемы
```

## Переключение между ветками
```bash
git checkout develop        # переключиться на develop
git switch feature/auth     # альтернативный синтаксис
```

## Обновление ветки (rebase на develop)
```bash
git checkout feature/название
git fetch origin
git rebase origin/develop
```

## Удаление веток
```bash
# Локально (soft, только если смержена)
git branch -d feature/название

# Локально (force)
git branch -D feature/название

# Удалённо
git push origin --delete feature/название
```

**Правило:** Перед удалением убедись, что ветка смержена в целевую ветку. Спроси пользователя перед удалением.