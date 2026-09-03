---
name: python-review
description: Проверка Python-кода на соответствие PEP 8 и best practices
---

# Проверка Python-кода

При ревью Python-кода проверяй:
- PEP 8: отступы, пробелы, именование (snake_case для функций/переменных, CamelCase для классов)
- Типизация: type hints для функций
- Обработка ошибок: try/except с конкретными исключениями
- Resource management: with open() вместо open() + close()
- List comprehensions вместо циклов где уместно
- F-strings вместо .format() и %
- Docstrings для функций и классов
- Избегание mutable default arguments
- Итераторы и генераторы вместо создания полных списков
- Идиоматичный Python (pythonic code)