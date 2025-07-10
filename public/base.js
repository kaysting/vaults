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
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
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

const systemFilePicker = async (multiple = false, folder = false) => {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = multiple;
        input.accept = '*/*';
        if (folder) {
            input.webkitdirectory = true;
            input.directory = true;
        }
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
            resolve(Array.from(input.files));
            document.body.removeChild(input);
        });
        input.click();
    });
};

const startFileDownload = (url, name = '') => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
};

// --- CONTEXT MENU ---
let activeContextMenu = null;

function hideContextMenu() {
    return new Promise((resolve) => {
        if (activeContextMenu) {
            activeContextMenu.classList.remove('visible');
            setTimeout(() => {
                if (activeContextMenu && activeContextMenu.parentElement) {
                    document.body.removeChild(activeContextMenu);
                    activeContextMenu = null;
                }
                resolve();
            }, 200);
            document.removeEventListener('click', hideContextMenu);
        } else {
            resolve();
        }
    });
}

async function showContextMenu(event, items, options = {}) {
    event.preventDefault();
    await hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    document.body.appendChild(menu);
    activeContextMenu = menu;

    items.forEach(itemConfig => {
        if (itemConfig.type === 'separator') {
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator flex-no-shrink';
            menu.appendChild(separator);
        } else {
            const item = document.createElement('button');
            item.className = 'btn btn-text context-menu-item';
            if (itemConfig.icon) {
                const iconEl = document.createElement('span');
                iconEl.className = 'material-symbols-outlined icon';
                iconEl.textContent = itemConfig.icon;
                item.appendChild(iconEl);
            } else {
                const placeholder = document.createElement('span');
                placeholder.style.width = '20px';
                item.appendChild(placeholder);
            }
            const labelEl = document.createElement('span');
            labelEl.className = 'label';
            labelEl.textContent = itemConfig.label;
            item.appendChild(labelEl);
            if (itemConfig.shortcut) {
                const shortcutEl = document.createElement('span');
                shortcutEl.className = 'shortcut';
                shortcutEl.textContent = itemConfig.shortcut;
                item.appendChild(shortcutEl);
            }
            item.addEventListener('click', (e) => {
                if (itemConfig.onClick) itemConfig.onClick(e);
                hideContextMenu();
            });
            menu.appendChild(item);
        }
    });

    const { clientX, clientY } = event;
    const { innerWidth, innerHeight } = window;
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;

    let x, y;

    if (options.alignToElement) {
        const rect = options.alignToElement.getBoundingClientRect();
        x = rect.left + window.scrollX;
        y = rect.bottom + window.scrollY - 5; // Position below the element
    } else {
        x = clientX;
        y = clientY;
    }

    if (x + menuWidth > innerWidth) x = innerWidth - menuWidth - 5;
    if (y + menuHeight > innerHeight) y = innerHeight - menuHeight - 5;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    setTimeout(() => menu.classList.add('visible'), 10);
    setTimeout(() => document.addEventListener('click', hideContextMenu), 0);

    return menu;
}


// --- MODAL DIALOG (REWRITTEN) ---
function showModal({ title, bodyContent, actions, width = 500, grow = true }) {
    const modalElement = document.createElement('dialog');
    modalElement.className = 'modal-dialog';
    modalElement.style.maxWidth = `${width}px`;
    if (grow) modalElement.style.width = '100%';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    const modalTitle = document.createElement('span');
    modalTitle.id = 'modal-title';
    modalTitle.textContent = title;
    const modalCloseBtn = document.createElement('button');
    modalCloseBtn.className = 'btn btn-text btn-icon';
    modalCloseBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(modalCloseBtn);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    modalBody.appendChild(bodyContent);

    const modalFooter = document.createElement('div');
    modalFooter.className = 'modal-footer';
    actions.forEach(actionConfig => {
        const button = document.createElement('button');
        button.textContent = actionConfig.label;
        button.className = `btn ${actionConfig.class || 'btn-secondary'}`;
        button.addEventListener('click', () => {
            if (actionConfig.onClick) {
                actionConfig.onClick();
            }
            if (actionConfig.preventClose !== true) {
                closeCustomModal(modalElement);
            }
        });
        modalFooter.appendChild(button);
    });

    modalElement.appendChild(modalHeader);
    modalElement.appendChild(modalBody);
    modalElement.appendChild(modalFooter);
    document.body.appendChild(modalElement);

    const closeCustomModal = (modal) => {
        modal.classList.remove('is-open');
        setTimeout(() => {
            if (modal.parentElement) {
                modal.close();
                document.body.removeChild(modal);
            }
        }, 250);
    };

    modalCloseBtn.addEventListener('click', () => {
        closeCustomModal(modalElement);
    });

    modalElement.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeCustomModal(modalElement);
    });

    modalElement.addEventListener('close', (event) => {
        event.preventDefault();
        closeCustomModal(modalElement);
    });

    modalElement.showModal();
    setTimeout(() => {
        modalElement.classList.add('is-open');
    }, 10);

    return modalElement;
}

