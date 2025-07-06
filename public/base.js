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



// --- CONTEXT MENU ---
let activeContextMenu = null;

function hideContextMenu() {
    if (activeContextMenu) {
        activeContextMenu.classList.remove('visible');
        setTimeout(() => {
            if (activeContextMenu && activeContextMenu.parentElement) {
                document.body.removeChild(activeContextMenu);
                activeContextMenu = null;
            }
        }, 200);
        document.removeEventListener('click', hideContextMenu);
    }
}

function showContextMenu(event, items) {
    event.preventDefault();
    hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    document.body.appendChild(menu);
    activeContextMenu = menu;

    items.forEach(itemConfig => {
        if (itemConfig.type === 'separator') {
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator';
            menu.appendChild(separator);
        } else {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
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
            item.addEventListener('click', () => {
                if (itemConfig.onClick) itemConfig.onClick();
                hideContextMenu();
            });
            menu.appendChild(item);
        }
    });

    const { clientX, clientY } = event;
    const { innerWidth, innerHeight } = window;
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    let x = clientX;
    let y = clientY;
    if (clientX + menuWidth > innerWidth) x = innerWidth - menuWidth - 5;
    if (clientY + menuHeight > innerHeight) y = innerHeight - menuHeight - 5;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    setTimeout(() => menu.classList.add('visible'), 10);
    setTimeout(() => document.addEventListener('click', hideContextMenu), 0);
}


// --- MODAL DIALOG (REWRITTEN) ---
const modalElement = document.getElementById('custom-modal');
const modalTitle = document.getElementById('modal-title');
const modalHeaderActions = document.getElementById('modal-header-actions');
const modalBody = document.getElementById('modal-body');
const modalFooter = document.getElementById('modal-footer');

let isClosing = false;
let persistentKeydownHandler = null;

function closeCustomModal() {
    if (isClosing) return;
    isClosing = true;
    modalElement.classList.remove('is-open');
    setTimeout(() => {
        modalElement.close();
        isClosing = false;
    }, 250);
}

modalElement.addEventListener('close', () => {
    modalElement.classList.remove('is-open');
    if (persistentKeydownHandler) {
        document.removeEventListener('keydown', persistentKeydownHandler);
        persistentKeydownHandler = null;
    }
});

function showModal({ title, bodyContent, actions, isDismissable = true }) {
    if (persistentKeydownHandler) {
        document.removeEventListener('keydown', persistentKeydownHandler);
        persistentKeydownHandler = null;
    }
    modalElement.removeEventListener('cancel', handleCancel);

    modalTitle.textContent = title;
    modalBody.innerHTML = '';
    modalBody.appendChild(bodyContent);
    modalHeaderActions.innerHTML = '';
    modalFooter.innerHTML = '';

    if (isDismissable) {
        const closeButton = document.createElement('button');
        closeButton.innerHTML = `<span class="material-symbols-outlined">close</span>`;
        closeButton.className = 'btn btn-text modal-close-btn';
        closeButton.onclick = () => closeCustomModal();
        modalHeaderActions.appendChild(closeButton);
        modalElement.addEventListener('cancel', handleCancel);
    } else {
        persistentKeydownHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener('keydown', persistentKeydownHandler);
    }

    actions.forEach(actionConfig => {
        const button = document.createElement('button');
        button.textContent = actionConfig.label;
        button.className = `btn ${actionConfig.class || 'btn-secondary'}`;
        button.addEventListener('click', () => {
            if (actionConfig.onClick) {
                actionConfig.onClick();
            }
            if (actionConfig.preventClose !== true) {
                closeCustomModal();
            }
        });
        modalFooter.appendChild(button);
    });

    modalElement.showModal();
    setTimeout(() => {
        modalElement.classList.add('is-open');
    }, 10);
}

function handleCancel(event) {
    event.preventDefault();
    closeCustomModal();
}

/**
 * Creates and shows a toast notification.
 * @param {Object} options - The toast configuration.
 * @returns {Object} A controller for the toast with `updateProgress` and `close` methods.
 */
function showToast({ message, type = 'info', icon, duration = 5000, progressBar = false, actions = [], persistent = false }) {
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

    toast.innerHTML = `
        ${toastIconHTML}
        <div class="toast-content">
            <div class="toast-message"></div>
        </div>
        ${actionsHTML}
        ${progressBarHTML}
    `;
    toast.querySelector('.toast-message').textContent = message;

    container.appendChild(toast);

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

    if (!persistent) {
        setTimeout(closeToast, duration);
    }

    return {
        updateProgress: (percent) => {
            const bar = toast.querySelector('.toast-progress-bar');
            if (bar) {
                bar.style.width = `${percent}%`;
            }
        },
        updateMessage: (newMessage) => {
            const msgEl = toast.querySelector('.toast-message');
            if (msgEl) msgEl.textContent = newMessage;
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

const updateColorMode = () => {
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.dataset.colorMode = isDarkMode ? 'dark' : 'light';
};

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateColorMode);