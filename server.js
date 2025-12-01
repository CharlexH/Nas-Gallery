const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');
const sharp = require('sharp');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = 3000;

// ================= 配置区域 =================
const NAS_ROOT = process.env.NAS_PATH || '/Volumes/JAdv'; 
// ===========================================

const CACHE_DIR = path.join(__dirname, 'cache');
fs.ensureDirSync(CACHE_DIR);

app.use(express.static('public'));

function getSafePath(reqPath) {
    const safeReqPath = decodeURIComponent(reqPath || '');
    const targetPath = path.join(NAS_ROOT, safeReqPath);
    if (!targetPath.startsWith(NAS_ROOT)) throw new Error('Access Denied');
    return targetPath;
}

// API: 文件列表
app.get('/api/browse', async (req, res) => {
    try {
        const currentPath = req.query.path || '';
        const fullPath = getSafePath(currentPath);
        const items = await fs.readdir(fullPath, { withFileTypes: true });
        
        const result = items.map(item => {
            if (item.name.startsWith('.')) return null;
            const relPath = path.join(currentPath, item.name);
            let type = item.isDirectory() ? 'folder' : (mime.lookup(item.name) || 'unknown');
            return {
                name: item.name,
                path: relPath,
                isDir: item.isDirectory(),
                type: type
            };
        }).filter(Boolean).sort((a, b) => b.isDir - a.isDir);

        res.json({ items: result });
    } catch (err) {
        console.error('目录读取失败:', err.message);
        res.status(500).json({ error: '无法读取目录' });
    }
});

// API: 缩略图 (黑边完整版)
app.get('/api/thumb', async (req, res) => {
    try {
        const relPath = req.query.path;
        if (!relPath) return res.status(404).end();
        
        const fullPath = getSafePath(relPath);
        const hash = crypto.createHash('md5').update(fullPath).digest('hex');
        const cacheFile = path.join(CACHE_DIR, `${hash}.jpg`);

        // 1. 检查缓存
        if (await fs.pathExists(cacheFile)) {
            const stats = await fs.stat(cacheFile);
            if (stats.size > 0) {
                res.set('Content-Type', 'image/jpeg');
                return fs.createReadStream(cacheFile).pipe(res);
            }
        }

        const mimeType = mime.lookup(fullPath);

        // 2. 图片处理 (Sharp)
        if (mimeType && mimeType.startsWith('image/')) {
            const buffer = await sharp(fullPath)
                .rotate()
                .resize(300, 300, { 
                    fit: 'contain',    // 关键：包含模式，不裁剪
                    background: { r: 0, g: 0, b: 0, alpha: 1 } // 黑色背景
                })
                .jpeg({ quality: 70 })
                .toBuffer();
            
            await fs.writeFile(cacheFile, buffer);
            res.set('Content-Type', 'image/jpeg');
            res.send(buffer);
        } 
        // 3. 视频处理 (FFmpeg 滤镜)
        else if (mimeType && mimeType.startsWith('video/')) {
            console.log(`[生成中] 视频: ${path.basename(fullPath)}`);
            
            ffmpeg(fullPath)
                // 这一串复杂的命令就是在做：等比缩放 + 填充黑边
                .complexFilter([
                    'scale=300:300:force_original_aspect_ratio=decrease', // 缩放到一边为300，另一边按比例缩小
                    'pad=300:300:(ow-iw)/2:(oh-ih)/2:black'              // 在画布中心绘制，周围填黑
                ])
                .screenshots({
                    count: 1,
                    timestamps: ['00:00:01.000'],
                    filename: `${hash}.jpg`,
                    folder: CACHE_DIR
                })
                .on('end', () => {
                    console.log(`[完成] 视频: ${path.basename(fullPath)}`);
                    res.set('Content-Type', 'image/jpeg');
                    fs.createReadStream(cacheFile).pipe(res);
                })
                .on('error', (err) => {
                    console.error(`[失败] ${path.basename(fullPath)}:`, err.message);
                    res.status(500).end();
                });
        } else {
            res.status(404).end();
        }
    } catch (err) {
        console.error('API错误:', err);
        res.status(500).end();
    }
});

app.get('/api/raw', (req, res) => {
    try {
        const fullPath = getSafePath(req.query.path);
        res.sendFile(fullPath);
    } catch (err) {
        res.status(404).end();
    }
});

app.listen(PORT, () => {
    console.log(`服务已重启: http://localhost:${PORT}`);
});