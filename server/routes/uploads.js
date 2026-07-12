const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const sharp   = require('sharp');
const logger  = require('../utils/logger');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_DIMENSION = 1600; // この長辺(px)を超える画像のみリサイズ・再圧縮する
const RESIZE_QUALITY = 80;

// アップロードディレクトリが存在しない場合は作成
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ファイル名衝突を解消する（beer.jpg → beer_1.jpg → beer_2.jpg ...）
function resolveFilename(dir, originalname) {
  const ext  = path.extname(originalname).toLowerCase();
  const base = path.basename(originalname, path.extname(originalname));
  // ファイル名を安全な文字列に正規化（スペースや特殊文字をアンダースコアに）
  const safeBase = base.replace(/[^a-zA-Z0-9\u3040-\u9FFF\uFF00-\uFFEF_-]/g, '_');
  let filename = `${safeBase}${ext}`;
  let counter  = 1;
  while (fs.existsSync(path.join(dir, filename))) {
    filename = `${safeBase}_${counter}${ext}`;
    counter++;
  }
  return filename;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const resolved = resolveFilename(UPLOAD_DIR, file.originalname);
    cb(null, resolved);
  },
});

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('image/') && ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('画像ファイル（JPEG・PNG・GIF・WebP等）のみアップロードできます'));
    }
  },
});

// 長辺がMAX_DIMENSIONを超える画像のみ、アスペクト比を保ったまま縮小し再圧縮する
// GIFはアニメーションが壊れるため対象外。処理に失敗してもアップロード自体は失敗させない（fail-open）
async function shrinkIfTooLarge(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gif') return;

  const image = sharp(filePath);
  const { width, height } = await image.metadata();
  if (!width || !height || Math.max(width, height) <= MAX_DIMENSION) return;

  let pipeline = image.rotate().resize({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    fit: 'inside',
    withoutEnlargement: true,
  });

  if (ext === '.jpg' || ext === '.jpeg') {
    pipeline = pipeline.jpeg({ quality: RESIZE_QUALITY, mozjpeg: true });
  } else if (ext === '.webp') {
    pipeline = pipeline.webp({ quality: RESIZE_QUALITY });
  } else if (ext === '.png') {
    pipeline = pipeline.png({ quality: RESIZE_QUALITY, compressionLevel: 9 });
  }

  const tmpPath = `${filePath}.tmp`;
  await pipeline.toFile(tmpPath);
  fs.renameSync(tmpPath, filePath);
}

const router = express.Router();

// POST /api/uploads/menu-images
router.post('/menu-images', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '画像ファイルが必要です' });
  try {
    await shrinkIfTooLarge(req.file.path);
  } catch (err) {
    logger.warn({ err }, 'image resize failed, keeping original upload');
  }
  res.json({ filename: req.file.filename });
});

// multerのバリデーションエラーを適切にハンドル
router.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'ファイルサイズは5MB以下にしてください' });
  }
  res.status(400).json({ error: err.message || 'アップロードエラー' });
});

module.exports = router;
