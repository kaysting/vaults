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

const generateDownloadLink = async (vault, paths = []) => {
    const resCreate = await api.post('/api/files/download/create', { vault });
    const token = resCreate.token;
    const resAdd = await api.post('/api/files/download/add', { token, vault }, { paths });
    const resGet = await api.get('/api/files/download', { token });
    const url = encodeURI(window.location.origin + resGet.url);
    console.log(`Download link generated: ${url}`);
    return url;
};

const startFileDownload = (url, name = '') => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
};

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
            el,
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
        canOpen: countSelected === 1,
        canCut: countSelected > 0,
        canCopy: countSelected > 0,
        canPaste: clipboard.length > 0,
        canRename: countSelected === 1,
        canDelete: countSelected > 0,
        canDownload: isLoaded,
        downloadLabel: (() => {
            if (countSelected === 0) return 'Download all as zip';
            if (countSelected === 1 && !isDirectorySelected) return 'Download file';
            if (countSelected === 1 && isDirectorySelected) return 'Download folder as zip';
            if (countSelected > 1) return 'Download files as zip';
            return 'Download';
        })(),
        canCopyLink: isLoaded,
        canSelect: isLoaded,
        canChangeSort: isLoaded,
        canChangeView: true
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
    btnActionDownload.title = states.downloadLabel;
    btnActionCopyLink.disabled = !states.canCopyLink;
    btnActionSelect.disabled = !states.canSelect;
    btnActionSort.disabled = !states.canChangeSort;
    btnActionView.disabled = !states.canChangeView;
};

