import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { MediaService } from '../services/media.service.js';
import { storeUploadedMedia } from '../services/storage.service.js';
import rateLimit from 'express-rate-limit';

const router = Router();
router.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/mov'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato não suportado. Use JPG, PNG, WEBP, GIF, MP4 ou MOV.'));
    }
  },
});
const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req: AuthRequest) => req.userId ?? req.ip ?? 'unknown',
  message: { error: 'Limite de uploads atingido. Tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function matchesDeclaredType(buffer: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (mime === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mime.startsWith('video/')) return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  return false;
}

// POST /api/media/upload
router.post('/upload', uploadRateLimit, upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    return;
  }
  if (!matchesDeclaredType(req.file.buffer, req.file.mimetype)) {
    res.status(400).json({ error: 'O conteúdo do arquivo não corresponde ao formato informado.' });
    return;
  }

  const isVideo = req.file.mimetype.startsWith('video/');
  const durableUrl = await storeUploadedMedia(
    req.file.buffer,
    req.file.mimetype,
    req.file.originalname,
    req.userId!,
  );

  res.json({
    type: isVideo ? 'video' : 'image',
    url: durableUrl,
    localUrl: durableUrl,
    filename: path.basename(new URL(durableUrl).pathname),
    name: req.file.originalname,
  });
});

router.get('/file/:filename', (_req, res) => {
  res.status(410).json({ error: 'Mídia temporária expirada. Envie o arquivo novamente.' });
});

export default router;
