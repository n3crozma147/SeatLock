export const ErrorCode = Object.freeze({
  HOLD_REJECTED: 'HOLD_REJECTED',
  CONFIRM_REJECTED: 'CONFIRM_REJECTED',
  QUEUE_CONTENDED: 'QUEUE_CONTENDED',
});

export class SeatLockError extends Error {
  constructor(code, message, cause) {
    super(message ?? code);
    this.name = 'SeatLockError';
    this.code = code;
    this.cause = cause;
  }
}

/** Firebase reports a rules rejection as PERMISSION_DENIED (code or message, depending on SDK). */
export function isPermissionDenied(err) {
  const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
  return /permission[_ ]denied/i.test(text);
}
