let authToken = localStorage.getItem('token');
let username = '';
let colorMode = localStorage.getItem('colorMode') || 'auto';
let colorHue = localStorage.getItem('colorHue') || 'blue';
let sortType = localStorage.getItem('sortType') || 'name';
let sortOrder = localStorage.getItem('sortOrder') || 'asc';
let viewType = localStorage.getItem('viewType') || 'list';
let viewSize = localStorage.getItem('viewSize') || 'normal';
let viewHidden = (localStorage.getItem('viewHidden') === 'true') || false;
let currentVault = null;
let currentPath = '';
let isLoaded = false;
let clipboard = [];
let clipboardType = null;
let lastSelectedFileIndex = -1;
const navHistory = {
    back: [],
    forward: []
};

const api = initApi(authToken);

const generateDownloadLink = async (vault, paths = []) => {
    const resCreate = await api.files.downloadCreate(vault);
    if (resCreate.code) throw new Error(resCreate.message);
    const token = resCreate.token;
    const resAdd = await api.files.downloadAdd(token, vault, paths);
    if (resAdd.code) throw new Error(resAdd.message);
    const resGet = await api.files.downloadGet(token);
    if (resGet.code) throw new Error(resGet.message);
    const url = encodeURI(window.location.origin + resGet.url);
    console.log(`Download link generated: ${url}`);
    return url;
};

const generateDownloadLinkFromSelection = async () => {
    const selectedFiles = getSelectedFiles();
    const paths = selectedFiles.map(f => f.path);
    if (paths.length === 0) paths.push(currentPath);
    return await generateDownloadLink(currentVault, paths);
};

