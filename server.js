const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const sqlite3 = require('better-sqlite3');
const bcrypt = require('bcrypt');
const archiver = require('archiver');

const config = require('./config.json');

const log = (level, message, details = {}) => {
    const timestamp = new Date().toISOString();
    let userIdentifier = details.ip || 'SYSTEM';
    if (details.username && details.ip) {
        userIdentifier = `${details.ip} as ${details.username}`;
    } else if (details.username) {
        userIdentifier = details.username;
    }
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] [${userIdentifier}] ${message}`;
    if (level === 'error' && details.error) {
        console.error(logMessage, details.error);
    } else {
        console.log(logMessage);
    }
};

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
    created INTEGER NOT NULL
)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS download_files (
    token TEXT NOT NULL,
    path TEXT NOT NULL,
    PRIMARY KEY (token, path),
    FOREIGN KEY (token) REFERENCES downloads(token) ON DELETE CASCADE
)`).run();
db.pragma('foreign_keys = ON');

const getSecureRandomHex = (length) => {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
};

const expireOldSessions = () => {
    const now = Date.now();
    const expiryMs = config.server.inactive_session_expire_days * 24 * 60 * 60 * 1000;
    const stmt = db.prepare(`DELETE FROM sessions WHERE accessed < ?`);
    const changes = stmt.run(now - expiryMs).changes;
    if (changes > 0) {
        log('info', `Removed ${changes} unused sessions`);
    }
};

const expireOldDownloads = () => {
    const now = Date.now();
    const expiryMs = config.server.download_expire_days * 24 * 60 * 60 * 1000;
    const stmt = db.prepare(`DELETE FROM downloads WHERE created < ?`);
    const changes = stmt.run(now - expiryMs).changes;
    if (changes > 0) {
        log('info', `Removed ${changes} old download links`);
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
    const start = Date.now();
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown';
    req.ipaddr = ip;
    res.on('finish', () => {
        if (req.originalUrl.startsWith('/api')) {
            const duration = Date.now() - start;
            const username = req.username || (req.session ? req.session.username : undefined);
            const details = { ip };
            if (username) {
                details.username = username;
            }
            log('info', `[${duration}ms] ${req.method} ${res.statusCode} ${req.originalUrl}`, details);
        }
    });
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
            req.username = username;
            return res.json({ success: true, token });
        }
    }
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
        res.json({ success: true, path: req.pathRel });
    } catch (err) {
        log('error', `Failed to delete ${req.pathRel} from vault ${req.vault.name}`, { ip: req.ipaddr, username: req.username, error: err });
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
            res.json({ success: true, srcPath: pathFrom.rel, destPath: pathTo.rel });
        }
    } catch (error) {
        log('error', `Failed to ${action} file from ${pathFrom.rel} to ${pathTo.rel} in vault ${req.vault.name}`, { ip: req.ipaddr, username: req.username, error });
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
        res.json({ success: true, path: req.pathRel });
    } catch (err) {
        log('error', `Error creating folder at ${req.pathRel} in vault ${req.vault.name}`, { ip: req.ipaddr, username: req.username, error: err });
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
        // This log can be noisy, so let's not log every chunk. Or maybe keep it but as debug level if we had levels.
        // log('info', `Uploaded ${req.body.length} bytes to ${uploadToken}`, { ip: req.ipaddr, username: req.username });
        res.json({ success: true, size: uploadInfo.pendingSize });
    } catch (err) {
        log('error', `Error during file upload chunk for ${uploadToken}`, { ip: req.ipaddr, username: req.username, error: err });
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
        res.json({ success: true });
    } catch (err) {
        log('error', `Error finalizing file upload for ${uploadToken}`, { ip: req.ipaddr, username: req.username, error: err });
        return res.status(500).json({ success: false, message: 'Failed to finalize file upload' });
    }
});

app.post('/api/files/download/create', requireAuth, requireVaultAccess, async (req, res) => {
    const downloadToken = getSecureRandomHex(16);
    db.prepare(`INSERT INTO downloads (token, username, vault, created) VALUES (?, ?, ?, ?)`)
        .run(downloadToken, req.username, req.vault.name, Date.now());
    res.json({ success: true, token: downloadToken });
});

app.post('/api/files/download/add', requireAuth, requireVaultAccess, async (req, res) => {
    const token = req.query.token;
    const download = db.prepare(`SELECT * FROM downloads WHERE token = ?`).get(token);
    if (!download) {
        return res.status(404).json({ success: false, message: 'Invalid or expired download token' });
    }
    const paths = req.body.paths;
    if (!Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ success: false, message: 'No paths provided' });
    }
    const pathsClean = [];
    for (const pathRelDirty of paths) {
        const path = getCleanPaths(req.vault, pathRelDirty);
        if (!fs.existsSync(path.abs)) {
            return res.status(404).json({ success: false, message: `File not found in vault ${req.vault}: ${pathRelDirty}` });
        }
        pathsClean.push(path);
    }
    for (const path of pathsClean) {
        db.prepare(`INSERT OR IGNORE INTO download_files (token, path) VALUES (?, ?)`)
            .run(token, path.rel);
    }
    res.json({ success: true });
});

