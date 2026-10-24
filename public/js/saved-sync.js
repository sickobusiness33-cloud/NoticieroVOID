// VOID PRO: saved stories synced to the account. The server checks the subscription on every
// call (/api/pro/lists/saved returns 403 otherwise); free users keep browser-only saving.
import { api, store, persist } from './ui.js';
import { app } from './app.js';

const isPro = () => !!app.me?.pro?.pro;

// Merge the account list into this browser's list (union by URL, newest saves first).
export async function pullSaved() {
  if (!isPro()) return false;
  const remote = (await api('/api/pro/lists/saved')).items || [];
  const local = store('saved', []);
  const byUrl = new Map([...remote, ...local].map((x) => [x.url, x]));
  const merged = [...byUrl.values()].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))).slice(0, 300);
  persist('saved', merged);
  await api('/api/pro/lists/saved', { method: 'PUT', body: { items: merged } });
  return true;
}

export function pushSaved() {
  if (!isPro()) return;
  api('/api/pro/lists/saved', { method: 'PUT', body: { items: store('saved', []) } }).catch(() => {});
}