const uploadFiles = async files => {
    // Restructure files array
    files = files.map(file => ({
        File: file,
        name: file.name,
        pathRel: file.webkitRelativePath || file.relativePath || file.name,
        size: file.size
    }));
    console.log(files);
    // Initialize upload state
    const uploadedPaths = [];
    const bytesPerChunk = 1024 * 1024 * 4;
    const bytesTotal = files.reduce((sum, file) => sum + file.size, 0);
    let bytesTotalUploaded = 0;
    let filesUploaded = 0;
    const startTime = Date.now();
    const vault = currentVault;
    const basePath = currentPath;
    // Create progress toast
    const toast = showToast({
        icon: 'upload',
        message: files.length == 1 ? `Uploading ${files[0].name}...` : `Uploading ${files.length} files...`,
        progressBar: true
    });
    // Function to update the progress toast
    const updateToast = () => {
        toast.updateProgress((bytesTotalUploaded / bytesTotal) * 100);
        const secsElapsed = (Date.now() - startTime) / 1000;
        const bytesPerSec = bytesTotalUploaded / secsElapsed;
        const secsRemaining = Math.round((bytesTotal - bytesTotalUploaded) / bytesPerSec);
        const filesRemaining = files.length - filesUploaded;
        toast.updateDescription(`${filesRemaining} file${filesRemaining > 1 ? 's' : ''}, ${msToRelativeTime(secsRemaining * 1000).toLowerCase()} left (${formatBytes(bytesPerSec)}/s)`);
    };
    // Create all uploads
    const createResults = [];
    let i = 1;
    for (const file of files) {
        const resCreate = await api.files.uploadCreate(vault, `${basePath}/${file.pathRel}`, file.size);
        toast.updateDescription(`Initializing ${i}/${files.length}...`);
        createResults.push({ file, resCreate });
        i++;
    }
    // Find files that already exist
    const existsFiles = createResults.filter(r => r.resCreate.code === 'exists');
    let overwriteFiles = [];
    if (existsFiles.length > 0) {
        // Prompt user to replace or skip
        overwriteFiles = await promptOverwriteFiles(existsFiles, 'file');
    }
    // For files to overwrite, re-create with overwrite: true
    for (const file of overwriteFiles) {
        const idx = createResults.findIndex(r => r.file === file);
        createResults[idx].resCreate = await api.files.uploadCreate(vault, `${basePath}/${file.pathRel}`, file.size, true);
    }
    // Upload all files that have a valid token
    for (const { file, resCreate } of createResults) {
        if (resCreate.code && resCreate.code !== 'exists') {
            showToast({
                type: 'danger',
                icon: 'error',
                message: `Failed to start upload for ${file.pathRel}: ${resCreate.message}`
            });
            filesUploaded++;
            continue;
        }
        if (resCreate.code === 'exists' && !overwriteFiles.includes(file)) {
            // User chose to skip this file
            filesUploaded++;
            continue;
        }
        const uploadToken = resCreate.token;
        const overwrite = overwriteFiles.includes(file);
        try {
            // Read and upload chunks without loading the whole file into memory
            const maxConcurrency = 4;
            const totalChunks = Math.ceil(file.size / bytesPerChunk);
            let nextChunkIndex = 0;
            let activeUploads = 0;
            let errorOccurred = false;

            const uploadChunk = (chunkIndex) => {
                return new Promise((resolve, reject) => {
                    const start = chunkIndex * bytesPerChunk;
                    const end = Math.min(start + bytesPerChunk, file.size);
                    const blob = file.File.slice(start, end);
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        try {
                            const chunk = e.target.result;
                            const res = await api.files.upload(chunk, start, uploadToken, vault, (progress) => {
                                bytesTotalUploaded += progress.bytes;
                                updateToast();
                            });
                            if (res.code) throw new Error(res);
                            updateToast();
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    };
                    reader.onerror = (err) => reject(new Error(`File read error: ${err}`));
                    reader.readAsArrayBuffer(blob);
                });
            };

            // Run up to maxConcurrency chunk uploads at a time
            await new Promise((resolve, reject) => {
                let finished = 0;
                function next() {
                    if (errorOccurred) return;
                    if (finished === totalChunks) return resolve();
                    while (activeUploads < maxConcurrency && nextChunkIndex < totalChunks) {
                        const chunkIdx = nextChunkIndex++;
                        activeUploads++;
                        uploadChunk(chunkIdx).then(() => {
                            activeUploads--;
                            finished++;
                            next();
                        }).catch(err => {
                            errorOccurred = true;
                            reject(err);
                        });
                    }
                }
                next();
            });

            // Finalize the upload (with overwrite if needed)
            console.log(file.pathRel, overwrite);
            const resFinalize = await api.files.uploadFinalize(uploadToken, vault, overwrite);
            if (resFinalize.code) throw new Error(resFinalize.message);
            uploadedPaths.push(resFinalize.path);
        } catch (error) {
            showToast({
                type: 'danger',
                icon: 'error',
                message: `Failed to upload ${file.pathRel}: ${error.message}`
            });
        }
        filesUploaded++;
    }
    toast.close();
    showToast({
        type: 'success',
        icon: 'upload',
        message: uploadedPaths.length == 1 ? `Uploaded ${uploadedPaths[0].split('/').pop()}!` : `Uploaded ${uploadedPaths.length} files!`
    });
    if (vault == currentVault && currentPath == basePath) {
        await browse(currentVault, currentPath, false, uploadedPaths);
    }
};

const setStatus = (text, danger = false) => {
    elStatus.textContent = text;
    elStatus.classList.toggle('danger', danger);
};

const addToHistory = (history, path) => {
    if (history[history.length - 1] !== path) {
        history.push(path);
    }
};

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

const fileSelectBetweenIndexes = (start, end) => {
    fileDeselectAll();
    const fileEls = Array.from(elFiles.querySelectorAll('.file'));
    for (let j = start; j <= end; j++) {
        const btn = fileEls[j];
        btn.classList.add(selectedFileClass);
        btn.classList.remove(deselectedFileClass);
    }
};

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

const updateNavButtons = () => {
    btnNavBack.disabled = navHistory.back.length === 0;
    btnNavForward.disabled = navHistory.forward.length === 0;
    btnNavUp.disabled = !currentPath || currentPath === '/';
    btnRefresh.disabled = !currentVault;
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

const changeSort = (type, order) => {
    if (sortType === type && !order) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        sortType = type;
        sortOrder = order || 'asc';
    }
    // Save to localStorage
    localStorage.setItem('sortType', sortType);
    localStorage.setItem('sortOrder', sortOrder);
    elBrowser.dataset.sortType = sortType;
    elBrowser.dataset.sortOrder = sortOrder;
    browse(currentVault, currentPath, false);
};

