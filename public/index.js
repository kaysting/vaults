let authToken = localStorage.getItem('token');

const apiRequest = async (method, url, { params = {}, data = {} } = {}) => {
    try {
        const config = {
            method,
            url,
            headers: { Authorization: `Bearer ${authToken}` },
            params,
            data
        };
        // Remove data for GET and DELETE requests
        if (method === 'get' || method === 'delete') {
            delete config.data;
        }
        const res = await axios(config);
        return res.data;
    } catch (error) {
        const errorText = `${error.response?.status || 500}: ` + error.response?.data?.message || error.toString();
        console.error(`API ${method.toUpperCase()} ${errorText}`);
        throw new Error(errorText);
    }
};

const api = {
    get: (url, params = {}) => apiRequest('get', url, { params }),
    post: (url, params = {}, data = {}) => apiRequest('post', url, { params, data }),
    put: (url, params = {}, data = {}) => apiRequest('put', url, { params, data }),
    delete: (url, params = {}) => apiRequest('delete', url, { params })
};

const pageLogin = document.querySelector('#login');
const pageMain = document.querySelector('#main');
const inputLoginUsername = document.querySelector('#loginUsername');
const inputLoginPassword = document.querySelector('#loginPassword');
const btnLogin = document.querySelector('#btnLogin');
const loginFormText = document.querySelector('#loginCard .form-text');
const btnLogout = document.querySelector('#btnLogout');
const elUsername = document.querySelector('#sidebar .username');
const elBreadcrumbs = document.querySelector('#breadcrumbs');
const elVaults = document.querySelector('#sidebar .vaults');
const elBrowser = document.querySelector('#browser');
const elFiles = document.querySelector('#files');
const elStatus = document.querySelector('#status');
const btnNavBack = document.querySelector('#btnNavBack');
const btnNavForward = document.querySelector('#btnNavForward');
const btnNavUp = document.querySelector('#btnNavUp');
const btnRefresh = document.querySelector('#btnRefresh');
const btnActionUpload = document.querySelector('#btnActionUpload');
const btnActionNewFolder = document.querySelector('#btnActionNewFolder');
const btnActionCut = document.querySelector('#btnActionCut');
const btnActionCopy = document.querySelector('#btnActionCopy');
const btnActionPaste = document.querySelector('#btnActionPaste');
const btnActionRename = document.querySelector('#btnActionRename');
const btnActionDelete = document.querySelector('#btnActionDelete');
const btnActionDownload = document.querySelector('#btnActionDownload');
const btnActionSelect = document.querySelector('#btnActionSelect');
const btnActionSort = document.querySelector('#btnActionSort');
const btnActionView = document.querySelector('#btnActionView');

const setStatus = (text, danger = false) => {
    elStatus.textContent = text;
    elStatus.classList.toggle('danger', danger);
};

const navHistory = {
    back: [],
    forward: []
};

const addToHistory = (history, path) => {
    if (history[history.length - 1] !== path) {
        history.push(path);
    }
};

const selectedFileClass = 'btn-tonal';
const deselectedFileClass = 'btn-text';
let lastSelectedFileIndex = -1;

const fileSelect = (path) => {
    const elFile = elFiles.querySelector(`.file[data-path="${path}"]`);
    if (elFile) {
        // Select this file
        elFile.classList.add(selectedFileClass);
        elFile.classList.remove(deselectedFileClass);
    } else {
        throw new Error(`File entry not found for path ${path}`);
    }
    updateActionButtons();
};

const fileDeselect = (path) => {
    const elFile = elFiles.querySelector(`.file[data-path="${path}"]`);
    if (elFile) {
        // Deselect this file
        elFile.classList.add(deselectedFileClass);
        elFile.classList.remove(selectedFileClass);
    } else {
        throw new Error(`File entry not found for path ${path}`);
    }
    updateActionButtons();
};

const fileDeselectAll = () => {
    const selectedFileEls = elFiles.querySelectorAll('.file.btn-tonal');
    selectedFileEls.forEach(el => {
        el.classList.add(deselectedFileClass);
        el.classList.remove(selectedFileClass);
    });
    updateActionButtons();
};