app.get('/api/files/download', async (req, res) => {
    const token = req.query.token;
    const download = db.prepare(`SELECT * FROM downloads WHERE token = ?`).get(token);
    if (!download) {
        return res.status(404).json({ success: false, message: 'Invalid or expired download token' });
    }
    const paths = db.prepare(`SELECT path FROM download_files WHERE token = ?`).all(token);
    if (paths.length === 0) {
        return res.status(404).json({ success: false, message: 'No files associated with this download' });
    }
    const vault = config.vaults.find(v => v.name === download.vault);
    if (!vault) {
        return res.status(404).json({ success: false, message: 'The vault this file belongs to no longer exists' });
    }
    let url = `/download/${download.token}`;
    if (paths.length === 1) {
        const pathRel = paths[0].path;
        const pathAbs = path.join(vault.path, pathRel);
        const stats = await fs.promises.stat(pathAbs).catch(() => { return null; });
        if (!stats) {
            return res.status(404).json({ success: false, message: 'The file this download link points to no longer exists' });
        }
        let name = path.basename(pathRel) || vault.name;
        if (stats.isDirectory()) {
            name = `${name}.zip`;
        }
        return res.json({
            success: true,
            url: url + '/' + name
        });
    } else {
        return res.json({
            success: true,
            url: url + '/files.zip',
        });
    }
});

app.get('/download/:token{/:filename}', async (req, res) => {
    const token = req.params.token;
    const download = db.prepare(`SELECT * FROM downloads WHERE token = ?`).get(token);
    if (!download) {
        return res.status(404).end('This download link has expired or invalid');
    }
    let paths = db.prepare(`SELECT path FROM download_files WHERE token = ?`).all(token).map(row => row.path);
    if (paths.length === 0) {
        return res.status(404).end('This download has no files associated with it');
    }
    const vault = config.vaults.find(v => v.name === download.vault);
    if (!vault) {
        return res.status(404).end('The vault this file belongs to no longer exists');
    }
    let filename = 'files';
    if (paths.length === 1) {
        const pathRel = paths[0];
        const pathAbs = path.join(vault.path, pathRel);
        const stats = await fs.promises.stat(pathAbs).catch(() => { return null; });
        if (!stats) {
            return res.status(404).json({ success: false, message: 'The file this download link points to no longer exists' });
        }
        filename = path.basename(pathRel);
        if (stats.isDirectory()) {
            paths = [];
            const files = await fs.promises.readdir(pathAbs).catch(() => []);
            for (const file of files) {
                paths.push(path.join(pathRel, file));
            }
        } else {
            return res.download(pathAbs, filename, { dotfiles: 'allow' });
        }
    }
    filename = `${filename || vault.name}.zip`;
    log('info', `Starting zip download for ${paths.length} items from vault ${vault.name}`, { ip: req.ipaddr, username: download.username });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const archive = archiver('zip');
    archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
            log('warn', `Archiver warning: ${err.message}`, { ip: req.ipaddr, username: download.username });
        } else {
            log('error', `Archiver error: ${err.message}`, { ip: req.ipaddr, username: download.username, error: err });
            res.status(500).send({ success: false, message: err.message });
        }
    });
    archive.on('error', (err) => {
        log('error', `Archiver error during zip creation: ${err.message}`, { ip: req.ipaddr, username: download.username, error: err });
        res.status(500).send({ success: false, message: err.message });
    });
    archive.on('finish', () => {
        log('info', `Finished zip download for token ${token}`, { ip: req.ipaddr, username: download.username });
    });
    req.on('close', () => {
        if (res.writableFinished) return;
        log('info', `Client disconnected, aborting zip download for token ${token}`, { ip: req.ipaddr, username: download.username });
        archive.abort();
    });
    archive.pipe(res);
    for (const pathRel of paths) {
        const pathAbs = path.join(vault.path, pathRel);
        if (!fs.existsSync(pathAbs)) {
            log('warn', `File not found during zip creation, skipping: ${pathAbs}`, { ip: req.ipaddr, username: download.username });
            continue;
        }
        const stats = await fs.promises.stat(pathAbs);
        if (stats.isDirectory()) {
            archive.directory(pathAbs, path.basename(pathRel));
        } else {
            archive.file(pathAbs, { name: path.basename(pathRel) });
        }
    }
    archive.finalize();
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(config.server.port, () => {
    log('info', `Server is running on port ${config.server.port}`);
});

process.on('uncaughtException', (err) => {
    log('error', 'Uncaught Exception:', { error: err });
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