/**
 * Menutech Modo 2D Module
 * Replaces <model-viewer> 3D GLTF elements with modo2d.png image across all pages.
 * Persists choice in localStorage ('menutech_modo_2d').
 */

(function () {
    const STORAGE_KEY = 'menutech_modo_2d';

    function is2DMode(): boolean {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    }

    function applyMode(): boolean {
        const mode2dActive = is2DMode();
        const modelViewers = document.querySelectorAll<HTMLElement>('model-viewer');
        const imgSrc = (window as any).MENUTECH_2D_IMG_URL || 'assets/modo2d.png';

        modelViewers.forEach((mv) => {
            const parent = mv.parentElement;
            if (!parent) return;

            // Check if 2D image already exists in parent
            let img2d = parent.querySelector<HTMLImageElement>('.mt-modo2d-image');

            if (mode2dActive) {
                // Hide model-viewer
                mv.style.setProperty('display', 'none', 'important');

                if (!img2d) {
                    img2d = document.createElement('img');
                    img2d.className = 'mt-modo2d-image';
                    img2d.src = imgSrc;
                    img2d.alt = 'Menutech Bot 2D';

                    // Match parent/container dimensions and positioning seamlessly
                    img2d.style.width = '100%';
                    img2d.style.height = '100%';
                    img2d.style.objectFit = 'contain';
                    img2d.style.pointerEvents = 'auto';
                    img2d.style.userSelect = 'none';
                    img2d.style.display = 'block';

                    // Fallback image handling
                    img2d.onerror = () => {
                        if (img2d && img2d.src.indexOf('assets/img/modo2d.png') === -1) {
                            img2d.src = 'assets/img/modo2d.png';
                        }
                    };

                    parent.appendChild(img2d);
                } else {
                    img2d.style.display = 'block';
                }
            } else {
                // Restore model-viewer
                mv.style.display = '';

                if (img2d) {
                    img2d.style.display = 'none';
                }
            }
        });

        return mode2dActive;
    }

    function enable2D(): void {
        localStorage.setItem(STORAGE_KEY, 'true');
        applyMode();
        window.dispatchEvent(new CustomEvent('menutech-modo2d-changed', { detail: { mode2d: true } }));
    }

    function enable3D(): void {
        localStorage.setItem(STORAGE_KEY, 'false');
        applyMode();
        window.dispatchEvent(new CustomEvent('menutech-modo2d-changed', { detail: { mode2d: false } }));
    }

    function toggleMode(enable2d?: boolean): void {
        const targetState = enable2d !== undefined ? enable2d : !is2DMode();
        if (targetState) {
            enable2D();
        } else {
            enable3D();
        }
    }

    // Expose global interface
    (window as any).Modo2D = {
        is2DMode,
        enable2D,
        enable3D,
        toggleMode,
        applyMode
    };

    // Initialize on DOM ready or immediate
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyMode);
    } else {
        applyMode();
    }

    // MutationObserver to apply mode to dynamically created model-viewer elements
    const observer = new MutationObserver((mutations) => {
        let shouldApply = false;
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as HTMLElement;
                    if (el.tagName && el.tagName.toLowerCase() === 'model-viewer') {
                        shouldApply = true;
                    } else if (el.querySelector && el.querySelector('model-viewer')) {
                        shouldApply = true;
                    }
                }
            });
        });
        if (shouldApply) {
            applyMode();
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
})();