const fileSelectAll = () => {
    const fileEls = elFiles.querySelectorAll('.file');
    fileEls.forEach(el => {
        el.classList.add(selectedFileClass);
        el.classList.remove(deselectedFileClass);
    });
    updateActionButtons();
};

const extensionTypes = {
    '3g2': 'video',
    '3gp': 'video',
    '7z': 'compressed',
    'aac': 'audio',
    'ai': 'image',
    'aif': 'audio',
    'apk': 'software',
    'app': 'software',
    'avi': 'video',
    'bat': 'software',
    'bmp': 'image',
    'bz2': 'compressed',
    'c': 'text',
    'cpp': 'text',
    'csv': 'text',
    'css': 'text',
    'dat': 'software',
    'db': 'software',
    'deb': 'software',
    'dmg': 'software',
    'doc': 'text',
    'docx': 'text',
    'dotx': 'text',
    'eml': 'text',
    'eps': 'image',
    'exe': 'software',
    'flac': 'audio',
    'flv': 'video',
    'gif': 'image',
    'gz': 'compressed',
    'h': 'text',
    'heic': 'image',
    'html': 'text',
    'ico': 'image',
    'ics': 'text',
    'ini': 'text',
    'iso': 'software',
    'jar': 'software',
    'java': 'text',
    'jpeg': 'image',
    'jpg': 'image',
    'js': 'text',
    'json': 'text',
    'key': 'text',
    'log': 'text',
    'm4a': 'audio',
    'm4v': 'video',
    'md': 'text',
    'mid': 'audio',
    'midi': 'audio',
    'mkv': 'video',
    'mov': 'video',
    'mp3': 'audio',
    'mp4': 'video',
    'mpeg': 'video',
    'mpg': 'video',
    'msi': 'software',
    'odp': 'text',
    'ods': 'text',
    'odt': 'text',
    'ogg': 'audio',
    'otf': 'software',
    'pdf': 'text',
    'php': 'text',
    'png': 'image',
    'ppt': 'text',
    'pptx': 'text',
    'psd': 'image',
    'py': 'text',
    'rar': 'compressed',
    'rb': 'text',
    'rm': 'video',
    'rom': 'software',
    'rpm': 'software',
    'rtf': 'text',
    'sh': 'software',
    'sql': 'text',
    'sqlite': 'software',
    'svg': 'image',
    'swf': 'video',
    'tar': 'compressed',
    'tga': 'image',
    'tif': 'image',
    'tiff': 'image',
    'toml': 'text',
    'ttf': 'software',
    'txt': 'text',
    'vcf': 'text',
    'wav': 'audio',
    'webm': 'video',
    'webp': 'image',
    'wma': 'audio',
    'wmv': 'video',
    'woff': 'software',
    'woff2': 'software',
    'xls': 'text',
    'xlsx': 'text',
    'xml': 'text',
    'xz': 'compressed',
    'yaml': 'text',
    'yml': 'text',
    'zip': 'compressed'
};
const typeIcons = {
    file: 'draft',
    folder: 'folder',
    text: 'description',
    image: 'image',
    audio: 'headphones',
    video: 'movie',
    compressed: 'folder_zip',
    software: 'wysiwyg'
};

let username = '';
let sortType = 'name';
let sortOrder = 'asc';
let viewType = 'list';
let viewSize = 'normal';
let viewHidden = false;
let currentVault = null;
let currentPath = '';
let isLoaded = false;
let clipboard = [];

const getSelectedFiles = () => {
    const selectedFiles = [];
    const fileEls = elFiles.querySelectorAll(`.file.${selectedFileClass}`);
    fileEls.forEach(el => {
        selectedFiles.push({
            path: el.dataset.path,
            isDirectory: el.dataset.isDirectory === 'true'
        });
    });
    return selectedFiles;
};

const getActionStates = () => {
    const selectedFiles = getSelectedFiles();
    const isDirectorySelected = selectedFiles.some(f => f.isDirectory);
    const countSelected = selectedFiles.length;
    return {
        countSelected,
        isDirectorySelected,
        canUpload: isLoaded,
        canCreateFolder: isLoaded,
        canCut: countSelected > 0,
        canCopy: countSelected > 0,
        canPaste: clipboard.length > 0,
        canRename: countSelected === 1,
        canDelete: countSelected > 0,
        canDownload: isLoaded,
        canSelect: isLoaded,
        canChangeSort: isLoaded,
        canChangeView: isLoaded
    };
};

