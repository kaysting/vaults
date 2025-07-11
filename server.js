const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const sqlite3 = require('better-sqlite3');
const bcrypt = require('bcrypt');
const archiver = require('archiver');
const diskusage = require('diskusage');

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
db.prepare(`CREATE TABLE IF NOT EXISTS uploads (
    token TEXT NOT NULL,
    username TEXT NOT NULL,
    vault TEXT NOT NULL,
    path_temp TEXT NOT NULL,
    path_dest TEXT NOT NULL,
    size INTEGER NOT NULL
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

const getVaultDiskStats = async (vault) => {
    try {
        const { free, total } = await diskusage.check(vault.path);
        return {
            storage_bytes_total: total,
            storage_bytes_available: free,
            storage_bytes_used: total - free
        };
    } catch {
        return {
            storage_bytes_total: 0,
            storage_bytes_available: 0,
            storage_bytes_used: 0
        };
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
    res.sendError = (status, code, message) => {
        res.status(status).json({ success: false, code, message });
    };
    next();
});

app.post('/api/auth/login', async (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    if (!username || !password) {
        return res.sendError(400, 'missing_credentials', 'A username and password are required');
    }
    const usernameLower = username.toLowerCase();
    for (const user of config.users) {
        if (user.username.toLowerCase() === usernameLower && await bcrypt.compare(password, user.password_hash)) {
            const token = getSecureRandomHex(32);
            const now = Date.now();
            db.prepare(`INSERT INTO sessions (token, username, created, accessed) VALUES (?, ?, ?, ?)`)
                .run(token, usernameLower, now, now);
            req.username = usernameLower;
            return res.json({ success: true, token });
        }
    }
    res.sendError(401, 'invalid_credentials', 'Invalid username or password');
});

const requireAuth = (req, res, next) => {
    const token = (req.headers.authorization || '').split(' ')[1]; // Assuming Bearer token format
    const session = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
    if (session) {
        db.prepare(`UPDATE sessions SET accessed = ? WHERE token = ?`).run(Date.now(), token);
        req.token = token;
        req.session = session;
        req.username = session.username.toLowerCase();
        return next();
    }
    res.sendError(401, 'unauthorized', 'Missing or invalid authentication token');
};

app.post('/api/auth/logout', requireAuth, (req, res) => {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(req.token);
    res.json({ success: true });
});

app.get('/api/auth', requireAuth, (req, res) => {
    res.json({ success: true, session: req.session });
});

app.get('/api/vaults', requireAuth, async (req, res) => {
    const vaults = [];
    for (const vault of config.vaults) {
        // Compare usernames case-insensitively
        if (vault.users.map(u => u.toLowerCase()).includes(req.username)) {
            const stats = await getVaultDiskStats(vault);
            vaults.push({
                name: vault.name,
                users: vault.users,
                ...stats
            });
        }
    }
    res.json({ success: true, vaults });
});

const requireVaultAccess = (req, res, next) => {
    const vaultName = req.query.vault;
    const vault = config.vaults.find(v => v.name === vaultName);
    if (!vault) {
        return res.sendError(404, 'vault_not_found', 'The requested vault does not exist');
    }
    if (vault.users.map(u => u.toLowerCase()).includes(req.username)) {
        req.vault = vault;
        return next();
    }
    res.sendError(403, 'forbidden', 'You do not have access to this vault');
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
        return res.sendError(404, 'not_found', 'No file exists at the requested path');
    }
    const stats = await fs.promises.stat(req.pathAbs).catch(() => { return {}; });
    if (!stats.isDirectory()) {
        return res.sendError(400, 'not_directory', 'The file at the requested path is not a directory');
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
        return res.sendError(404, 'not_found', 'No file exists at the requested path');
    }
    if (!req.pathRel || req.pathRel === '/') {
        return res.sendError(400, 'root_delete', 'The root directory itself cannot be deleted');
    }
    try {
        const stats = await fs.promises.lstat(req.pathAbs);
        if (stats.isDirectory()) {
            await fs.promises.rm(req.pathAbs, { recursive: true, force: true });
        } else {
            await fs.promises.unlink(req.pathAbs);
        }
        res.json({ success: true, path: req.pathRel });
    } catch (err) {
        log('error', `Failed to delete ${req.pathRel} from vault ${req.vault.name}`, { ip: req.ipaddr, username: req.username, error: err });
        res.sendError(500, 'delete_failed', 'Failed to delete file or directory');
    }
});

const removeIfExists = async (absPath) => {
    if (fs.existsSync(absPath)) {
        const stats = await fs.promises.lstat(absPath);
        if (stats.isDirectory()) {
            await fs.promises.rm(absPath, { recursive: true, force: true });
        } else {
            await fs.promises.unlink(absPath);
        }
    }
};

const handleMoveCopy = async (req, res, action) => {
    let pathFrom, pathTo;
    if (req.query.path_src && req.query.path_dest) {
        pathFrom = getCleanPaths(req.vault, req.query.path_src);
        pathTo = getCleanPaths(req.vault, req.query.path_dest);
    } else {
        return res.sendError(400, 'missing_path', 'Missing path_src or path_dest');
    }

    // Support overwrite query param
    const overwrite = req.query.overwrite === 'true';

    if (!fs.existsSync(pathFrom.abs)) {
        return res.sendError(404, 'src_not_found', 'Source file does not exist');
    }
    if (fs.existsSync(pathTo.abs)) {
        const destStats = await fs.promises.lstat(pathTo.abs);
        if (destStats.isDirectory()) {
            // Don't allow overwriting a directory
            return res.sendError(400, 'dest_is_directory', 'Cannot overwrite a directory');
        }
        if (!overwrite) {
            return res.sendError(400, 'dest_exists', 'Destination file already exists');
        }
    }
    if (pathFrom.rel === pathTo.rel) {
        return res.sendError(400, 'same_path', 'Source and destination paths are the same');
    }
    if (pathFrom.rel === '/' || pathTo.rel === '/') {
        return res.sendError(400, 'root_modify', 'The root directory itself cannot be modified');
    }

    try {
        if (fs.existsSync(pathTo.abs) && overwrite) {
            await removeIfExists(pathTo.abs);
        }
        if (action === 'move') {
            await fs.promises.rename(pathFrom.abs, pathTo.abs);
            res.json({ success: true, oldPath: pathFrom.rel, newPath: pathTo.rel, overwrite });
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
            res.json({ success: true, srcPath: pathFrom.rel, destPath: pathTo.rel, overwrite });
        }
    } catch (error) {
        log('error', `Failed to ${action} file from ${pathFrom.rel} to ${pathTo.rel} in vault ${req.vault.name}`, { ip: req.ipaddr, username: req.username, error });
        res.sendError(500, `${action}_failed`, `Failed to ${action} file: ${error}`);
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
        return res.sendError(400, 'exists', 'A file or folder already exists at the requested path');
    }
    try {
        await fs.promises.mkdir(req.pathAbs, { recursive: true });
        res.json({ success: true, path: req.pathRel });
    } catch (err) {
        log('error', `Error creating folder at ${req.pathRel} in vault ${req.vault.name}`, { ip: req.ipaddr, username: req.username, error: err });
        res.sendError(500, 'mkdir_failed', 'Failed to create folder');
    }
});

app.post('/api/files/upload/create', requireAuth, requireVaultAccess, getRequestPaths, async (req, res) => {
    // Support overwrite query param
    const overwrite = req.query.overwrite === 'true';
    if (fs.existsSync(req.pathAbs)) {
        const destStats = await fs.promises.lstat(req.pathAbs);
        if (destStats.isDirectory()) {
            // Don't allow overwriting a directory
            return res.sendError(400, 'dest_is_directory', 'Cannot overwrite a directory');
        }
        if (!overwrite) {
            return res.sendError(400, 'exists', 'A file already exists at the requested path');
        }
    }
    // Require size parameter
    const size = req.query.size === 'number' ? req.query.size : Number(req.query.size);
    if (!size || isNaN(size) || size <= 0) {
        return res.sendError(400, 'invalid_size', 'A valid file size (in bytes) is required');
    }
    // Check available space in vault
    const stats = await getVaultDiskStats(req.vault);
    if (stats.storage_bytes_available < size) {
        return res.sendError(400, 'insufficient_space', 'Not enough space in the vault for this upload');
    }
    const uploadToken = getSecureRandomHex(32);
    const tempFilePath = `${req.pathAbs}.${uploadToken}`;
    db.prepare(`INSERT INTO uploads (token, username, vault, path_temp, path_dest, size) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(uploadToken, req.username, req.vault.name, tempFilePath, req.pathAbs, size);
    res.json({ success: true, token: uploadToken, overwrite });
});