const actions = {
    createFolder: async () => {
        const el = document.createElement('div');
        el.innerHTML = /*html*/`
            <div class="form-field">
                <input type="text" class="textbox" placeholder="Enter folder name">
                <div class="form-text text-danger text-left d-none"></div>
            </div>
        `;
        const elInput = el.querySelector('input');
        const elText = el.querySelector('.form-text');
        const elModal = showModal({
            width: 400,
            title: 'Create new folder',
            bodyContent: el,
            actions: [{
                label: 'Create',
                class: 'btn-primary',
                preventClose: true,
                onClick: async () => {
                    try {
                        const res = await api.post('/api/files/folder/create', {
                            vault: currentVault,
                            path: currentPath + '/' + elInput.value
                        });
                        elModal.close();
                        showToast({
                            type: 'success',
                            icon: 'check_circle',
                            message: `Folder created!`
                        });
                        browse(currentVault, currentPath, false, [res.path]);
                    } catch (error) {
                        const errorText = error.toString();
                        elText.textContent = errorText;
                        elText.classList.remove('d-none');
                    }
                }
            }, {
                label: 'Cancel'
            }]
        });
        elInput.focus();
        elInput.addEventListener('keydown', (e) => {
            elText.classList.add('d-none');
            if (e.key.match(/[\\/:\*\?"<>\|]/)) {
                e.preventDefault();
                elText.textContent = `That character isn't allowed.`;
                elText.classList.remove('d-none');
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                const btnCreate = elModal.querySelector('.btn-primary');
                btnCreate.click();
            }
        });
    },
    delete: async () => {
        const selectedFiles = getSelectedFiles();
        const el = document.createElement('div');
        el.innerHTML = /*html*/`
            <p>Are you sure you want to delete the selected ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'}?</p>
        `;
        showModal({
            title: 'Confirm deletion',
            bodyContent: el,
            grow: false,
            actions: [{
                label: 'Delete',
                class: 'btn-danger',
                onClick: async () => {
                    let i = 0;
                    let countSuccess = 0;
                    const toast = showToast({
                        icon: 'delete',
                        message: `...`,
                        progressBar: true
                    });
                    for (const file of selectedFiles) {
                        try {
                            toast.updateMessage(`Deleting ${file.path.split('/').pop()} (${i + 1}/${selectedFiles.length})...`);
                            await api.post('/api/files/delete', {
                                vault: currentVault,
                                path: file.path
                            });
                            countSuccess++;
                        } catch (error) {
                            showToast({
                                type: 'danger',
                                icon: 'error',
                                message: `Failed to delete ${file.path}: ${error.message}`
                            });
                        }
                        i++;
                        toast.updateProgress((i / selectedFiles.length) * 100);
                    }
                    showToast({
                        type: 'success',
                        icon: 'check_circle',
                        message: `${countSuccess} file${countSuccess === 1 ? '' : 's'} deleted!`
                    });
                    await browse(currentVault, currentPath, false);
                }
            }, {
                label: 'Cancel'
            }]
        });
    },
    uploadFiles: async () => {
        console.log('Placeholder for uploadFiles');
    },
    cut: async () => {
        console.log('Placeholder for cut');
    },
    copy: async () => {
        console.log('Placeholder for copy');
    },
    paste: async () => {
        console.log('Placeholder for paste');
    },
    rename: async () => {
        console.log('Placeholder for rename');
    },
    download: async () => {
        const selectedFiles = getSelectedFiles();
        const paths = selectedFiles.map(f => f.path);
        if (paths.length === 0) paths.push(currentPath);
        const url = await generateDownloadLink(currentVault, paths);
        startFileDownload(url);
    },
    copyLink: async () => {
        const selectedFiles = getSelectedFiles();
        const paths = selectedFiles.map(f => f.path);
        if (paths.length === 0) paths.push(currentPath);
        const url = await generateDownloadLink(currentVault, paths);
        navigator.clipboard.writeText(url).then(() => {
            showToast({
                type: 'success',
                icon: 'check_circle',
                message: `Download link copied to clipboard!`
            });
        }).catch(err => {
            showToast({
                type: 'danger',
                icon: 'error',
                message: `Failed to copy download link. Here it is: ${url}`
            });
        });
    },
    open: async (file) => {
        if (file.isDirectory) {
            return await browse(currentVault, file.path);
        }
        const url = await generateDownloadLink(currentVault, [file.path]);
        startFileDownload(url, file.name);
    }
};

const showFileContextMenu = (e) => {
    const states = getActionStates();
    const item = {
        upload: {
            icon: 'upload',
            label: 'Upload files...',
            onClick: actions.uploadFiles
        },
        createFolder: {
            icon: 'create_new_folder',
            label: 'Create folder...',
            onClick: actions.createFolder
        },
        open: {
            icon: 'open_in_new',
            label: 'Open',
            onClick: actions.open
        },
        cut: {
            icon: 'content_cut',
            label: 'Cut',
            onClick: actions.cut
        },
        copy: {
            icon: 'content_copy',
            label: 'Copy',
            onClick: actions.copy
        },
        paste: {
            icon: 'content_paste',
            label: 'Paste',
            onClick: actions.paste
        },
        rename: {
            icon: 'drive_file_rename_outline',
            label: 'Rename..',
            onClick: actions.rename
        },
        delete: {
            icon: 'delete',
            label: 'Delete...',
            onClick: actions.delete
        },
        download: {
            icon: 'download',
            label: states.downloadLabel,
            onClick: actions.download
        },
        copyLink: {
            icon: 'link',
            label: 'Copy download link',
            onClick: actions.copyLink
        },
        select: {
            icon: 'check_box',
            label: 'Select...',
            onClick: (e) => {
                const menuEl = document.querySelector('.context-menu');
                showSelectContextMenu(e, menuEl);
            }
        },
        sort: {
            icon: 'sort',
            label: 'Sort...',
            onClick: (e) => {
                const menuEl = document.querySelector('.context-menu');
                showSortContextMenu(e, menuEl);
            }
        },
        view: {
            icon: 'view_list',
            label: 'View...',
            onClick: (e) => {
                const menuEl = document.querySelector('.context-menu');
                showViewContextMenu(e, menuEl);
            }
        },
        sep: { type: 'separator' }
    };
    let items = [];
    if (states.countSelected == 0) {
        items.push(item.upload, item.createFolder, item.sep);
        if (states.canPaste) {
            items.push(item.paste, item.sep);
        }
        items.push(item.download, item.copyLink, item.sep, item.select, item.sort, item.view);
    } else if (states.countSelected == 1) {
        items.push(item.open, item.sep, item.cut, item.copy, item.rename, item.sep, item.delete, item.sep, item.download, item.copyLink);
    } else {
        items.push(item.cut, item.copy, item.sep, item.delete, item.sep, item.download, item.copyLink);
    }
    showContextMenu(e, items);
};

const handleKeyCombo = (combo) => {
    const states = getActionStates();
    if (combo === 'shift+n' && states.canCreateFolder) {
        actions.createFolder();
    } else if (combo === 'delete' && states.canDelete) {
        actions.delete();
    } else if (combo === 'backspace') {
        btnNavUp.click();
    } else if (combo === 'r') {
        btnRefresh.click();
    } else if ((combo === 'ctrl+a' || combo === 'meta+a') && states.canSelect) {
        fileSelectAll();
    } else if ((combo === 'ctrl+x' || combo === 'meta+x') && states.canCut) {
        actions.cut();
    } else if ((combo === 'ctrl+c' || combo === 'meta+c') && states.canCopy) {
        actions.copy();
    } else if ((combo === 'ctrl+v' || combo === 'meta+v') && states.canPaste) {
        actions.paste();
    } else if (combo === 'shift+d' && states.canDownload) {
        actions.download();
    } else {
        return false;
    }
    return true;
};

const browse = async (vault, path = '/', shouldPushState = true, selectFiles = []) => {
    setStatus('Loading files...');
    const isLoadedOld = isLoaded;
    isLoaded = false;
    updateActionButtons();
    let res;
    try {
        res = await api.get('/api/files/list', { vault, path });
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
    // Render file list
    elFiles.innerHTML = '';
    let i = 0;
    for (const file of files) {
        // Determine file type
        const ext = file.name.split('.').pop().toLowerCase();
        const type = file.isDirectory ? 'folder' : (extensionTypes[ext] || 'file');
        // Create file element
        const elFile = document.createElement('button');
        elFile.className = `file btn ${deselectedFileClass} d-flex gap-8 justify-start text-left`;
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
        // Select file if specified
        if (selectFiles.includes(file.path)) {
            elFile.classList.add(selectedFileClass);
            elFile.classList.remove(deselectedFileClass);
        }
        // Handle file selection
        const index = i;
        elFile.addEventListener('click', async (e) => {
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
                lastSelectedFileIndex = index;
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
            updateActionButtons();
        });
        // Handle file opening
        elFile.addEventListener('dblclick', () => actions.open(file));
        elFile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                actions.open(file);
            }
        });
        // Handle context menu
        elFile.addEventListener('contextmenu', (e) => {
            showFileContextMenu(e);
        });
        // Add to list
        elFiles.appendChild(elFile);
        i++;
    }
    // Update action buttons
    isLoaded = true;
    updateActionButtons();
    // Set status
    setStatus(`Loaded ${res.files.length} file${res.files.length === 1 ? '' : 's'}`);
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

const changeSort = (type, order) => {
    if (sortType === type && !order) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        sortType = type;
        sortOrder = order || 'asc';
    }
    elBrowser.dataset.sortType = sortType;
    elBrowser.dataset.sortOrder = sortOrder;
    browse(currentVault, currentPath, false);
};

