import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import type { ServiceContext } from './context';
import type changeLogFactory from './change-log';

/**
 * Branch administration. `code` is the stable external ref (orders pin it via locationRef),
 * so it is immutable once the branch exists — the same rule is enforced for the Document
 * Service path by a middleware in register.ts (db.query bypass is documented in the README).
 * Every write appends an admin-change-log row.
 */
const branch = ({ strapi }: { strapi: Core.Strapi }) => {
  const branches = () => strapi.db.query('plugin::ordering.branch');
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  return {
    async findByCode(code: string) {
      return branches().findOne({ where: { code } });
    },

    async list() {
      return branches().findMany({ orderBy: { rank: 'asc' } });
    },

    async create(
      data: Record<string, unknown>,
      ctx: ServiceContext,
    ): Promise<Record<string, unknown>> {
      const row = await branches().create({ data });
      await changeLog().record(
        {
          action: 'branch.create',
          entityType: 'branch',
          entityId: row.id as number,
          locationRef: (data.code as string) ?? undefined,
          after: data,
        },
        ctx,
      );
      return row;
    },

    async update(
      id: number,
      data: Record<string, unknown>,
      ctx: ServiceContext,
    ): Promise<Record<string, unknown>> {
      const current = (await branches().findOne({ where: { id } })) as {
        id: number;
        code: string;
      } | null;
      if (!current) {
        throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found', { details: { id } });
      }
      if (data.code !== undefined && data.code !== current.code) {
        throw new OrderingError('BRANCH_CODE_IMMUTABLE', 'branch code is immutable', {
          details: { id },
        });
      }
      const row = await branches().update({ where: { id }, data });
      await changeLog().record(
        {
          action: 'branch.update',
          entityType: 'branch',
          entityId: id,
          locationRef: current.code,
          before: current as unknown as Record<string, unknown>,
          after: row as unknown as Record<string, unknown>,
        },
        ctx,
      );
      return row;
    },
  };
};

export default branch;
