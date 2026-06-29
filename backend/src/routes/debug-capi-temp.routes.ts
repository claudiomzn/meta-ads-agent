// TEMPORARIO — so para validar o CAPI contra a API real do Meta. Apagar depois do teste.
import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { CapiService } from '../services/capi.service.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const email = String(req.query.email ?? '');
    const testEventCode = req.query.testEventCode ? String(req.query.testEventCode) : undefined;
    const phone = req.query.phone ? String(req.query.phone) : '5592999990000';
    if (!email) return res.status(400).json({ error: 'email obrigatorio' });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, email: true } });
    if (!user) return res.status(404).json({ error: 'usuario nao encontrado', email });

    const conn = await prisma.mCPConnection.findUnique({ where: { userId: user.id } });

    const svc = new CapiService(user.id);
    const status = await svc.getStatus();

    let sendResult = null;
    if (req.query.send === '1') {
      sendResult = await svc.sendLead({ phone, eventId: `debugtest_${Date.now()}`, testEventCode });
    }

    res.json({
      userId: user.id,
      email: user.email,
      mcpConnected: Boolean(conn),
      mcpProvider: conn?.mcpProvider ?? null,
      adAccountIds: conn?.adAccountIds ?? null,
      mcpUrl: conn?.mcpUrl ?? null,
      pixelIdSaved: conn?.metaPixelId ?? null,
      status,
      sendResult,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