app.post('/api/files/upload', requireAuth, requireVaultAccess, async (req, res) => {
    const token = req.query.token;
    if (!token) {
        return res.sendError(400, 'missing_token', 'Missing upload token');
    }
    const upload = db.prepare(`SELECT * FROM uploads WHERE token = ?`).get(token);
    if (!upload) {
        return res.sendError(404, 'invalid_token', 'Invalid or expired upload token');
    }
    if (!req.is('application/octet-stream')) {
        return res.sendError(400, 'invalid_content_type', 'Invalid content type, expected application/octet-stream');
    }
    if (!req.body || req.body.length === 0) {
        return res.sendError(400, 'no_data', 'No data provided in the request body');
    }
    // Require offset query parameter
    const offset = req.query.offset;
    if (offset === undefined || isNaN(Number(offset)) || Number(offset) < 0) {
        return res.sendError(400, 'invalid_offset', 'Missing or invalid offset query parameter');
    }
    const offsetNum = Number(offset);
    const tempFilePath = upload.path_temp;
    try {
        await fs.promises.mkdir(path.dirname(tempFilePath), { recursive: true });
        // Open file for reading and writing, create if not exists
        const fd = await fs.promises.open(tempFilePath, 'r+').catch(async err => {
            if (err.code === 'ENOENT') {
                // If file doesn't exist, create it
                return await fs.promises.open(tempFilePath, 'w+');
            }
            throw err;
        });
        try {
            await fd.write(req.body, 0, req.body.length, offsetNum);
        } finally {
            await fd.close();
        }
        res.json({ success: true });
    } catch (err) {
        log('error', `Error during file upload chunk for ${token}`, { ip: req.ipaddr, username: req.username, error: err });
        // Cancel upload on error
        await fs.promises.unlink(tempFilePath).catch(() => { });
        db.prepare(`DELETE FROM uploads WHERE token = ?`).run(token);
        return res.sendError(500, 'upload_failed', 'Failed to upload file chunk. Upload canceled.');
    }
});