const changeView = (type, size, hidden) => {
    viewType = type || 'list';
    viewSize = size || 'normal';
    viewHidden = hidden || false;
    // Save to localStorage
    localStorage.setItem('viewType', viewType);
    localStorage.setItem('viewSize', viewSize);
    localStorage.setItem('viewHidden', viewHidden);
    elBrowser.dataset.viewType = viewType;
    elBrowser.dataset.viewSize = viewSize;
    elBrowser.dataset.viewHidden = viewHidden;
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
                        const res = await api.files.folderCreate(currentVault, currentPath + '/' + elInput.value);
                        elModal.close();
                        showToast({
                            type: 'success',
                            icon: 'check_circle',
                            message: `Folder created!`
                        });
                        browse(currentVault, currentPath, false, [res.path]);
                    } catch (error) {
                        elText.textContent = error.message;
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
        let filename;
        if (selectedFiles.length === 1) {
            filename = selectedFiles[0].path.split('/').pop();
        } else {
            const folderCount = selectedFiles.filter(f => f.isDirectory).length;
            const fileCount = selectedFiles.length - folderCount;
            if (fileCount > 0 && folderCount > 0) {
                filename = `${fileCount} file${fileCount === 1 ? '' : 's'} and ${folderCount} folder${folderCount === 1 ? '' : 's'}`;
            } else if (fileCount > 0) {
                filename = `${fileCount} file${fileCount === 1 ? '' : 's'}`;
            } else if (folderCount > 0) {
                filename = `${folderCount} folder${folderCount === 1 ? '' : 's'}`;
            } else {
                filename = '';
            }
        }
        el.innerHTML = /*html*/`
            <p>Are you sure you want to delete ${filename}?</p>
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
                    let filename;
                    for (const file of selectedFiles) {
                        try {
                            filename = file.path.split('/').pop();
                            toast.updateMessage(selectedFiles.length === 1 ? `Deleting ${filename}...` : `Deleting ${selectedFiles.length} files...`);
                            await api.files.delete(currentVault, file.path);
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
                    toast.close();
                    showToast({
                        type: 'success',
                        icon: 'delete',
                        message: countSuccess == 1 ? `Deleted ${filename}!` : `Deleted ${countSuccess} files!`
                    });
                    await browse(currentVault, currentPath, false);
                }
            }, {
                label: 'Cancel'
            }]
        });
    },
    uploadSelectFiles: async () => {
        const files = await systemFilePicker(true);
        uploadFiles(files);
    },
    uploadSelectFolder: async () => {
        const files = await systemFilePicker(false, true);
        uploadFiles(files);
    },
    cut: async () => {
        const selectedFiles = getSelectedFiles();
        const selectedPaths = selectedFiles.map(f => f.path);
        clipboard = selectedPaths;
        clipboardType = 'cut';
        showToast({
            type: 'success',
            icon: 'content_cut',
            message: `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} cut to clipboard!`
        });
        updateActionButtons();
    },
    copy: async () => {
        const selectedFiles = getSelectedFiles();
        const selectedPaths = selectedFiles.map(f => f.path);
        clipboard = selectedPaths;
        clipboardType = 'copy';
        showToast({
            type: 'success',
            icon: 'content_copy',
            message: `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} copied to clipboard!`
        });
        updateActionButtons();
    },
    paste: async () => {
        const paths = clipboard;
        const type = clipboardType;
        clipboard = [];
        clipboardType = null;
        updateActionButtons();

        if (!paths.length) return;

        // Prepare file info for progress and overwrite checks
        const filesToProcess = paths.map(pathSrc => {
            const destName = pathSrc.split('/').pop();
            const pathDest = `${currentPath}/${destName}`;
            return { pathSrc, pathDest, destName };
        });

        // Step 1: Check for existing destination files/folders
        const checkExistence = async (vault, fileList) => {
            // Use api.files.list to get current directory contents
            const res = await api.files.list(vault, currentPath);
            if (res.code) throw new Error(res.message);
            const existingNames = new Set(res.files.map(f => f.name));
            return fileList.filter(f => existingNames.has(f.destName));
        };

        let existsFiles = [];
        try {
            existsFiles = await checkExistence(currentVault, filesToProcess);
        } catch (err) {
            showToast({ type: 'danger', icon: 'error', message: `Paste failed: ${err.message}` });
            return;
        }

        let overwriteFiles = [];
        if (existsFiles.length > 0) {
            // Prompt user to replace or skip
            overwriteFiles = await promptOverwriteFiles(
                existsFiles.map(f => ({ file: f })), type === 'cut' ? 'file/folder' : 'file/folder'
            );
        }

        // Step 2: Start progress toast
        let filesProcessed = 0;
        let countSuccess = 0;
        const pastedPaths = [];
        const toast = showToast({
            icon: type === 'cut' ? 'content_cut' : 'content_copy',
            message: `${type === 'cut' ? 'Moving' : 'Copying'} ${filesToProcess.length} item${filesToProcess.length === 1 ? '' : 's'}...`,
            progressBar: true
        });

        // Step 3: Process each file/folder
        for (const file of filesToProcess) {
            const overwrite = overwriteFiles.some(f => f.pathSrc === file.pathSrc);
            // If file exists and not overwriting, skip
            if (existsFiles.some(f => f.pathSrc === file.pathSrc) && !overwrite) {
                filesProcessed++;
                toast.updateProgress((filesProcessed / filesToProcess.length) * 100);
                continue;
            }
            try {
                let res;
                if (type === 'cut') {
                    res = await api.files.move(currentVault, file.pathSrc, file.pathDest, overwrite);
                } else {
                    res = await api.files.copy(currentVault, file.pathSrc, file.pathDest, overwrite);
                }
                if (res.code) throw new Error(res.message);
                countSuccess++;
                pastedPaths.push(file.pathDest);
            } catch (error) {
                showToast({
                    type: 'danger',
                    icon: 'error',
                    message: `Failed to ${type === 'cut' ? 'move' : 'copy'} ${file.destName}: ${error.message}`
                });
            }
            filesProcessed++;
            toast.updateProgress((filesProcessed / filesToProcess.length) * 100);
        }
        toast.close();
        showToast({
            type: 'success',
            icon: type === 'cut' ? 'content_cut' : 'content_copy',
            message: `${type === 'cut' ? 'Moved' : 'Copied'} ${countSuccess} item${countSuccess === 1 ? '' : 's'}!`
        });
        // Select pasted files if still in same directory
        if (currentPath === filesToProcess[0]?.pathDest.split('/').slice(0, -1).join('/')) {
            await browse(currentVault, currentPath, false, pastedPaths);
        } else {
            await browse(currentVault, currentPath, false);
        }
    },
    rename: async () => {
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length !== 1) return;
        const file = selectedFiles[0];
        const oldName = file.path.split('/').pop();
        const extIndex = oldName.lastIndexOf('.');
        const baseName = extIndex > 0 ? oldName.slice(0, extIndex) : oldName;
        const ext = extIndex > 0 ? oldName.slice(extIndex) : '';
        const el = document.createElement('div');
        el.innerHTML = /*html*/`
            <div class="form-field">
                <input type="text" class="textbox" value="${oldName}">
                <div class="form-text text-danger text-left d-none"></div>
            </div>
        `;
        const elInput = el.querySelector('input');
        const elText = el.querySelector('.form-text');
        const elModal = showModal({
            width: 400,
            title: 'Rename file',
            bodyContent: el,
            actions: [{
                label: 'Rename',
                class: 'btn-primary',
                preventClose: true,
                onClick: async () => {
                    const newName = elInput.value.trim();
                    if (!newName) {
                        elText.textContent = 'Name cannot be empty.';
                        elText.classList.remove('d-none');
                        return;
                    }
                    if (/[\\/:\*\?"<>\|]/.test(newName)) {
                        elText.textContent = `That character isn't allowed.`;
                        elText.classList.remove('d-none');
                        return;
                    }
                    if (newName === oldName) {
                        elModal.close();
                        return;
                    }
                    const destPath = file.path.split('/').slice(0, -1).concat(newName).join('/');
                    try {
                        await api.files.move(currentVault, file.path, destPath);
                        elModal.close();
                        showToast({
                            type: 'success',
                            icon: 'drive_file_rename_outline',
                            message: `Renamed to ${newName}!`
                        });
                        await browse(currentVault, currentPath, false, [destPath]);
                    } catch (error) {
                        elText.textContent = error.message;
                        elText.classList.remove('d-none');
                    }
                }
            }, {
                label: 'Cancel'
            }]
        });
        elInput.focus();
        // Select only the base name, not the extension
        if (baseName) {
            elInput.setSelectionRange(0, baseName.length);
        }
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
                const btnRename = elModal.querySelector('.btn-primary');
                btnRename.click();
            }
        });
    },
    download: async () => {
        const url = await generateDownloadLinkFromSelection();
        startFileDownload(url);
    },
    copyLink: async () => {
        const url = await generateDownloadLinkFromSelection();
        try {
            await navigator.clipboard.writeText(url);
            showToast({
                type: 'success',
                icon: 'check_circle',
                message: `Download link copied to clipboard!`
            });
        } catch (err) {
            showToast({
                type: 'danger',
                icon: 'error',
                message: `Failed to copy download link. Here it is: ${url}`
            });
        }
    },
    open: async (file) => {
        if (file.isDirectory) {
            return await browse(currentVault, file.path);
        }
        const url = await generateDownloadLink(currentVault, [file.path]);
        startFileDownload(url, file.name);
    }
};

