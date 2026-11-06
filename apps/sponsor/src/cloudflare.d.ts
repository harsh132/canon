// Just enough of the Workers runtime types for worker.ts to typecheck under Bun's types.
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: unknown;
    protected env: Env;
    constructor(ctx: unknown, env: Env);
  }
}
type DurableObjectNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
};
