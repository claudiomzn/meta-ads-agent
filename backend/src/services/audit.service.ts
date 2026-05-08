import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function auditLog(params: {
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: unknown;
  ip?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      details: params.details ? JSON.stringify(params.details) : null,
      ip: params.ip,
    },
  });
}
