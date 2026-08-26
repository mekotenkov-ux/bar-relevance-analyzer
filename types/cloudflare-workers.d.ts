/**
 * The Cloudflare bindings used by this project. Keeping these declarations
 * scoped avoids replacing browser DOM globals with the Workers variants.
 */
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface D1Result<T = unknown> {
  success: true;
  results: T[];
  meta: Record<string, unknown>;
  error?: never;
}

interface D1ExecResult {
  count: number;
  duration: number;
}

type D1SessionConstraint = "first-primary" | "first-unconstrained";
type D1SessionBookmark = string;

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
}

interface D1DatabaseSession {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  getBookmark(): D1SessionBookmark | null;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
  withSession(
    constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint,
  ): D1DatabaseSession;
  dump(): Promise<ArrayBuffer>;
}

interface CloudflareRuntimeEnv {
  DB?: D1Database;
  [binding: string]: unknown;
}

declare module "cloudflare:workers" {
  export const env: CloudflareRuntimeEnv;
}
