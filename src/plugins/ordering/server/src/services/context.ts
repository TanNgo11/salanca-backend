/**
 * Call context shared by every ordering service: who acts (`actor`), an optional request id
 * for tracing, and an optional clock override for tests. Services never read HTTP objects.
 */
export type ActorContext =
  | { kind: 'system'; actorRef?: string }
  | { kind: 'customer'; actorRef?: string }
  | { kind: 'staff'; adminUserId: number; isSuperAdmin: boolean; actorRef: string };

export type ServiceContext = {
  actor: ActorContext;
  requestId?: string;
  now?: Date;
};

export const nowOf = (ctx: ServiceContext): Date => ctx.now ?? new Date();

export const actorRefOf = (ctx: ServiceContext): string =>
  ctx.actor.actorRef ??
  (ctx.actor.kind === 'staff' ? `admin:${ctx.actor.adminUserId}` : ctx.actor.kind);
