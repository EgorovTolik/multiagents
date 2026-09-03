---
name: merge-operations
description: Выполнение мержей веток, управление стратегиями мержа и слияние веток.
---

# Мерж-операции

## Мерж feature в develop
```bash
git checkout develop
git pull origin develop
git merge --no-ff feature/название -m "merge feature/название"
git push origin develop
```

## Мерж release в main и develop
```bash
# В main
git checkout main
git pull origin main
git merge --no-ff release/v1.2.0 -m "release: v1.2.0"
git tag v1.2.0
git push origin main --tags

# В develop
git checkout develop
git merge --no-ff release/v1.2.0 -m "merge release/v1.2.0 into develop"
git push origin develop
```

## Мерж hotfix в main и develop
```bash
# В main
git checkout main
git pull origin main
git merge --no-ff hotfix/описание -m "hotfix: описание"
git tag v1.2.1
git push origin main --tags

# В develop
git checkout develop
git merge --no-ff hotfix/описание -m "merge hotfix/описание into develop"
git push origin develop
```

## Стратегии мержа
- `--no-ff` — создаёт мерж-коммит, сохраняет историю ветки
- `--ff` — fast-forward, если нет расхождений
- `--squash` — сжимает все коммиты ветки в один

## После мержа — очистка
```bash
git branch -d feature/название
git push origin --delete feature/название
```

**Правило:** Перед мержом покажи историю обеих веток и спроси подтверждение.