// ─── Типизированные ошибки системы Multiagents ──────────────────────────────

/** Базовый интерфейс для всех ошибок системы. */
export interface ErrorObject {
  code: string;        // Код ошибки (например "NOT_FOUND", "TIMEOUT")
  message: string;     // Человеческое описание
  details?: any;       // Дополнительные детали
}

/** Фабрика создания типизированных ошибок. */
export function createError(code: string, message: string, details?: any): ErrorObject {
  return { code, message, details };
}

// ─── Предопределённые коды ошибок ──────────────────────────────────────────

/** Ошибка не найдено (агент, контекст, файл и т.д.). */
export function notFoundError(message: string, details?: any): ErrorObject {
  return createError("NOT_FOUND", message, details);
}

/** Временное превышение лимита ожидания. */
export function timeoutError(message: string, details?: any): ErrorObject {
  return createError("TIMEOUT", message, details);
}

/** Конфликт состояний (например, ресурс занят). */
export function conflictError(message: string, details?: any): ErrorObject {
  return createError("CONFLICT", message, details);
}

/** Внутренняя ошибка сервера (непредвиденное исключение). */
export function internalError(message: string, details?: any): ErrorObject {
  return createError("INTERNAL_ERROR", message, details);
}

/** Неверный запрос от клиента (validation error). */
export function validationError(message: string, details?: any): ErrorObject {
  return createError("VALIDATION_ERROR", message, details);
}

/** Сеть недоступна или провайдер не отвечает. */
export function networkError(message: string, details?: any): ErrorObject {
  return createError("NETWORK_ERROR", message, details);
}

/** Агент завис (нет событий от сессии). */
export function agentStalledError(agentId: string, timeoutMs: number): ErrorObject {
  return createError(
    "AGENT_STALLED",
    `Агент ${agentId} завис — ход прерван watchdog'ом. Отправьте сообщение ещё раз.`,
    { agentId, timeoutMs }
  );
}

/** Ошибка выполнения агента (run error). */
export function agentRunError(agentId: string, message: string, details?: any): ErrorObject {
  return createError(
    "AGENT_RUN_ERROR",
    `Ошибка выполнения агента ${agentId}: ${message}`,
    { agentId, ...details }
  );
}

/** Цепочка передачи прервалась. */
export function chainBrokenError(agentId: string, recoveryCount: number): ErrorObject {
  return createError(
    "CHAIN_BROKEN",
    `Цепочка прервалась для агента ${agentId} (${recoveryCount} попыток восстановления)`,
    { agentId, recoveryCount }
  );
}

/** Невозможно преобразовать произвольное значение в ErrorObject. */
export function toErrorObject(e: unknown): ErrorObject {
  if (e && typeof e === "object" && "code" in e) {
    return e as ErrorObject;
  }
  const message = typeof e === "string" ? e : (e && typeof e === "object" && "message" in e ? String(e.message) : "Неизвестная ошибка");
  return internalError(message, { original: e });
}