/**
 * Creates and shows a toast notification.
 * @param {Object} options - The toast configuration.
 * @returns {Object} A controller for the toast with `updateProgress` and `close` methods.
 */
function showToast({ message, description, type = 'info', icon, duration = 5000, progressBar = false, actions = [], persistent = false }) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';

    let toastIconHTML = '';
    const finalIcon = icon || { success: 'check_circle', danger: 'error', info: 'info' }[type];
    if (finalIcon) {
        toastIconHTML = `<div class="toast-icon ${type}"><span class="material-symbols-outlined">${finalIcon}</span></div>`;
    }

    let actionsHTML = '';
    if (actions.length > 0) {
        actionsHTML = '<div class="toast-actions">';
        actions.forEach((action, index) => {
            const btnId = `toast-action-${Date.now()}-${index}`;
            if (action.style === 'icon') {
                actionsHTML += `<button class="btn btn-text btn-icon" id="${btnId}"><span class="material-symbols-outlined">${action.label}</span></button>`;
            } else {
                actionsHTML += `<button class="btn btn-text" id="${btnId}">${action.label}</button>`;
            }
        });
        actionsHTML += '</div>';
    }

    let progressBarHTML = '';
    if (progressBar) {
        progressBarHTML = `<div class="toast-progress-bar"></div>`;
    }

    // Add description support
    let descriptionHTML = '';
    if (description) {
        descriptionHTML = `<div class="toast-description">${description}</div>`;
    }

    toast.innerHTML = `
        ${toastIconHTML}
        <div class="toast-content">
            <div class="toast-message"></div>
            ${descriptionHTML}
        </div>
        ${actionsHTML}
        ${progressBarHTML}
    `;
    toast.querySelector('.toast-message').textContent = message;

    container.appendChild(toast);

    // Track progress for progressBar to prevent auto-close if not finished
    let progressPercent = progressBar ? 0 : 100;
    let autoCloseTimeout = null;

    const closeToast = () => {
        toast.classList.add('is-closing');
        toast.addEventListener('animationend', () => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, { once: true });
    };

    // Attach click listeners to action buttons
    actions.forEach((action, index) => {
        const buttonId = `toast-action-${Date.now()}-${index}`;
        const button = toast.querySelector(`#${buttonId}`);
        if (button) {
            button.addEventListener('click', () => {
                action.onClick();
                // Don't auto-close for persistent toasts unless specified
                if (!persistent) {
                    closeToast();
                }
            });
        }
    });

    // Only auto-close if not persistent and either no progressBar or progressBar is complete
    const maybeAutoClose = () => {
        if (!persistent && (!progressBar || progressPercent >= 100)) {
            autoCloseTimeout = setTimeout(closeToast, duration);
        }
    };

    maybeAutoClose();

    return {
        updateProgress: (percent) => {
            progressPercent = percent;
            const bar = toast.querySelector('.toast-progress-bar');
            if (bar) {
                bar.style.width = `${percent}%`;
            }
            // If progress reaches 100%, start auto-close timer if not already started
            if (progressBar && percent >= 100 && !persistent && !autoCloseTimeout) {
                autoCloseTimeout = setTimeout(closeToast, duration);
            }
        },
        updateMessage: (newMessage) => {
            const msgEl = toast.querySelector('.toast-message');
            if (msgEl) msgEl.textContent = newMessage;
        },
        updateDescription: (newDescription) => {
            let descEl = toast.querySelector('.toast-description');
            if (!descEl && newDescription) {
                // If description didn't exist, add it
                descEl = document.createElement('div');
                descEl.className = 'toast-description';
                toast.querySelector('.toast-content').appendChild(descEl);
            }
            if (descEl) descEl.textContent = newDescription || '';
            if (descEl && !newDescription) descEl.remove();
        },
        close: closeToast
    };
}

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