// Browser APIs may perform an internal brand check on `this`.
// Keep fetch bound to the global scope instead of invoking window.fetch as
// a method of BospaApiClient, which can fail before any HTTP request is sent.
if (backend?.client && typeof globalThis.fetch === 'function') {
  backend.client.fetchImpl = globalThis.fetch.bind(globalThis);
}
