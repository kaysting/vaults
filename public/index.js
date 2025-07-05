const roundSmart = (num) => {
    if (num < 1)
        return parseFloat(num.toFixed(3));
    if (num < 10)
        return parseFloat(num.toFixed(2));
    if (num < 100)
        return parseFloat(num.toFixed(1));
    return parseFloat(num.toFixed(0));
};

const formatBytes = bytes => {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${roundSmart(bytes)} ${units[i]}`;
};

const msToRelativeTime = (ms) => {
    const secs = Math.round(ms / 1000);
    const mins = Math.round(secs / 60);
    const hours = Math.round(mins / 60);
    const days = Math.round(hours / 24);
    const weeks = Math.round(days / 7);
    const months = Math.round(days / 30.4369);
    const years = Math.round(days / 365.2422);
    if (secs < 180) return 'Moments';
    if (mins < 120) return `${mins} minutes`;
    if (hours < 48) return `${hours} hours`;
    if (days < 14) return `${days} days`;
    if (weeks < 12) return `${weeks} weeks`;
    if (months < 24) return `${months} months`;
    return `${years} years`;
};
const getRelativeTimestamp = (ts, anchor = Date.now()) => {
    const ms = anchor - ts;
    const relativeTime = msToRelativeTime(ms);
    if (ms < 0)
        return `${relativeTime} from now`;
    return `${relativeTime} ago`;
};

const isElementOverflowing = (el) => {
    const styles = window.getComputedStyle(el);
    return (
        styles.overflow === 'hidden' &&
        styles.textOverflow === 'ellipsis' &&
        styles.whiteSpace === 'nowrap' &&
        el.scrollWidth > el.clientWidth
    );
};

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

const setStatus = (text, danger = false) => {
    elStatus.textContent = text;
    elStatus.classList.toggle('text-danger', danger);
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

const navHistory = {
    back: [],
    forward: []
};

const addToHistory = (history, path) => {
    if (history[history.length - 1] !== path) {
        history.push(path);
    }
};

const browse = async (vault, path, shouldPushState = true) => {
    setStatus('Loading files...');
    let res;
    try {
        res = await api.get('/api/files', { vault, path });
    } catch (error) {
        setStatus(error, true);
        return;
    }
    if (shouldPushState) {
        addToHistory(navHistory.back, currentPath);
        navHistory.forward = [];
    }
    currentVault = vault;
    currentPath = res.path;
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
                await browse(vault, path, true);
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
    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        const type = file.isDirectory ? 'folder' : (extensionTypes[ext] || 'file');
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
        elIcon.textContent = typeIcons[type];
        elName.textContent = file.name;
        elName.title = file.name;
        if (file.name.startsWith('.') && file.name !== '..') {
            elFile.classList.add('is-hidden');
        }
        if (!file.isDirectory) {
            elSize.textContent = formatBytes(file.size);
            elSize.title = file.size.toLocaleString() + ' bytes';
            elDate.textContent = getRelativeTimestamp(file.modified);
            elDate.title = new Date(file.modified).toLocaleString();
        }
        elFile.addEventListener('click', async () => {
            if (file.isDirectory) {
                await browse(vault, `${res.path}/${file.name}`, true);
            } else {
                // Download file
            }
        });
        elFiles.appendChild(elFile);
    }
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
        await browseToCurrentPath();
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

const updateColorMode = () => {
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.dataset.colorMode = isDarkMode ? 'dark' : 'light';
};

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateColorMode);

document.addEventListener('DOMContentLoaded', async () => {
    await init();
    updateColorMode();
});

window.addEventListener('popstate', async () => {
    await browseToCurrentPath();
});

let tooltip;
let currentTooltipElement;

document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title]');
    if (!el || el === currentTooltipElement) return;

    if (currentTooltipElement && currentTooltipElement.contains(el)) {
        // Prevent flickering when moving over child elements
        return;
    }

    currentTooltipElement = el;

    const titleText = el.getAttribute('title');
    const tooltipHtml = el.dataset.tooltipHtml;
    el.setAttribute('data-title', titleText);
    el.removeAttribute('title');
    const onlyShowOnOverflow = el.dataset.tooltipOverflow === 'true';
    const isOverflowing = isElementOverflowing(el);
    if (onlyShowOnOverflow && !isOverflowing) return;

    tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    if (tooltipHtml)
        tooltip.innerHTML = tooltipHtml;
    else
        tooltip.innerText = titleText;
    document.body.appendChild(tooltip);

    // Positioning
    const rect = el.getBoundingClientRect();
    tooltip.style.opacity = 1;
    tooltip.style.left = rect.left + window.scrollX + rect.width / 2 + 'px';

    const tooltipRect = tooltip.getBoundingClientRect();
    let top = rect.top + window.scrollY - tooltipRect.height - 5;
    let placement = 'above';

    if (top < window.scrollY) {
        placement = 'below';
        top = rect.bottom + window.scrollY + 5;
    }
    tooltip.classList.add(placement);
    tooltip.style.top = top + 'px';
    tooltip.style.transform = 'translateX(-50%)';
});

document.addEventListener('mouseout', (e) => {
    const el = e.relatedTarget;
    if (currentTooltipElement && currentTooltipElement.contains(el)) {
        // Prevent tooltip removal when moving to child elements
        return;
    }

    if (currentTooltipElement) {
        currentTooltipElement.setAttribute('title', currentTooltipElement.getAttribute('data-title'));
        currentTooltipElement.removeAttribute('data-title');
    }

    if (tooltip) {
        tooltip.remove();
        tooltip = null;
    }

    currentTooltipElement = null;
});