const updateActionButtons = () => {
    const states = getActionStates();
    btnActionUpload.disabled = !states.canUpload;
    btnActionNewFolder.disabled = !states.canCreateFolder;
    btnActionCut.disabled = !states.canCut;
    btnActionCopy.disabled = !states.canCopy;
    btnActionPaste.disabled = !states.canPaste;
    btnActionRename.disabled = !states.canRename;
    btnActionDelete.disabled = !states.canDelete;
    btnActionDownload.disabled = !states.canDownload;
    if (states.countSelected == 0)
        btnActionDownload.title = `Download current folder as zip`;
    else if (states.countSelected == 1 && !states.isDirectorySelected)
        btnActionDownload.title = `Download selected file`;
    else if (states.countSelected == 1 && states.isDirectorySelected)
        btnActionDownload.title = `Download selected folder as zip`;
    else if (states.countSelected > 1)
        btnActionDownload.title = `Download selected files as zip`;
    btnActionSelect.disabled = !states.canSelect;
    btnActionSort.disabled = !states.canChangeSort;
    btnActionView.disabled = !states.canChangeView;
};

const actionHandlers = {};

const showFileContextMenu = () => {
    const states = getActionStates();
};

const browse = async (vault, path = '/', shouldPushState = true) => {
    setStatus('Loading files...');
    const isLoadedOld = isLoaded;
    isLoaded = false;
    updateActionButtons();
    let res;
    try {
        res = await api.get('/api/files', { vault, path });
    } catch (error) {
        setStatus(error, true);
        isLoaded = isLoadedOld;
        return;
    }
    if (shouldPushState) {
        addToHistory(navHistory.back, currentPath);
        navHistory.forward = [];
    }
    currentVault = vault;
    currentPath = res.path;
    lastSelectedFileIndex = -1;
    updateNavButtons();
    if (shouldPushState)
        window.history.pushState({}, '', `/${vault}${res.path}`);
    document.title = `Vaults - ${vault} - ${res.path || '/'}`;
    // Render breadcrumbs
    elBreadcrumbs.innerHTML = '';
    let ancestor = '';
    const pathParts = res.path.split('/').filter(Boolean);
    pathParts.unshift('');
    for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        ancestor += part;
        if (i > 0) ancestor += '/';
        const elCrumb = document.createElement('button');
        elCrumb.className = 'btn btn-text';
        elCrumb.textContent = part == '' ? vault : part;
        const path = ancestor;
        elBreadcrumbs.appendChild(elCrumb);
        if (i == pathParts.length - 1) {
            elCrumb.classList.add('current');
        } else {
            elCrumb.addEventListener('click', async () => {
                await browse(vault, path);
            });
            const elSep = document.createElement('span');
            elSep.className = 'sep';
            elSep.textContent = '/';
            elBreadcrumbs.appendChild(elSep);
        }
    }
    // Reverse breadcrumbs to show properly in reverse row
    const reversedChildren = Array.from(elBreadcrumbs.children).reverse();
    elBreadcrumbs.innerHTML = '';
    reversedChildren.forEach(child => elBreadcrumbs.appendChild(child));
    // Set sort and view data attributes
    elBrowser.dataset.sortType = sortType;
    elBrowser.dataset.sortOrder = sortOrder;
    elBrowser.dataset.viewType = viewType;
    elBrowser.dataset.viewSize = viewSize;
    elBrowser.dataset.viewHidden = viewHidden;
    // Sort file list
    const dirsOnly = res.files.filter(f => f.isDirectory);
    const filesOnly = res.files.filter(f => !f.isDirectory);
    if (sortType === 'name') {
        dirsOnly.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        filesOnly.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } else if (sortType === 'size') {
        dirsOnly.sort((a, b) => a.size - b.size);
        filesOnly.sort((a, b) => a.size - b.size);
    }
    else if (sortType === 'date') {
        dirsOnly.sort((a, b) => new Date(b.modified) - new Date(a.modified));
        filesOnly.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    }
    if (sortOrder === 'desc') {
        dirsOnly.reverse();
        filesOnly.reverse();
    }
    const files = [...dirsOnly, ...filesOnly];
    // Add .. to the top of the list
    if (currentPath && currentPath !== '/') {
        files.unshift({
            name: '..',
            isDirectory: true,
            path: currentPath + '..',
        });
    }
    // Render file list
    elFiles.innerHTML = '';
    let i = 0;
    for (const file of files) {
        // Determine file type
        const ext = file.name.split('.').pop().toLowerCase();
        const type = file.isDirectory ? 'folder' : (extensionTypes[ext] || 'file');
        // Create file element
        const elFile = document.createElement('button');
        elFile.className = 'file btn btn-text d-flex gap-8 justify-start text-left';
        elFile.innerHTML = /*html*/`
            <span class="icon material-symbols-outlined type-${type} text-center flex-no-shrink"></span>
            <span class="name flex-grow text-clip-ellipses" data-tooltip-overflow="true"></span>
            <span class="date text-clip-ellipses flex-no-shrink">-</span>
            <span class="size text-clip-ellipses flex-no-shrink">-</span>
        `;
        const elIcon = elFile.querySelector('.icon');
        const elName = elFile.querySelector('.name');
        const elSize = elFile.querySelector('.size');
        const elDate = elFile.querySelector('.date');
        // Set file data attributes
        elFile.dataset.index = i;
        elFile.dataset.path = file.path;
        elFile.dataset.isDirectory = file.isDirectory;
        // Mark hidden if file name starts with a dot but isn't '..'
        if (file.name.startsWith('.') && file.name !== '..') {
            elFile.classList.add('is-hidden');
        }
        // Set entry contents
        elIcon.textContent = typeIcons[type];
        elName.textContent = file.name;
        elName.title = file.name;
        if (!file.isDirectory) {
            elSize.textContent = formatBytes(file.size);
            elSize.title = file.size.toLocaleString() + ' bytes';
            elDate.textContent = getRelativeTimestamp(file.modified);
            elDate.title = new Date(file.modified).toLocaleString();
        }
        // Handle file selection
        const index = i;
        elFile.addEventListener('click', async (e) => {
            e.stopPropagation();
            const isSelected = elFile.classList.contains(selectedFileClass);
            if (e.shiftKey && lastSelectedFileIndex !== -1) {
                // Shift selection logic
                fileDeselectAll();
                const fileEls = Array.from(elFiles.querySelectorAll('.file'));
                const start = Math.min(lastSelectedFileIndex, index);
                const end = Math.max(lastSelectedFileIndex, index);
                for (let j = start; j <= end; j++) {
                    const btn = fileEls[j];
                    btn.classList.add(selectedFileClass);
                    btn.classList.remove(deselectedFileClass);
                }
                updateActionButtons();
            } else {
                if (e.ctrlKey && isSelected) {
                    fileDeselect(file.path);
                    return;
                }
                if (!e.ctrlKey)
                    fileDeselectAll();
                fileSelect(file.path);
                lastSelectedFileIndex = index;
            }
        });
        // Handle file opening
        elFile.addEventListener('dblclick', async () => {
            if (file.isDirectory) {
                await browse(vault, `${res.path}/${file.name}`);
            } else {
                const resDownload = await api.get('/api/files/download', {
                    vault, path: file.path
                });
                const a = document.createElement('a');
                a.href = `/download/${resDownload.token}`;
                a.download = file.name;
                a.target = '_blank';
                a.click();
            }
        });
        // Handle context menu
        elFile.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!elFile.classList.contains(selectedFileClass)) {
                fileDeselectAll();
                fileSelect(file.path);
                lastSelectedFileIndex = index;
            }
            showFileContextMenu();
        });
        // Add to list
        elFiles.appendChild(elFile);
        i++;
    }
    // Update action buttons
    isLoaded = true;
    updateActionButtons();
    // Set status
    if (res.files.length === 0) {
        setStatus('This folder is empty');
    } else {
        setStatus(`${res.files.length} file${res.files.length === 1 ? '' : 's'}`);
    }
};

