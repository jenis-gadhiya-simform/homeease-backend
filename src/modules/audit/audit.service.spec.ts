import type { Prisma } from '../../generated/prisma/client.js';
import {
  type Actor,
  RequestContext,
} from '../../shared/context/request-context.js';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  const create = vi.fn();
  const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
  const service = new AuditService();
  const entry = {
    tenantId: 't1',
    action: 'tenant.updated',
    entityType: 'tenant',
    entityId: 'e1',
  };

  beforeEach(() => create.mockReset());

  const recordAs = (actor: Actor | undefined) =>
    RequestContext.run({ requestId: 'req-1', ip: '203.0.113.7', actor }, () =>
      service.record(tx, entry),
    );

  it.each([
    [
      { kind: 'staff', userId: 'u', role: 'PLATFORM_ADMIN', tenantId: null },
      'PLATFORM_ADMIN',
    ],
    [{ kind: 'staff', userId: 'u', role: 'OWNER', tenantId: 't1' }, 'USER'],
    [{ kind: 'customer', userId: 'c', role: null, tenantId: null }, 'CUSTOMER'],
    [undefined, 'SYSTEM'],
  ] as const)('maps actor %j to %s', async (actor, actorType) => {
    await recordAs(actor);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorType,
          actorId: actor?.userId ?? null,
          actorRole: actor?.role ?? null,
          requestId: 'req-1',
          ip: '203.0.113.7',
          action: 'tenant.updated',
        }),
      }),
    );
  });

  it('records SYSTEM outside any request', async () => {
    await service.record(tx, entry);
    expect(create.mock.calls[0][0].data).toMatchObject({
      actorType: 'SYSTEM',
      requestId: null,
    });
  });
});
