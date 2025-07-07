const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const sqlite3 = require('better-sqlite3');
const bcrypt = require('bcrypt');

const config = require('./config.json');

const db = sqlite3(path.join(__dirname, 'state.db'));

db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created INTEGER NOT NULL,
    accessed INTEGER NOT NULL
)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS downloads (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    vault TEXT NOT NULL,
    path TEXT NOT NULL,
    created INTEGER NOT NULL
)`).run();

const getSecureRandomHex = (length) => {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
};

const expireOldSessions = () => {
    const now = Date.now();
    const expiryMs = config.server.inactive_session_expire_days * 24 * 60 * 60 * 1000;
    const stmt = db.prepare(`DELETE FROM sessions WHERE accessed < ?`);
    const changes = stmt.run(now - expiryMs).changes;
    if (changes > 0) {
        console.log(`Removed ${changes} unused sessions`);
    }
};

const expireOldDownloads = () => {
    const now = Date.now();
    const expiryMs = config.server.download_expire_days * 24 * 60 * 60 * 1000;
    const stmt = db.prepare(`DELETE FROM downloads WHERE created < ?`);
    const changes = stmt.run(now - expiryMs).changes;
    if (changes > 0) {
        console.log(`Removed ${changes} old download links`);
    }
};

expireOldSessions();
expireOldDownloads();
setInterval(() => {
    expireOldSessions();
    expireOldDownloads();
}, 60 * 1000);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.raw({ limit: '16mb', type: 'application/octet-stream' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown';
    req.ip = ip;
    next();
});

app.post('/api/auth/login', async (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Missing username and/or password' });
    }
    for (const user of config.users) {
        if (user.username === username && await bcrypt.compare(password, user.password_hash)) {
            const token = getSecureRandomHex(32);
            const now = Date.now();
            db.prepare(`INSERT INTO sessions (token, username, created, accessed) VALUES (?, ?, ?, ?)`)
                .run(token, username, now, now);
            console.log(`${req.ip} established a new session as ${username}`);
            return res.json({ success: true, token });
        }
    }
    console.log(`${req.ip} tried and failed to authenticate as ${username}`);
    res.status(401).json({ success: false, message: 'Invalid username or password' });
});

const requireAuth = (req, res, next) => {
    const token = (req.headers.authorization || '').split(' ')[1]; // Assuming Bearer token format
    const session = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
    if (session) {
        db.prepare(`UPDATE sessions SET accessed = ? WHERE token = ?`).run(Date.now(), token);
        req.token = token;
        req.session = session;
        req.username = session.username;
        return next();
    }
    res.status(401).json({ success: false, message: 'Unauthorized' });
};

app.post('/api/auth/logout', requireAuth, (req, res) => {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(req.token);
    res.json({ success: true });
});

app.get('/api/auth', requireAuth, (req, res) => {
    res.json({ success: true, session: req.session });
});

app.get('/api/vaults', requireAuth, (req, res) => {
    const vaults = [];
    for (const vault of config.vaults) {
        if (vault.users.includes(req.username)) {
            vaults.push({
                name: vault.name,
                users: vault.users
            });
        }
    }
    console.log(`${req.username} requested a list of their vaults`);
    res.json({ success: true, vaults });
});

const requireVaultAccess = (req, res, next) => {
    const vaultName = req.query.vault;
    const vault = config.vaults.find(v => v.name === vaultName);
    if (!vault) {
        return res.status(404).json({ success: false, message: 'Vault not found' });
    }
    if (vault.users.includes(req.username)) {
        req.vault = vault;
        return next();
    }
    res.status(403).json({ success: false, message: 'Forbidden' });
};

const getCleanPaths = (vault, pathDirty) => {
    const rel = path.normalize('/' + (pathDirty || ''));
    const abs = path.join(vault.path, rel);
    return { rel, abs };
};

const getRequestPaths = (req, res, next) => {
    const paths = getCleanPaths(req.vault, req.query.path);
    req.pathRel = paths.rel;
    req.pathAbs = paths.abs;
    return next();
};

app.get('/api/files/list', requireAuth, requireVaultAccess, getRequestPaths, async (req, res) => {
    if (!fs.existsSync(req.pathAbs)) {
        return res.status(404).json({ success: false, message: 'No file exists at the requested path' });
    }
    const stats = await fs.promises.stat(req.pathAbs).catch(() => { return {}; });
    if (!stats.isDirectory()) {
        return res.status(400).json({ success: false, message: 'The file at the requested path is not a directory' });
    }
    const fileNames = await fs.promises.readdir(req.pathAbs).catch(() => []);
    const files = [];
    for (const fileName of fileNames) {
        const filePathAbs = path.join(req.pathAbs, fileName);
        const filePathRel = path.join(req.pathRel, fileName);
        const stats = await fs.promises.stat(filePathAbs).catch(() => { return {}; });
        files.push({
            name: fileName,
            path: filePathRel,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            modified: stats.mtimeMs || Date.now()
        });
    }
    console.log(`${req.username} requested a file list in vault ${req.vault.name} at path ${req.pathRel}`);
    res.json({ success: true, path: req.pathRel, files });
});

app.post('/api/files/delete', requireAuth, requireVaultAccess, getRequestPaths, async (req, res) => {
    if (!fs.existsSync(req.pathAbs)) {
        return res.status(404).json({ success: false, message: 'No file exists at the requested path' });
    }
    try {
        const stats = await fs.promises.lstat(req.pathAbs);
        if (stats.isDirectory()) {
            // Remove directory and all contents
            await fs.promises.rm(req.pathAbs, { recursive: true, force: true });
        } else {
            await fs.promises.unlink(req.pathAbs);
        }
        console.log(`${req.username} deleted file ${req.pathAbs}`);
        res.json({ success: true, path: req.pathRel });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to delete file or directory' });
    }
});

const handleMoveCopy = async (req, res, action) => {
    let pathFrom, pathTo;
    if (req.query.path_src && req.query.path_dest) {
        pathFrom = getCleanPaths(req.vault, req.query.path_src);
        pathTo = getCleanPaths(req.vault, req.query.path_dest);
    } else {
        return res.status(400).json({ success: false, message: 'Missing path_src or path_dest' });
    }

    if (!fs.existsSync(pathFrom.abs)) {
        return res.status(404).json({ success: false, message: 'Source file does not exist' });
    }
    if (fs.existsSync(pathTo.abs)) {
        return res.status(400).json({ success: false, message: 'Destination file already exists' });
    }
    if (pathFrom.rel === pathTo.rel) {
        return res.status(400).json({ success: false, message: 'Source and destination paths are the same' });
    }
    if (pathFrom.rel === '/' || pathTo.rel === '/') {
        return res.status(400).json({ success: false, message: 'The root directory itself cannot be modified' });
    }

    try {
        if (action === 'move') {
            await fs.promises.rename(pathFrom.abs, pathTo.abs);
            console.log(`${req.username} moved file from ${pathFrom.abs} to ${pathTo.abs}`);
            res.json({ success: true, oldPath: pathFrom.rel, newPath: pathTo.rel });
        } else if (action === 'copy') {
            const copyRecursive = async (src, dest) => {
                const stats = await fs.promises.stat(src);
                if (stats.isDirectory()) {
                    await fs.promises.mkdir(dest, { recursive: true });
                    const entries = await fs.promises.readdir(src);
                    for (const entry of entries) {
                        await copyRecursive(
                            path.join(src, entry),
                            path.join(dest, entry)
                        );
                    }
                } else {
                    await fs.promises.copyFile(src, dest);
                }
            };
            await copyRecursive(pathFrom.abs, pathTo.abs);
            console.log(`${req.username} copied from ${pathFrom.abs} to ${pathTo.abs}`);
            res.json({ success: true, srcPath: pathFrom.rel, destPath: pathTo.rel });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: `Failed to ${action} file: ${error}` });
    }
};

app.post('/api/files/move', requireAuth, requireVaultAccess, async (req, res) => {
    await handleMoveCopy(req, res, 'move');
});

app.post('/api/files/copy', requireAuth, requireVaultAccess, async (req, res) => {
    await handleMoveCopy(req, res, 'copy');
});

app.post('/api/files/folder/create', requireAuth, requireVaultAccess, getRequestPaths, async (req, res) => {
    if (fs.existsSync(req.pathAbs)) {
        return res.status(400).json({ success: false, message: 'A file or folder already exists at the requested path' });
    }
    try {
        await fs.promises.mkdir(req.pathAbs, { recursive: true });
        console.log(`${req.username} created a folder at ${req.pathAbs}`);
        res.json({ success: true, path: req.pathRel });
    } catch (err) {
        console.error('Error creating folder:', err);
        res.status(500).json({ success: false, message: 'Failed to create folder' });
    }
});

const uploads = {};

app.post('/api/files/upload/initialize', requireAuth, requireVaultAccess, getRequestPaths, async (req, res) => {
    if (fs.existsSync(req.pathAbs)) {
        return res.status(400).json({ success: false, message: 'A file already exists at the requested path' });
    }
    const uploadToken = getSecureRandomHex(16);
    uploads[uploadToken] = {
        pathTemp: path.join(config.server.pending_uploads_dir, uploadToken),
        pathDest: req.pathAbs,
        pendingSize: 0
    };
    console.log(`${req.username} initiated an upload (${uploadToken}) with destination ${req.pathAbs}`);
    res.json({ success: true, token: uploadToken });
});

app.post('/api/files/upload/append', requireAuth, async (req, res) => {
    const uploadToken = req.query.token;
    if (!uploads[uploadToken]) {
        return res.status(404).json({ success: false, message: 'Invalid or expired upload token' });
    }
    const uploadInfo = uploads[uploadToken];
    if (!req.is('application/octet-stream')) {
        return res.status(400).json({ success: false, message: 'Invalid content type, expected application/octet-stream' });
    }
    if (req.body.length === 0) {
        return res.status(400).json({ success: false, message: 'No data provided in the request body' });
    }
    if (uploadInfo.pendingSize + req.body.length > config.server.max_upload_size_gb * 1024 * 1024 * 1024) {
        return res.status(413).json({ success: false, message: 'Upload exceeds maximum size limit' });
    }
    try {
        await fs.promises.mkdir(path.dirname(uploadInfo.pathTemp), { recursive: true });
        await fs.promises.appendFile(uploadInfo.pathTemp, req.body);
        uploadInfo.pendingSize += req.body.length;
        console.log(`${req.username} uploaded ${req.body.length} bytes to ${uploadToken}`);
        res.json({ success: true, size: uploadInfo.pendingSize });
    } catch (err) {
        console.error('Error during file upload:', err);
        return res.status(500).json({ success: false, message: 'Failed to upload file' });
    }
});

app.post('/api/files/upload/finalize', requireAuth, async (req, res) => {
    const uploadToken = req.body.token;
    if (!uploads[uploadToken]) {
        return res.status(404).json({ success: false, message: 'Invalid or expired upload token' });
    }
    const uploadInfo = uploads[uploadToken];
    if (uploadInfo.pendingSize === 0) {
        return res.status(400).json({ success: false, message: 'No data uploaded for this token' });
    }
    try {
        await fs.promises.rename(uploadInfo.pathTemp, uploadInfo.pathDest);
        delete uploads[uploadToken];
        console.log(`${req.username} finalized upload (${uploadToken}) to ${uploadInfo.pathDest}`);
        res.json({ success: true });
    } catch (err) {
        console.error('Error finalizing file upload:', err);
        return res.status(500).json({ success: false, message: 'Failed to finalize file upload' });
    }
});

app.post('/api/files/download', requireAuth, requireVaultAccess, getRequestPaths, async (req, res) => {
    if (!fs.existsSync(req.pathAbs)) {
        return res.status(404).json({ success: false, message: 'No file exists at the requested path' });
    }
    const stats = await fs.promises.stat(req.pathAbs).catch(() => { return {}; });
    if (!stats.isFile()) {
        return res.status(400).json({ success: false, message: 'The file at the requested path is not a file' });
    }
    const downloadToken = getSecureRandomHex(16);
    const now = Date.now();
    db.prepare(`INSERT INTO downloads (token, username, vault, path, created) VALUES (?, ?, ?, ?, ?)`)
        .run(downloadToken, req.username, req.vault.name, req.pathRel, now);
    console.log(`${req.username} created a download link (${downloadToken}) for file ${req.pathRel} in vault ${req.vault.name}`);
    res.json({ success: true, token: downloadToken });
});

app.get('/download/:token{/:filename}', (req, res) => {
    const token = req.params.token;
    const download = db.prepare(`SELECT * FROM downloads WHERE token = ?`).get(token);
    if (!download) {
        return res.status(404).end('This download link has expired or invalid');
    }
    const vault = config.vaults.find(v => v.name === download.vault);
    if (!vault) {
        return res.status(404).end('The vault this file belongs to no longer exists');
    }
    const filePathAbs = path.join(vault.path, download.path);
    if (!fs.existsSync(filePathAbs)) {
        return res.status(404).end('The file this download link points to no longer exists');
    }
    console.log(`${req.ip} requested download link ${token} for file ${download.path} in vault ${vault.name}`);
    res.download(filePathAbs);
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(config.server.port, () => {
    console.log(`Server is running on port ${config.server.port}`);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    db.close();
    process.exit(1);
});

process.on('SIGINT', () => {
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
});

process.on('exit', () => {
    db.close();
});