const browseToCurrentPath = async () => {
    const pathParts = decodeURI(window.location.pathname).split('/').filter(Boolean);
    if (pathParts.length >= 1) {
        const vault = pathParts.shift();
        const path = pathParts.join('/');
        await browse(vault, path, false);
        return true;
    } else {
        return false;
    }
};

const loadVaults = async () => {
    elVaults.innerHTML = '';
    const res = await api.get('/api/vaults');
    res.vaults.sort((a, b) => a.name.localeCompare(b.name));
    for (const vault of res.vaults) {
        const elVault = document.createElement('button');
        elVault.className = 'btn btn-text vault';
        elVault.innerHTML = /*html*/`
            <span class="material-symbols-outlined">dns</span>
            <div class="d-flex flex-col gap-2">
                <span class="name"></span>
                <span class="members">${vault.users.length} member${vault.users.length == 1 ? '' : 's'}</span>
            </div>
        `;
        elVault.querySelector('.name').textContent = vault.name;
        elVault.addEventListener('click', async () => {
            elFiles.innerHTML = '';
            await browse(vault.name, '');
        });
        elVaults.appendChild(elVault);
    }
};

const updateNavButtons = () => {
    btnNavBack.disabled = navHistory.back.length === 0;
    btnNavForward.disabled = navHistory.forward.length === 0;
    btnNavUp.disabled = !currentPath || currentPath === '/';
    btnRefresh.disabled = !currentVault;
};