app.post('/api/files/upload/finalize', requireAuth, requireVaultAccess, async (req, res) => {
    const token = req.query.token;
    // Support overwrite query param
    const overwrite = req.query.overwrite === 'true';
    const upload = db.prepare(`SELECT * FROM uploads WHERE token = ?`).get(token);
    if (!upload) {
        return res.sendError(404, 'invalid_token', 'Invalid or expired upload token');
    }
    const tempFilePath = upload.path_temp;
    if (!fs.existsSync(tempFilePath)) {
        return res.sendError(400, 'no_data', 'No data has been uploaded');
    }
    // Check file size matches expected size
    const stat = await fs.promises.stat(tempFilePath).catch(() => null);
    if (!stat || stat.size !== upload.size) {
        return res.sendError(400, 'incomplete_upload', 'Uploaded file is incomplete or missing chunks');
    }
    if (fs.existsSync(upload.path_dest)) {
        const destStats = await fs.promises.lstat(upload.path_dest);
        if (destStats.isDirectory()) {
            // Don't allow overwriting a directory
            return res.sendError(400, 'dest_is_directory', 'Cannot overwrite a directory');
        }
        if (!overwrite) {
            return res.sendError(400, 'exists', 'A file already exists at the destination path');
        }
    }
    try {
        // No quota check (already checked at creation)
        await fs.promises.mkdir(path.dirname(upload.path_dest), { recursive: true });
        // If overwriting, remove the existing file first
        if (overwrite && fs.existsSync(upload.path_dest)) {
            await fs.promises.unlink(upload.path_dest);
        }
        await fs.promises.rename(tempFilePath, upload.path_dest);
        db.prepare(`DELETE FROM uploads WHERE token = ?`).run(token);
        const paths = getCleanPaths(req.vault, upload.path_dest.replace(req.vault.path, ''));
        res.json({ success: true, path: paths.rel, overwrite });
    } catch (err) {
        log('error', `Error finalizing file upload for ${token}`, { ip: req.ipaddr, username: req.username, error: err });
        // Cancel upload on error
        await fs.promises.unlink(tempFilePath).catch(() => { });
        db.prepare(`DELETE FROM uploads WHERE token = ?`).run(token);
        return res.sendError(500, 'finalize_failed', 'Failed to finalize file upload. Upload canceled.');
    }
});

app.post('/api/files/upload/cancel', requireAuth, async (req, res) => {
    const token = req.query.token;
    if (!token) {
        return res.sendError(400, 'missing_token', 'Missing upload token');
    }
    const upload = db.prepare(`SELECT * FROM uploads WHERE token = ?`).get(token);
    if (!upload) {
        return res.sendError(404, 'invalid_token', 'Invalid or expired upload token');
    }
    const tempFilePath = upload.path_temp;
    try {
        // Remove temp file
        await fs.promises.unlink(tempFilePath).catch(() => { });
        db.prepare(`DELETE FROM uploads WHERE token = ?`).run(token);
        res.json({ success: true });
    } catch (err) {
        log('error', `Error cancelling upload for ${token}`, { ip: req.ipaddr, username: req.username, error: err });
        res.sendError(500, 'cancel_failed', 'Failed to cancel upload');
    }
});

app.post('/api/files/download/create', requireAuth, requireVaultAccess, async (req, res) => {
    const downloadToken = getSecureRandomHex(8);
    db.prepare(`INSERT INTO downloads (token, username, vault, created) VALUES (?, ?, ?, ?)`)
        .run(downloadToken, req.username, req.vault.name, Date.now());
    res.json({ success: true, token: downloadToken });
});