// Reusable skip/replace prompt for overwrite conflicts
const promptOverwriteFiles = async (existsFiles, singleLabel = 'file') => {
    let overwriteFiles = [];
    await new Promise((resolve) => {
        const el = document.createElement('div');
        // Fix: always show a valid name for the file/folder
        const getName = file =>
            file.destName ||
            file.pathRel ||
            file.name ||
            (file.file && (file.file.destName || file.file.pathRel || file.file.name)) ||
            'unknown';
        el.innerHTML = /*html*/`
            <p>${existsFiles.length === 1
                ? `The ${singleLabel} <b>${getName(existsFiles[0].file || existsFiles[0])}</b> already exists.`
                : `${existsFiles.length} ${singleLabel}s already exist.`} Do you want to replace ${existsFiles.length === 1 ? 'it' : 'them'}?</p>
        `;
        const elModal = showModal({
            title: `${singleLabel[0].toUpperCase() + singleLabel.slice(1)}s already exist`,
            bodyContent: el,
            actions: [
                {
                    label: 'Replace',
                    class: 'btn-danger',
                    onClick: () => {
                        overwriteFiles = existsFiles.map(r => r.file || r);
                        resolve();
                    }
                },
                {
                    label: 'Skip',
                    class: 'btn-secondary',
                    onClick: () => {
                        overwriteFiles = [];
                        resolve();
                    }
                }
            ]
        });
        elModal.addEventListener('close', () => {
            resolve();
        });
    });
    return overwriteFiles;
};