const changeView = (type, size, hidden) => {
    viewType = type || 'list';
    viewSize = size || 'normal';
    viewHidden = hidden || false;
    elBrowser.dataset.viewType = viewType;
    elBrowser.dataset.viewSize = viewSize;
    elBrowser.dataset.viewHidden = viewHidden;
    elFiles.classList.toggle('view-list', viewType === 'list');
    elFiles.classList.toggle('view-grid', viewType === 'grid');
    elFiles.classList.toggle('view-tiles', viewType === 'tiles');
};

const showSelectContextMenu = (event, element = btnActionSelect) => {
    showContextMenu(event, [
        {
            label: 'Select all',
            icon: 'select_all',
            onClick: () => fileSelectAll()
        },
        {
            label: 'Deselect all',
            icon: 'deselect',
            onClick: () => fileDeselectAll()
        },
        {
            label: 'Invert selection',
            icon: 'flip',
            onClick: () => {
                const fileEls = elFiles.querySelectorAll('.file');
                fileEls.forEach(el => {
                    if (el.classList.contains(selectedFileClass)) {
                        el.classList.add(deselectedFileClass);
                        el.classList.remove(selectedFileClass);
                    } else {
                        el.classList.add(selectedFileClass);
                        el.classList.remove(deselectedFileClass);
                    }
                });
                updateActionButtons();
            }
        }
    ], { alignToElement: element });
};