app.post('/api/files/download/add', requireAuth, requireVaultAccess, async (req, res) => {
    const token = req.query.token;
    const download = db.prepare(`SELECT * FROM downloads WHERE token = ?`).get(token);
    if (!download) {
        return res.sendError(404, 'invalid_token', 'Invalid or expired download token');
    }
    const paths = req.body.paths;
    if (!Array.isArray(paths) || paths.length === 0) {
        return res.sendError(400, 'no_paths', 'No paths provided');
    }
    const pathsClean = [];
    for (const pathRelDirty of paths) {
        const path = getCleanPaths(req.vault, pathRelDirty);
        if (!fs.existsSync(path.abs)) {
            return res.sendError(404, 'not_found', `File not found in vault ${req.vault}: ${pathRelDirty}`);
        }
        pathsClean.push(path);
    }
    for (const path of pathsClean) {
        db.prepare(`INSERT OR IGNORE INTO download_files (token, path) VALUES (?, ?)`)
            .run(token, path.rel);
    }
    res.json({ success: true });
});

const requireDownloadToken = (req, res, next) => {
    const token = req.query.token || req.params.token;
    if (!token) {
        return res.sendError(400, 'missing_token', 'Missing download token');
    }
    const download = db.prepare(`SELECT * FROM downloads WHERE token = ?`).get(token);
    if (!download) {
        return res.sendError(404, 'invalid_token', 'Invalid or expired download token');
    }
    const paths = db.prepare(`SELECT path FROM download_files WHERE token = ?`).all(token);
    if (paths.length === 0) {
        return res.sendError(404, 'no_files', 'No files associated with this download');
    }
    const vault = config.vaults.find(v => v.name === download.vault);
    if (!vault) {
        return res.sendError(404, 'vault_missing', 'The vault this download was created from no longer exists');
    }
    req.download = download;
    req.download.paths = paths.map(p => p.path);
    req.download.vaultConfig = vault;
    next();
};

app.get('/api/files/download', requireDownloadToken, async (req, res) => {
    const { download, download: { paths, vaultConfig } } = req;
    let url = `/dl/${download.token}`;
    if (paths.length === 1) {
        const pathRel = paths[0];
        const pathAbs = path.join(vaultConfig.path, pathRel);
        const stats = await fs.promises.stat(pathAbs).catch(() => null);
        if (!stats) {
            return res.sendError(404, 'not_found', 'The file this download link points to no longer exists');
        }
        let name = path.basename(pathRel) || vaultConfig.name;
        if (stats.isDirectory()) {
            name = `${name}.zip`;
        }
        return res.json({
            success: true,
            url: url + '/' + encodeURIComponent(name)
        });
    } else {
        return res.json({
            success: true,
            url: url + '/files.zip',
        });
    }
});

app.get('/dl/:token{/:filename}', requireDownloadToken, async (req, res) => {
    let { download: { paths, vaultConfig, username }, ipaddr } = req;
    const vault = vaultConfig; // alias for clarity

    let filename = 'files';
    if (paths.length === 1) {
        const pathRel = paths[0];
        const pathAbs = path.join(vault.path, pathRel);
        const stats = await fs.promises.stat(pathAbs).catch(() => null);
        if (!stats) {
            return res.status(404).end('The file this download link points to no longer exists');
        }
        filename = path.basename(pathRel);
        if (stats.isDirectory()) {
            paths = (await fs.promises.readdir(pathAbs).catch(() => [])).map(file => path.join(pathRel, file));
        } else {
            return res.sendFile(pathAbs, { dotfiles: 'allow' });
        }
    }
    filename = `${filename || vault.name}.zip`;
    log('info', `Starting zip download for ${paths.length} items from vault ${vault.name}`, { ip: ipaddr, username });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const archive = archiver('zip');
    archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
            log('warn', `Archiver warning: ${err.message}`, { ip: ipaddr, username });
        } else {
            log('error', `Archiver error: ${err.message}`, { ip: ipaddr, username, error: err });
            res.sendError(500, 'archiver_error', err.message);
        }
    });
    archive.on('error', (err) => {
        log('error', `Archiver error during zip creation: ${err.message}`, { ip: ipaddr, username, error: err });
        res.sendError(500, 'archiver_error', err.message);
    });
    archive.on('finish', () => {
        log('info', `Finished zip download for token ${req.params.token}`, { ip: ipaddr, username });
    });
    req.on('close', () => {
        if (res.writableFinished) return;
        log('info', `Client disconnected, aborting zip download for token ${req.params.token}`, { ip: ipaddr, username });
        archive.abort();
    });
    archive.pipe(res);
    for (const pathRel of paths) {
        const pathAbs = path.join(vault.path, pathRel);
        if (!fs.existsSync(pathAbs)) {
            log('warn', `File not found during zip creation, skipping: ${pathAbs}`, { ip: ipaddr, username });
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