const init = async () => {
    let isLoggedIn = false;
    try {
        const res = await api.get('/api/auth');
        isLoggedIn = res.success;
        username = res.session.username;
    } catch (error) { }
    if (isLoggedIn) {
        elUsername.textContent = username;
        elFiles.innerHTML = '';
        elBreadcrumbs.innerHTML = '';
        await loadVaults();
        const browsed = await browseToCurrentPath();
        if (!browsed) {
            // Select first vault
            const firstVault = elVaults.querySelector('.vault');
            if (firstVault) {
                const vaultName = firstVault.querySelector('.name').textContent;
                await browse(vaultName);
            }
        }
    } else {
        inputLoginUsername.value = '';
        inputLoginPassword.value = '';
    }
    pageLogin.style.display = isLoggedIn ? 'none' : '';
    pageMain.style.display = isLoggedIn ? '' : 'none';
    updateNavButtons();
};

btnLogin.addEventListener('click', async (e) => {
    e.preventDefault();
    btnLogin.disabled = true;
    const username = inputLoginUsername.value.trim();
    const password = inputLoginPassword.value.trim();
    loginFormText.classList.add('d-none');
    if (!username || !password) {
        loginFormText.textContent = 'Missing username or password';
        loginFormText.classList.remove('d-none');
        btnLogin.disabled = false;
        return;
    }
    try {
        const res = await api.post('/api/auth', {}, { username, password });
        authToken = res.token;
        localStorage.setItem('token', authToken);
        await init();
    } catch (error) {
        loginFormText.textContent = error.response?.data?.message || 'Login failed';
        loginFormText.classList.remove('d-none');
    } finally {
        btnLogin.disabled = false;
    }
});

btnLogout.addEventListener('click', async (e) => {
    await api.delete('/api/auth');
    localStorage.removeItem('token');
    authToken = null;
    await init();
});

btnNavBack.addEventListener('click', async () => {
    if (navHistory.back.length > 0) {
        const lastPath = navHistory.back.pop();
        addToHistory(navHistory.forward, currentPath);
        await browse(currentVault, lastPath, false);
    }
});

btnNavForward.addEventListener('click', async () => {
    if (navHistory.forward.length > 0) {
        const nextPath = navHistory.forward.pop();
        addToHistory(navHistory.back, currentPath);
        await browse(currentVault, nextPath, false);
    }
});

btnNavUp.addEventListener('click', async () => {
    if (currentPath && currentPath !== '/') {
        const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
        addToHistory(navHistory.back, currentPath);
        await browse(currentVault, parentPath, true);
    }
});

btnRefresh.addEventListener('click', async () => {
    await browse(currentVault, currentPath, false);
});

elFiles.addEventListener('click', (e) => {
    if (e.target === elFiles) {
        fileDeselectAll();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    await init();
    updateColorMode();
});

window.addEventListener('popstate', async () => {
    await browseToCurrentPath();
});