const showFileContextMenu = (e) => {
    const states = getActionStates();
    const item = {
        upload: {
            icon: 'upload_file',
            label: 'Upload files...',
            onClick: actions.uploadSelectFiles
        },
        uploadFolder: {
            icon: 'drive_folder_upload',
            label: 'Upload folder...',
            onClick: actions.uploadSelectFolder
        },
        createFolder: {
            icon: 'create_new_folder',
            label: 'Create folder...',
            shortcut: 'Shift + N',
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
            shortcut: 'Ctrl + X',
            onClick: actions.cut
        },
        copy: {
            icon: 'content_copy',
            label: 'Copy',
            shortcut: 'Ctrl + C',
            onClick: actions.copy
        },
        paste: {
            icon: 'content_paste',
            label: 'Paste',
            shortcut: 'Ctrl + V',
            onClick: actions.paste
        },
        rename: {
            icon: 'drive_file_rename_outline',
            label: 'Rename..',
            shortcut: 'N',
            onClick: actions.rename
        },
        delete: {
            icon: 'delete',
            label: 'Delete...',
            shortcut: 'Del',
            onClick: actions.delete
        },
        download: {
            icon: 'download',
            label: states.downloadLabel,
            shortcut: 'Shift + D',
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
                setTimeout(() => {
                    showSelectContextMenu(e, null);
                }, 100);
            }
        },
        sort: {
            icon: 'sort',
            label: 'Sort...',
            onClick: (e) => {
                setTimeout(() => {
                    showSortContextMenu(e, null);
                }, 0);
            }
        },
        view: {
            icon: 'view_list',
            label: 'View...',
            onClick: (e) => {
                setTimeout(() => {
                    showViewContextMenu(e, null);
                }, 0);
            }
        },
        sep: { type: 'separator' }
    };
    let items = [];
    if (states.countSelected == 0) {
        items.push(item.upload, item.uploadFolder, item.createFolder, item.sep);
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

const browse = async (vault, path = '/', shouldPushState = true, selectFiles = []) => {
    setStatus('Loading files...');
    const isLoadedOld = isLoaded;
    isLoaded = false;
    updateActionButtons();
    let res;
    try {
        res = await api.files.list(vault, path);
        if (res.code) throw new Error(res.message);
    } catch (error) {
        setStatus(error.message, true);
        isLoaded = isLoadedOld;
        elBreadcrumbs.innerHTML = '';
        elBreadcrumbs.innerHTML = /*html*/`
            <button class="btn btn-text current">Vaults</button>
        `;
        return;
    }
    if (shouldPushState) {
        addToHistory(navHistory.back, currentPath);
        navHistory.forward = [];
    }
    if (vault !== currentVault) {
        clipboard = [];
        clipboardType = null;
    }
    currentVault = vault;
    currentPath = res.path;
    lastSelectedFileIndex = -1;
    updateNavButtons();
    if (shouldPushState)
        window.history.pushState({}, '', `/${vault}${res.path}`);
    document.title = `Vaults - ${vault} / ${res.path.split('/').filter(Boolean).join(' / ')}`;
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
                const start = Math.min(lastSelectedFileIndex, index);
                const end = Math.max(lastSelectedFileIndex, index);
                fileSelectBetweenIndexes(start, end);
                lastSelectedFileIndex = index;
            } else {
                if (e.ctrlKey && isSelected) {
                    fileDeselect(file.path);
                    return;
                }
                if (!e.ctrlKey) fileDeselectAll();
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
            // If file isn't selected, deselect all and select it
            if (!elFile.classList.contains(selectedFileClass)) {
                fileDeselectAll();
                fileSelect(file.path);
                lastSelectedFileIndex = index;
            }
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
    const res = await api.vaults.list();
    if (res.code) {
        showToast({ type: 'danger', icon: 'error', message: res.message });
        return;
    }
    res.vaults.sort((a, b) => a.name.localeCompare(b.name));
    for (const vault of res.vaults) {
        const elVault = document.createElement('button');
        elVault.className = 'btn btn-text vault';
        elVault.innerHTML = /*html*/`
            <span class="material-symbols-outlined">dns</span>
            <div class="d-flex flex-col gap-2 flex-grow">
                <span class="name"></span>
                <span class="small">${vault.users.length} member${vault.users.length == 1 ? '' : 's'}</span>
                <span class="small">${formatBytes(vault.storage_bytes_available)} available</span>
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

const init = async () => {
    let isLoggedIn = false;
    try {
        const res = await api.auth.get();
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
    } else if (combo === 'n' && states.canRename) {
        actions.rename();
    } else {
        return false;
    }
    return true;
};

const updateAppearance = () => {
    let mode = colorMode;
    let hue = colorHue;
    if (mode == 'auto')
        mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.body.dataset.colorMode = mode;
    document.body.style.setProperty('--hue', colorHues[hue] || colorHues.blue);
};

btnLogin.addEventListener('click', async (e) => {
    e.preventDefault();
    btnLogin.disabled = true;
    const username = inputLoginUsername.value.trim();
    const password = inputLoginPassword.value.trim();
    loginFormText.classList.add('d-none');
    try {
        const res = await api.auth.login(username, password);
        authToken = res.token;
        localStorage.setItem('token', authToken);
        await init();
    } catch (error) {
        loginFormText.textContent = error.message || 'Login failed';
        loginFormText.classList.remove('d-none');
    } finally {
        btnLogin.disabled = false;
    }
});

btnLogout.addEventListener('click', async (e) => {
    await api.auth.logout();
    localStorage.clear();
    window.location.href = '/';
});

btnAppearance.addEventListener('click', (e) => {
    showContextMenu(e, [
        {
            label: 'Light',
            icon: colorMode === 'light' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => {
                colorMode = 'light';
                localStorage.setItem('colorMode', colorMode);
                updateAppearance();
            }
        },
        {
            label: 'Dark',
            icon: colorMode === 'dark' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => {
                colorMode = 'dark';
                localStorage.setItem('colorMode', colorMode);
                updateAppearance();
            }
        },
        {
            label: 'Auto',
            icon: colorMode === 'auto' ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => {
                colorMode = 'auto';
                localStorage.setItem('colorMode', colorMode);
                updateAppearance();
            }
        },
        { type: 'separator' },
        ...Object.entries(colorHues).map(([key, value]) => ({
            label: key.substring(0, 1).toUpperCase() + key.substring(1),
            icon: colorHue === key ? 'radio_button_checked' : 'radio_button_unchecked',
            onClick: () => {
                colorHue = key;
                localStorage.setItem('colorHue', colorHue);
                updateAppearance();
            }
        }))
    ], { alignToElement: btnAppearance });
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
    loadVaults();
    browse(currentVault, currentPath, false);
});

btnActionUpload.addEventListener('click', (e) => {
    showContextMenu(e, [
        {
            label: 'Upload files...',
            icon: 'upload_file',
            onClick: actions.uploadSelectFiles
        },
        {
            label: 'Upload folder...',
            icon: 'drive_folder_upload',
            onClick: actions.uploadSelectFolder
        }
    ], { alignToElement: btnActionUpload });
});
btnActionNewFolder.addEventListener('click', actions.createFolder);
btnActionDelete.addEventListener('click', actions.delete);
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

elBrowser.addEventListener('click', (e) => {
    if (e.target === elBrowser || e.target === elFiles) {
        fileDeselectAll();
    }
});

elBrowser.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (e.target === elBrowser || e.target === elFiles) {
        fileDeselectAll();
        showFileContextMenu(e);
    }
});

elBrowser.addEventListener('dragover', (e) => {
    e.preventDefault();
    elFiles.classList.add('dragover');
});

elBrowser.addEventListener('dragleave', (e) => {
    if (e.target === elFiles) {
        elFiles.classList.remove('dragover');
    }
});

elBrowser.addEventListener('drop', async (e) => {
    e.preventDefault();
    elFiles.classList.remove('dragover');
    const items = e.dataTransfer.items;
    if (items && items.length > 0 && items[0].webkitGetAsEntry) {
        // Handle folders and files using DataTransferItemList API
        const getAllFiles = async (items) => {
            const files = [];
            const traverseEntry = async (entry, path = '') => {
                if (entry.isFile) {
                    await new Promise((resolve) => {
                        entry.file(file => {
                            // Set both relativePath and webkitRelativePath for consistency
                            file.relativePath = path + file.name;
                            file.webkitRelativePath = path + file.name;
                            files.push(file);
                            resolve();
                        });
                    });
                } else if (entry.isDirectory) {
                    const reader = entry.createReader();
                    await new Promise((resolve, reject) => {
                        const readEntries = () => {
                            reader.readEntries(async (entries) => {
                                if (!entries.length) {
                                    resolve();
                                    return;
                                }
                                for (const ent of entries) {
                                    await traverseEntry(ent, path + entry.name + '/');
                                }
                                readEntries();
                            }, reject);
                        };
                        readEntries();
                    });
                }
            };
            for (const item of items) {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    await traverseEntry(entry, '');
                }
            }
            return files;
        };
        const files = await getAllFiles(items);
        if (files.length > 0) {
            uploadFiles(files);
        }
    } else {
        // Fallback: just files
        const files = Array.from(e.dataTransfer.files).filter(file => file.type !== "");
        // Set webkitRelativePath for consistency if not present
        files.forEach(file => {
            if (!file.webkitRelativePath) {
                file.webkitRelativePath = file.name;
            }
        });
        if (files.length > 0) {
            uploadFiles(files);
        }
    }
});

window.addEventListener('keydown', (e) => {
    if (e.repeat) return; // Ignore repeated keys
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

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateAppearance);

document.addEventListener('DOMContentLoaded', async () => {
    updateAppearance();
    await init();
});

window.addEventListener('popstate', async () => {
    await browseToCurrentPath();
});