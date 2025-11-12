export type AnyErr = unknown;

export function inspectErr(err: AnyErr) {
  const base: Record<string, any> = { type: typeof err };
  try { if (err && typeof err === 'object') base.keys = Object.keys(err as any); } catch {}
  try { base.message = (err as any)?.message; } catch {}
  try { base.code = (err as any)?.code; } catch {}
  try { base.hint = (err as any)?.hint; } catch {}
  try { base.details = (err as any)?.details; } catch {}
  try { base.stack = (err as any)?.stack; } catch {}
  try { base.json = JSON.stringify(err, (_k,v)=> (v instanceof Error ? {message:v.message,stack:v.stack} : v), 2); } catch { base.json = '<unserializable>'; }
  return base;
}

export function logErr(ctx: string, err: AnyErr) {
  const i = inspectErr(err);
  // Always print the full diagnostic once
  // eslint-disable-next-line no-console
  console.error(`[${ctx}]`, i);
  return i;
}

