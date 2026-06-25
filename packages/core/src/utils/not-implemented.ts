/**
 * Throws a consistent "not implemented" error for scaffolded methods.
 * Centralizing this also gives stub methods a legitimate reason to
 * reference `this.config`/`this.options` (debugging context), which
 * keeps `noUnusedLocals` happy without resorting to eslint-disable
 * comments scattered through the scaffold.
 */
export function notImplemented(driverName: string, method: string): never {
  throw new Error(`${driverName}.${method}() is not implemented yet`);
}
