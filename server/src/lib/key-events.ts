/**
 * In-process notifications about stored keys.
 *
 * The desktop key harvester subscribes to `onKeyInvalid` so that a key the
 * health check rejects (401/403 from the provider's validation endpoint) can be
 * replaced by a freshly created one without the user opening the dashboard.
 *
 * Listeners run synchronously inside the health check, so they must return
 * quickly and must never throw back into it: every call is isolated.
 */

export interface KeyInvalidEvent {
  keyId: number;
  platform: string;
  label: string;
  reason: string | null;
  /** True when the key has just been auto-disabled after repeated failures. */
  autoDisabled: boolean;
}

type Listener = (event: KeyInvalidEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe to invalid-key verdicts. Returns an unsubscribe function. */
export function onKeyInvalid(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitKeyInvalid(event: KeyInvalidEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken subscriber must not break the health check.
    }
  }
}

/** Test seam. */
export function clearKeyInvalidListeners(): void {
  listeners.clear();
}