const showSortContextMenu = (event, element = btnActionSort) => {
    showContextMenu(event, [
        {
            label: 'A-Z',
            icon: sortType === 'name' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeSort('name', 'asc')
        },
        {
            label: 'Z-A',
            icon: sortType === 'name_desc' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeSort('name', 'desc')
        },
        {
            label: 'Smallest to largest',
            icon: sortType === 'size' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeSort('size', 'asc')
        },
        {
            label: 'Largest to smallest',
            icon: sortType === 'size_desc' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeSort('size', 'desc')
        },
        {
            label: 'Oldest to newest',
            icon: sortType === 'date' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeSort('date', 'asc')
        },
        {
            label: 'Newest to oldest',
            icon: sortType === 'date_desc' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeSort('date', 'desc')
        }
    ], { alignToElement: element });
};

const showViewContextMenu = (event, element = btnActionView) => {
    showContextMenu(event, [
        {
            label: 'List',
            icon: viewType === 'list' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeView('list', viewSize, viewHidden)
        },
        {
            label: 'Grid',
            icon: viewType === 'grid' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeView('grid', viewSize, viewHidden)
        },
        { type: 'separator' },
        {
            label: 'Compact',
            icon: viewSize === 'small' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeView(viewType, 'small', viewHidden)
        },
        {
            label: 'Comfy',
            icon: viewSize === 'normal' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeView(viewType, 'normal', viewHidden)
        },
        {
            label: 'Spacious',
            icon: viewSize === 'large' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeView(viewType, 'large', viewHidden)
        },
        { type: 'separator' },
        {
            label: 'Hide hidden files',
            icon: !viewHidden ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeView(viewType, viewSize, false)
        },
        {
            label: 'Show hidden files',
            icon: viewHidden ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => changeView(viewType, viewSize, true)
        }
    ], { alignToElement: element });
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
        const res = await api.post('/api/auth/login', {}, { username, password });
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
    await api.post('/api/auth/logout');
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

btnActionNewFolder.addEventListener('click', actions.createFolder);
btnActionDelete.addEventListener('click', actions.delete);
btnActionUpload.addEventListener('click', actions.uploadFiles);
btnActionCut.addEventListener('click', actions.cut);
btnActionCopy.addEventListener('click', actions.copy);
btnActionPaste.addEventListener('click', actions.paste);
btnActionRename.addEventListener('click', actions.rename);
btnActionDownload.addEventListener('click', actions.download);
btnActionCopyLink.addEventListener('click', actions.copyLink);
btnActionSelect.addEventListener('click', (e) => showSelectContextMenu(e, btnActionSelect));
btnActionSort.addEventListener('click', (e) => showSortContextMenu(e, btnActionSort));
btnActionView.addEventListener('click', (e) => showViewContextMenu(e, btnActionView));

btnSortName.addEventListener('click', () => {
    changeSort('name');
});
btnSortSize.addEventListener('click', () => {
    changeSort('size');
});
btnSortDate.addEventListener('click', () => {
    changeSort('date');
});

elFiles.addEventListener('click', (e) => {
    if (e.target === elFiles) {
        fileDeselectAll();
    }
});

elFiles.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (e.target === elFiles) {
        fileDeselectAll();
        showFileContextMenu(e);
    }
});

window.addEventListener('keyup', (e) => {
    const keys = [];
    if (e.ctrlKey || e.metaKey) keys.push('ctrl');
    if (e.shiftKey) keys.push('shift');
    if (e.altKey) keys.push('alt');
    keys.push(e.key.toLowerCase());
    const combo = keys.join('+');
    // Ignore modifier keys
    if (e.key.toLowerCase().match(/^(ctrl|shift|alt|meta)$/)) return;
    // Ignore if not loaded
    if (!isLoaded) return;
    // Ignore if dialog is open
    if (document.querySelector('dialog[open]')) return;
    // Ignore if target is input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    console.log(`Key combo: ${combo}`);
    const handled = handleKeyCombo(combo);
    if (handled) {
        e.preventDefault();
        e.stopPropagation();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    await init();
});

window.addEventListener('popstate', async () => {
    await browseToCurrentPath();
});