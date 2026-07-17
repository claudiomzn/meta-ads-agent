import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { MediaService } from '../services/media.service.js';

const router = Router();
router.use(authMiddleware);

// Pasta de uploads temporários
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/mov'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato não suportado. Use JPG, PNG, WEBP, GIF, MP4 ou MOV.'));
    }
  },
});

// POST /api/media/upload
router.post('/upload', upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    return;
  }

  const isVideo = req.file.mimetype.startsWith('video/');
  const localUrl = `/api/media/file/${req.file.filename}`;

  // Salva localmente para preview — o upload para o Meta acontece ao publicar a campanha
  res.json({
    type: isVideo ? 'video' : 'image',
    url: localUrl,
    localUrl,
    filename: req.file.filename,
    name: req.file.originalname,
  });
});

// GET /api/media/file/:filename — serve o arquivo localmente
router.get('/file/:filename', (req, res) => {
  // path.basename() descarta qualquer componente de diretório (ex: "../../etc/passwd"
  // vira só "passwd"), e a checagem de path.resolve() garante que o resultado
  // final continua dentro de UPLOAD_DIR mesmo em cenários mais exóticos — sem
  // isso, um filename como "../../.env" escaparia da pasta de uploads.
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.resolve(UPLOAD_DIR, safeFilename);
  const resolvedUploadDir = path.resolve(UPLOAD_DIR);

  if (filePath !== resolvedUploadDir && !filePath.startsWith(resolvedUploadDir + path.sep)) {
    res.status(400).json({ error: 'Nome de arquivo inválido.' });
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Arquivo não encontrado.' });
    return;
  }
  res.sendFile(filePath);
});

export default router;
