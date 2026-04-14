const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

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

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('画像ファイル（JPEG・PNG・GIF・WebP等）のみアップロードできます'));
    }
  },
});

const router = express.Router();

// POST /api/uploads/menu-images
router.post('/menu-images', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '画像ファイルが必要です' });
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
