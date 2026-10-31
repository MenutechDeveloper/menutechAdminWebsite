const MT_UI_CONFIG = {
    url: "https://eemqyrysdgasfjlitads.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlbXF5cnlzZGdhc2ZqbGl0YWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MjA0NDUsImV4cCI6MjA4OTI5NjQ0NX0.UiyZLqhXSQ1Z_FoL006PDrDYKXbr_pxCOugYTulhdPY"
};

/**
 * Cloudinary Optimization Helper
 * @param {string} url - Original Cloudinary URL
 * @param {object} options - Optimization options (width, height, crop)
 * @returns {string} Optimized URL
 */
window.optimizeCloudinaryUrl = (url, options = {}) => {
    if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com')) return url;
    const [baseUrl, hash] = url.split('#');
    if (!baseUrl.includes('/upload/')) return url;
    const parts = baseUrl.split('/upload/');

    // Check if parts[1] starts with an existing transformation segment
    let pathSegments = parts[1].split('/');
    if (pathSegments.length > 1) {
        const firstSegment = pathSegments[0];
        const isVersion = /^v\d+$/.test(firstSegment);
        const isTransformation = !isVersion && (firstSegment.includes('_') || firstSegment.includes(','));
        if (isTransformation) {
            pathSegments.shift(); // Remove the old transformation segment
        }
    }
    const cleanPath = pathSegments.join('/');

    let transformations = ['f_auto', 'q_auto:eco', 'dpr_auto'];
    if (options.width) {
        transformations.push(`w_${options.width}`);
    } else {
        transformations.push('w_400');
    }
    if (options.height) transformations.push(`h_${options.height}`);
    if (options.crop) transformations.push(`c_${options.crop}`);
    const transformationString = transformations.join(',');
    const optimizedUrl = `${parts[0]}/upload/${transformationString}/${cleanPath}`;
    return hash ? `${optimizedUrl}#${hash}` : optimizedUrl;
};

/**
 * Menutech Gallery Web Component
 * Usage: <menutech-gallery domain="yoursite.com"></menutech-gallery>
 */
class MenutechGallery extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.config = MT_UI_CONFIG;
        this.supabase = null;
    }

    static get observedAttributes() {
        return ['domain', 'type', 'images-list', 'admin-mode'];
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal !== newVal) {
            this.render();
        }
    }

    async connectedCallback() {
        await this.initSupabase();
        this.render();
    }

    async initSupabase() {
        if (this.supabase) return;
        try {
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js");
            this.supabase = createClient(this.config.url, this.config.key);
        } catch (err) {
            console.error("MenutechGallery Supabase Init Error:", err);
        }
    }

    async fetchGalleryData(domain) {
        const attrType = this.getAttribute('type');
        const attrImages = this.getAttribute('images-list');

        let result = {
            images: [],
            type: attrType || 'grid'
        };

        // Case 1: Manual override via images-list attribute
        if (attrImages) {
            result.images = attrImages.split(',').filter(u => u.trim()).map(url => ({ image_url: url.trim() }));
            return result;
        }

        // Case 2: Fetch from Supabase based on domain
        if (!this.supabase) await this.initSupabase();
        try {
            const imagesPromise = this.supabase
                .from('galeria')
                .select('image_url')
                .eq('domain', domain)
                .order('created_at', { ascending: false });

            // If we already have a type override, don't fetch it from DB
            const typePromise = attrType
                ? Promise.resolve({ data: { gallery_type: attrType } })
                : this.supabase
                    .from('profiles')
                    .select('gallery_type')
                    .eq('domain', domain)
                    .limit(1)
                    .single();

            const [imagesRes, typeRes] = await Promise.all([imagesPromise, typePromise]);

            if (imagesRes.error) throw imagesRes.error;

            result.images = imagesRes.data || [];
            if (!attrType && typeRes.data) {
                result.type = typeRes.data.gallery_type || 'grid';
            }

            return result;
        } catch (err) {
            console.error("MenutechGallery Fetch Error:", err);
            return result;
        }
    }

    getPattern(i) {
        return '';
    }

    async loadSwiper() {
        const loadCSS = () => new Promise((resolve) => {
            const cssUrl = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css';
            // Check global head first to avoid multiple injections
            if (document.querySelector(`link[href="${cssUrl}"]`)) return resolve();
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cssUrl;
            link.onload = resolve;
            link.onerror = resolve;
            document.head.appendChild(link);
        });

        const loadJS = () => new Promise((resolve) => {
            if (window.Swiper) return resolve();
            let script = document.querySelector('script[src*="swiper-bundle.min.js"]');
            if (script) {
                const interval = setInterval(() => {
                    if (window.Swiper) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 50);
                return;
            }
            script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js';
            script.onload = resolve;
            script.onerror = resolve;
            document.head.appendChild(script);
        });

        await Promise.all([loadCSS(), loadJS()]);
    }

    initBentoAdmin() {
        const container = this.shadowRoot.querySelector('.gallery-bento');
        const items = this.shadowRoot.querySelectorAll('.gallery-item');
        let dragItem = null;
        let ghost = document.createElement('div');
        ghost.className = 'gallery-item ghost';

        // --- Drag and Drop Reordering ---
        items.forEach(item => {
            item.ondragstart = (e) => {
                const isResizeHandle = e.target.closest('.resize-handle');
                const isDeleteBtn = e.target.closest('.btn-delete');

                if (isResizeHandle || isDeleteBtn || item.classList.contains('is-resizing')) {
                    e.preventDefault();
                    return;
                }
                dragItem = item;
                item.classList.add('is-dragging');
                e.dataTransfer.effectAllowed = 'move';

                // Ensure ghost matches dimensions of dragging item
                ghost.style.gridColumn = item.style.gridColumn;
                ghost.style.gridRow = item.style.gridRow;
            };

            item.ondragend = () => {
                item.classList.remove('is-dragging');
                if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
                dragItem = null;
            };
        });

        container.ondragover = (e) => {
            e.preventDefault();
            if (!dragItem) return;

            const itemsList = Array.from(container.querySelectorAll('.gallery-item:not(.is-dragging):not(.ghost)'));
            let closestItem = null;
            let minDistance = Infinity;
            let insertAfter = false;

            itemsList.forEach(item => {
                const rect = item.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;

                const distance = Math.hypot(e.clientX - centerX, e.clientY - centerY);

                if (distance < minDistance) {
                    minDistance = distance;
                    closestItem = item;
                    // Check if mouse is more to the right or bottom of the center
                    insertAfter = e.clientX > centerX || e.clientY > centerY;
                }
            });

            if (closestItem && closestItem !== ghost) {
                container.insertBefore(ghost, insertAfter ? closestItem.nextSibling : closestItem);
            }
        };

        container.ondrop = (e) => {
            e.preventDefault();
            if (!dragItem) return;

            if (ghost.parentNode) {
                container.insertBefore(dragItem, ghost);
                ghost.parentNode.removeChild(ghost);
            }

            const newItems = Array.from(container.querySelectorAll('.gallery-item:not(.ghost)'));
            const from = parseInt(dragItem.getAttribute('data-index'));
            const to = newItems.indexOf(dragItem);

            if (from !== -1 && to !== -1 && from !== to) {
                this.dispatchEvent(new CustomEvent('reorder-images', {
                    detail: { from, to },
                    bubbles: true,
                    composed: true
                }));
            }
        };

        // --- Fluid Resizing logic ---
        let startX, startY, startW, startH, startCol, startRow, activeItem = null, activeHandle = null;
        let resizeGhost = document.createElement('div');
        resizeGhost.className = 'gallery-item ghost resize-ghost';
        resizeGhost.style.zIndex = '1000';
        resizeGhost.style.pointerEvents = 'none';

        const onMouseMove = (e) => {
            if (!activeItem) return;
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);

            const isMobile = window.innerWidth <= 768;
            const maxCols = isMobile ? 3 : 6;
            const gap = isMobile ? 10 : 20;
            const gridColWidth = (container.offsetWidth - (maxCols - 1) * gap) / maxCols;
            const gridRowHeight = isMobile ? 100 : 150;

            let newW = startW;
            let newH = startH;
            let newColStart = startCol;
            let newRowStart = startRow;

            const deltaX = Math.round((clientX - startX) / (gridColWidth + gap));
            const deltaY = Math.round((clientY - startY) / (gridRowHeight + gap));

            if (activeHandle.classList.contains('handle-r')) {
                newW = startW + deltaX;
            } else if (activeHandle.classList.contains('handle-l')) {
                newW = startW - deltaX;
                newColStart = startCol + deltaX;
            } else if (activeHandle.classList.contains('handle-b')) {
                newH = startH + deltaY;
            } else if (activeHandle.classList.contains('handle-t')) {
                newH = startH - deltaY;
                newRowStart = startRow + deltaY;
            } else if (activeHandle.classList.contains('handle-br')) {
                newW = startW + deltaX;
                newH = startH + deltaY;
            } else if (activeHandle.classList.contains('handle-bl')) {
                newW = startW - deltaX;
                newH = startH + deltaY;
                newColStart = startCol + deltaX;
            } else if (activeHandle.classList.contains('handle-tr')) {
                newW = startW + deltaX;
                newH = startH - deltaY;
                newRowStart = startRow + deltaY;
            } else if (activeHandle.classList.contains('handle-tl')) {
                newW = startW - deltaX;
                newH = startH - deltaY;
                newColStart = startCol + deltaX;
                newRowStart = startRow + deltaY;
            }

            // Boundary constraints
            newW = Math.max(1, newW);
            newH = Math.max(1, newH);
            newColStart = Math.max(1, Math.min(maxCols, newColStart));
            newRowStart = Math.max(1, newRowStart);

            if (newColStart + newW - 1 > maxCols) {
                if (activeHandle.classList.contains('handle-l') || activeHandle.classList.contains('handle-bl') || activeHandle.classList.contains('handle-tl')) {
                    newW = startCol + startW - newColStart;
                } else {
                    newW = maxCols - newColStart + 1;
                }
            }

            resizeGhost.style.gridColumn = `${newColStart} / span ${newW}`;
            resizeGhost.style.gridRow = `${newRowStart} / span ${newH}`;
        };

        const onMouseUp = () => {
            if (activeItem) {
                const idx = parseInt(activeItem.getAttribute('data-index'));
                const colPart = resizeGhost.style.gridColumn.split('span ')[1];
                const rowPart = resizeGhost.style.gridRow.split('span ')[1];
                const sw = colPart ? colPart.trim() : '2';
                const sh = rowPart ? rowPart.trim() : '2';

                activeItem.style.gridColumn = `span ${sw}`;
                activeItem.style.gridRow = `span ${sh}`;
                activeItem.style.opacity = '1';

                this.dispatchEvent(new CustomEvent('update-layout', {
                    detail: { index: idx, layout: { s: `${sw}x${sh}` } },
                    bubbles: true,
                    composed: true
                }));

                activeItem.classList.remove('is-resizing');
                if (resizeGhost.parentNode) resizeGhost.parentNode.removeChild(resizeGhost);
                activeItem = null;
                activeHandle = null;
            }
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('touchmove', onMouseMove);
            window.removeEventListener('touchend', onMouseUp);
        };

        this.shadowRoot.querySelectorAll('.resize-handle').forEach(handle => {
            handle.onmousedown = handle.ontouchstart = (e) => {
                e.preventDefault();
                e.stopPropagation();
                activeItem = handle.closest('.gallery-item');
                activeHandle = handle;
                activeItem.classList.add('is-resizing');

                const isMobile = window.innerWidth <= 768;
                const cols = isMobile ? 3 : 6;
                const gap = isMobile ? 10 : 20;
                const gridColWidth = (container.offsetWidth - (cols - 1) * gap) / cols;
                const gridRowHeight = isMobile ? 100 : 150;

                startX = e.clientX || (e.touches && e.touches[0].clientX);
                startY = e.clientY || (e.touches && e.touches[0].clientY);

                const colMatch = activeItem.style.gridColumn.match(/span (\d+)/);
                const rowMatch = activeItem.style.gridRow.match(/span (\d+)/);
                startW = colMatch ? parseInt(colMatch[1]) : 2;
                startH = rowMatch ? parseInt(rowMatch[1]) : 2;

                const rect = activeItem.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                startCol = Math.round((rect.left - containerRect.left) / (gridColWidth + gap)) + 1;
                startRow = Math.round((rect.top - containerRect.top) / (gridRowHeight + gap)) + 1;

                resizeGhost.style.gridColumn = `${startCol} / span ${startW}`;
                resizeGhost.style.gridRow = `${startRow} / span ${startH}`;

                container.appendChild(resizeGhost);
                activeItem.style.opacity = '0.3';

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
                window.addEventListener('touchmove', onMouseMove);
                window.addEventListener('touchend', onMouseUp);
            };
        });
    }

    async render() {
        if (this._rendering) {
            this._needsRender = true;
            return;
        }
        this._rendering = true;

        try {
            let domain = this.getAttribute('domain');
            if (!domain) {
                domain = window.location.hostname.replace(/^www\./, '');
            }

            const isPreview = this.hasAttribute('type');

            if (!domain && !isPreview) {
                this.shadowRoot.innerHTML = `<p style="color:#ef4444; font-weight:500;">Error: Could not determine domain.</p>`;
                return;
            }

            const isAdmin = this.hasAttribute('admin-mode');
            const styles = `
                <style>
                    :host { display: block; width: 100%; max-width: 1200px; margin: 80px auto; padding: 0 24px; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; box-sizing: border-box; clear: both; text-align: center; }
                    :host([admin-mode]) { margin: 20px auto; margin-bottom: 120px; }
                    .gallery-grid {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        gap: 30px;
                        padding: 0;
                        margin: 0 auto;
                    }

                    /* Bento Grid Styles */
                    .gallery-bento {
                        display: grid;
                        grid-template-columns: repeat(6, 1fr);
                        grid-auto-rows: 150px;
                        grid-auto-flow: dense;
                        gap: 20px;
                        padding: 0;
                        margin: 0 auto;
                        position: relative;
                    }
                    :host([admin-mode]) .gallery-bento {
                        background-image:
                            linear-gradient(to right, rgba(255,149,51,0.05) 1px, transparent 1px),
                            linear-gradient(to bottom, rgba(255,149,51,0.05) 1px, transparent 1px);
                        background-size: calc((100% + 20px) / 6) 170px;
                    }

                    .gallery-item {
                        position: relative;
                        border-radius: 28px;
                        background: #14161d;
                        box-shadow: 0 12px 30px -10px rgba(0,0,0,0.3);
                        transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.6s;
                        aspect-ratio: 1/1;
                        user-select: none;
                        overflow: hidden;
                    }
                    .gallery-bento .gallery-item { aspect-ratio: auto; overflow: visible; }
                    .gallery-item:hover { transform: translateY(-8px); box-shadow: 0 20px 40px -10px rgba(0,0,0,0.4); }

                    .item-inner {
                        position: relative;
                        width: 100%;
                        height: 100%;
                        border-radius: 28px;
                        overflow: hidden;
                        z-index: 1;
                    }

                    /* Bento Specific Admin States */
                    .gallery-item.is-dragging { opacity: 0.5; transform: scale(0.95); z-index: 100; pointer-events: none; }
                    .gallery-item.is-resizing { transition: none; z-index: 101; }
                    .ghost { background: var(--orange, #ff9533) !important; opacity: 0.2 !important; border: 2px dashed var(--orange, #ff9533); }

                    .gallery-item img {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        transition: transform 1.2s cubic-bezier(0.16, 1, 0.3, 1);
                        pointer-events: none;
                        display: block;
                    }
                    .gallery-item:hover img { transform: scale(1.06); }

                    /* Admin Styles */
                    .admin-overlay {
                        position: absolute;
                        inset: 0;
                        background: rgba(0,0,0,0.6);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        opacity: 0;
                        transition: 0.3s;
                        backdrop-filter: blur(4px);
                        z-index: 10;
                        pointer-events: none;
                    }
                    .admin-overlay > * { pointer-events: auto; }
                    .gallery-item:hover .admin-overlay, .swiper-slide:hover .admin-overlay {
                        opacity: 1;
                    }
                    .btn-delete {
                        background: #ef4444;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 12px;
                        font-weight: 700;
                        font-size: 0.8rem;
                        cursor: pointer;
                        transform: translateY(10px);
                        transition: 0.3s;
                    }
                    .gallery-item:hover .btn-delete, .swiper-slide:hover .btn-delete {
                        transform: translateY(0);
                    }
                    .btn-delete:hover {
                        background: #dc2626;
                        transform: scale(1.05);
                    }

                    .loader { text-align: center; padding: 60px; color: #ff9533; font-weight: 600; letter-spacing: 1px; }

                    /* Resize Handles - Bento */
                    .resize-handle {
                        position: absolute;
                        z-index: 20;
                        display: none;
                    }
                    .gallery-item:hover .resize-handle { display: block; }

                    /* Corners - Professional minimalist dots */
                    .handle-corner {
                        width: 12px; height: 12px;
                        background: #fff;
                        border: 2px solid var(--orange, #ff9533);
                        border-radius: 50%;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        z-index: 30;
                    }
                    .handle-tl { top: -6px; left: -6px; cursor: nwse-resize; }
                    .handle-tr { top: -6px; right: -6px; cursor: nesw-resize; }
                    .handle-bl { bottom: -6px; left: -6px; cursor: nesw-resize; }
                    .handle-br { bottom: -6px; right: -6px; cursor: nwse-resize; }

                    /* Side handles - Professional bars */
                    .handle-side { background: transparent; transition: background 0.3s; }
                    .handle-side:hover { background: rgba(255,149,51,0.2); }

                    .handle-t { top: -4px; left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
                    .handle-b { bottom: -4px; left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
                    .handle-l { left: -4px; top: 10px; bottom: 10px; width: 8px; cursor: ew-resize; }
                    .handle-r { right: -4px; top: 10px; bottom: 10px; width: 8px; cursor: ew-resize; }

                    @media (max-width: 768px) {
                        :host { margin: 40px auto; padding: 0 16px; }
                        .gallery-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
                        .gallery-bento { grid-template-columns: repeat(3, 1fr); grid-auto-rows: 100px; gap: 10px; }
                        :host([admin-mode]) .gallery-bento { background-size: calc((100% + 10px) / 3) 110px; }
                    }

                    /* Slider specific styles */
                    .swiper { width: 100%; max-width: 1200px; margin: 0 auto; padding: 50px 0; overflow: hidden; position: relative; }
                    .swiper-wrapper { display: flex; align-items: center; }
                    .swiper-slide {
                        width: 450px;
                        height: 450px;
                        flex-shrink: 0;
                        border-radius: 28px;
                        overflow: hidden;
                        box-shadow: 0 12px 30px -10px rgba(0,0,0,0.3);
                        transition: transform 0.5s ease;
                    }
                    .swiper-slide img {
                        display: block;
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                    }
                    .swiper-pagination { bottom: 0 !important; }
                    .swiper-pagination-bullet-active { background: #ff9533 !important; }
                    @media (max-width: 768px) {
                        .swiper-slide { width: 280px; height: 280px; }
                    }
                </style>
            `;

            this.shadowRoot.innerHTML = `${styles}<div class="loader">Loading Gallery...</div>`;

            const data = await this.fetchGalleryData(domain);
            const images = data.images;
            const type = data.type;

            if (images.length === 0) {
                this.shadowRoot.innerHTML = `${styles}<div style="text-align:center; padding: 80px 20px; color: #64748b; font-weight: 400;">No images found in the gallery for this domain.</div>`;
                return;
            }

            if (type === 'slider') {
                await this.loadSwiper();
                const slidesHtml = images.map((img, i) => {
                    const optimizedUrl = window.optimizeCloudinaryUrl(img.image_url, { width: 500, height: 500, crop: 'fill' });
                    return `
                        <div class="swiper-slide">
                            <img src="${optimizedUrl}" loading="lazy" width="450" height="450" />
                            ${isAdmin ? `
                                <div class="admin-overlay">
                                    <button class="btn-delete" data-index="${i}">Remove</button>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('');

                this.shadowRoot.innerHTML = `
                    ${styles}
                    <div class="swiper">
                        <div class="swiper-wrapper">
                            ${slidesHtml}
                        </div>
                        <div class="swiper-pagination"></div>
                    </div>
                `;

                if (window.Swiper) {
                    new Swiper(this.shadowRoot.querySelector('.swiper'), {
                        effect: 'coverflow',
                        grabCursor: true,
                        centeredSlides: true,
                        slidesPerView: 'auto',
                        loop: true,
                        speed: 1000,
                        autoplay: {
                            delay: 2500,
                            disableOnInteraction: false,
                        },
                        coverflowEffect: {
                            rotate: 30,
                            stretch: 0,
                            depth: 150,
                            modifier: 1.5,
                            slideShadows: true,
                        },
                        pagination: {
                            el: this.shadowRoot.querySelector('.swiper-pagination'),
                            clickable: true
                        },
                    });
                }
            } else if (type === 'bento') {
                const itemsHtml = images.map((img, i) => {
                    const match = img.image_url.match(/#s=(\d)x(\d)/);
                    const sw = match ? parseInt(match[1]) : 2;
                    const sh = match ? parseInt(match[2]) : 2;
                    const optimizedUrl = window.optimizeCloudinaryUrl(img.image_url, { width: sw * 250, height: sh * 250, crop: 'fill' });

                    return `
                        <div class="gallery-item" data-index="${i}" style="grid-column: span ${sw}; grid-row: span ${sh};" draggable="${isAdmin}">
                            <div class="item-inner">
                                <img src="${optimizedUrl}" loading="lazy" width="${sw * 250}" height="${sh * 250}">
                                ${isAdmin ? `
                                    <div class="admin-overlay">
                                        <button class="btn-delete" data-index="${i}">Remove</button>
                                    </div>
                                ` : ''}
                            </div>
                            ${isAdmin ? `
                                <div class="resize-handle handle-corner handle-tl" data-index="${i}"></div>
                                <div class="resize-handle handle-corner handle-tr" data-index="${i}"></div>
                                <div class="resize-handle handle-corner handle-bl" data-index="${i}"></div>
                                <div class="resize-handle handle-corner handle-br" data-index="${i}"></div>
                                <div class="resize-handle handle-side handle-t" data-index="${i}"></div>
                                <div class="resize-handle handle-side handle-b" data-index="${i}"></div>
                                <div class="resize-handle handle-side handle-l" data-index="${i}"></div>
                                <div class="resize-handle handle-side handle-r" data-index="${i}"></div>
                            ` : ''}
                        </div>
                    `;
                }).join('');

                this.shadowRoot.innerHTML = `${styles}<div class="gallery-bento">${itemsHtml}</div>`;
                if (isAdmin) this.initBentoAdmin();

            } else {
                const itemsHtml = images.map((img, i) => {
                    const optimizedUrl = window.optimizeCloudinaryUrl(img.image_url, { width: 500, height: 500, crop: 'fill' });
                    return `
                        <div class="gallery-item ${this.getPattern(i)}">
                            <img src="${optimizedUrl}" loading="lazy" width="300" height="300">
                            ${isAdmin ? `
                                <div class="admin-overlay">
                                    <button class="btn-delete" data-index="${i}">Remove</button>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('');

                this.shadowRoot.innerHTML = `${styles}<div class="gallery-grid">${itemsHtml}</div>`;
            }

            if (isAdmin) {
                this.shadowRoot.querySelectorAll('.btn-delete').forEach(btn => {
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        const index = parseInt(btn.getAttribute('data-index'));
                        this.dispatchEvent(new CustomEvent('delete-image', {
                            detail: { index },
                            bubbles: true,
                            composed: true
                        }));
                    };
                });
            }
        } finally {
            this._rendering = false;
            if (this._needsRender) {
                this._needsRender = false;
                this.render();
            }
        }
    }
}

// Expose the class for potential manual interaction
window.MenutechGallery = MenutechGallery;
if (!customElements.get('menutech-gallery')) {
    customElements.define('menutech-gallery', MenutechGallery);
}

/**
 * Menutech Promotions Web Component Base Class
 */
class MenutechPromoBase extends HTMLElement {
    constructor(eventType) {
        super();
        this.attachShadow({ mode: 'open' });
        this.eventType = eventType;
        this.config = MT_UI_CONFIG;
        this.supabase = null;
    }

    static get observedAttributes() {
        return ['domain', 'color', 'cantidad', 'tamano', 'velocidad', 'opacidad', 'custom-label'];
    }

    attributeChangedCallback() {
        this.render();
    }

    async connectedCallback() {
        await this.initSupabase();
        this.render();
    }

    async initSupabase() {
        if (this.supabase) return;
        try {
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js");
            this.supabase = createClient(this.config.url, this.config.key);
        } catch (err) {
            console.error("MenutechPromo Supabase Init Error:", err);
        }
    }

    async fetchPromoData(domain) {
        if (!this.supabase) await this.initSupabase();
        try {
            const { data, error } = await this.supabase
                .from('promos')
                .select('*')
                .eq('domain', domain)
                .eq('event_type', this.eventType)
                .single();

            if (error) return null;
            return data;
        } catch (err) {
            return null;
        }
    }

    getHolidayDate(year) {
        switch(this.eventType) {
            case 'christmas': return new Date(year, 11, 25);
            case 'halloween': return new Date(year, 9, 30);
            case 'valentine': return new Date(year, 1, 14);
            case 'president': return new Date(year, 1, 15);
            case 'newyear': return new Date(year, 0, 1);
            case 'independence': return new Date(year, 6, 4);
            case 'thanksgiving': return new Date(year, 10, 28);
            default: return null;
        }
    }

    async render() {
        let domain = this.getAttribute('domain') || window.location.hostname.replace(/^www\./, '');
        const promo = await this.fetchPromoData(domain);

        const now = new Date();
        const holidayDate = this.getHolidayDate(now.getFullYear());
        const isHoliday = holidayDate && now.toDateString() === holidayDate.toDateString();

        const hasDates = promo && (promo.start_date || promo.end_date);
        let isWithinRange = false;
        if (hasDates) {
            const start = promo.start_date ? new Date(promo.start_date) : null;
            const end = promo.end_date ? new Date(promo.end_date) : null;
            if (start) start.setHours(0,0,0,0);
            if (end) end.setHours(23,59,59,999);
            isWithinRange = (!start || now >= start) && (!end || now <= end);
        }

        const showParticles = isHoliday || isWithinRange;
        const showPromoContent = promo && promo.is_active && (isWithinRange || (!hasDates && isHoliday));

        if (!showParticles && !showPromoContent) {
            this.shadowRoot.innerHTML = '';
            return;
        }

        const color = this.getAttribute("color") || (this.eventType === 'halloween' ? "#ff6600" : "#ffffff");
        const cantidad = parseInt(this.getAttribute("cantidad")) || (this.eventType === 'christmas' ? 80 : 50);
        const tamano = parseFloat(this.getAttribute("tamano")) || (this.eventType === 'christmas' ? 10 : 5);
        const velocidad = parseFloat(this.getAttribute("velocidad")) || 1;
        const opacidad = parseFloat(this.getAttribute("opacidad")) || 0.8;

        let customLabel = this.getAttribute("custom-label") || promo.custom_label;

        // Try to extract label from image_url fragment if not already provided
        if (!customLabel && promo.image_url && promo.image_url.includes('#l=')) {
            customLabel = decodeURIComponent(promo.image_url.split('#l=')[1].split('&')[0]);
        }

        // Particle generation based on event type
        let particles = "";
        if (this.eventType === 'christmas') {
            const snowImages = [
                "https://menutechdeveloper.github.io/libreria/snow1.png",
                "https://menutechdeveloper.github.io/libreria/snow2.png",
                "https://menutechdeveloper.github.io/libreria/snow3.png"
            ];
            for (let i = 0; i < cantidad; i++) {
                const x = Math.random() * 100;
                const size = tamano + 5 + (Math.random() * tamano);
                const dur = (6 + Math.random() * 10) / velocidad;
                const delay = Math.random() * 20;
                const img = snowImages[i % snowImages.length];
                const drift = (Math.random() * 60 - 30);
                const op = 0.4 + Math.random() * opacidad;
                particles += `<div class="particle" style="left:${x}%; width:${size}px; height:${size}px; animation-duration:${dur}s; animation-delay:${delay}s; --drift:${drift}px; background-image:url('${img}'); opacity:${op};"></div>`;
            }
        } else if (this.eventType === 'halloween') {
            const pumpkinSVG = `data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M50 20C30 20 15 35 15 55C15 75 30 90 50 90C70 90 85 75 85 55C85 35 70 20 50 20Z" fill="#ff6600"/><path d="M45 10L55 10L52 25L48 25Z" fill="#4a3000"/><path d="M35 45L45 50L35 55Z" fill="#ffff00"/><path d="M65 45L55 50L65 55Z" fill="#ffff00"/><path d="M30 65C40 75 60 75 70 65C60 70 40 70 30 65Z" fill="#4a3000"/></svg>')}`;
            for (let i = 0; i < cantidad; i++) {
                const x = Math.random() * 100;
                const y = Math.random() * 100;
                const size = (tamano * 3) + 5 + Math.random() * (tamano * 4);
                const dur = (4 + Math.random() * 6) / velocidad;
                const delay = Math.random() * 12;
                const maxOp = 0.4 + Math.random() * opacidad;
                const startScale = 0.2 + Math.random() * 0.4;
                const endScale = 0.8 + Math.random() * 0.5;
                particles += `<div class="particle-static" style="left:${x}%; top:${y}%; width:${size}px; height:${size}px; animation-duration:${dur}s; animation-delay:${delay}s; background-image:url('${pumpkinSVG}'); opacity:0; --max-op:${maxOp}; --start-scale:${startScale}; --end-scale:${endScale};"></div>`;
            }
        } else if (this.eventType === 'valentine') {
            const heartSVG = `data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M50 85C50 85 10 60 10 35C10 15 30 10 50 30C70 10 90 15 90 35C90 60 50 85 50 85Z" fill="#ff0000"/></svg>')}`;
            for (let i = 0; i < cantidad; i++) {
                const x = Math.random() * 100;
                const y = Math.random() * 100;
                const size = tamano + 5 + Math.random() * (tamano * 1.5);
                const dur = (3 + Math.random() * 5) / velocidad;
                const delay = Math.random() * 10;
                const maxOp = 0.3 + Math.random() * opacidad;
                const startScale = 0.3 + Math.random() * 0.4;
                const endScale = 0.9 + Math.random() * 0.4;
                particles += `<div class="particle-static" style="left:${x}%; top:${y}%; width:${size}px; height:${size}px; animation-duration:${dur}s; animation-delay:${delay}s; background-image:url('${heartSVG}'); opacity:0; --max-op:${maxOp}; --start-scale:${startScale}; --end-scale:${endScale};"></div>`;
            }
        } else if (this.eventType === 'newyear') {
            const starSVG = `data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#FFD700"><path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/></svg>')}`;
            for (let i = 0; i < cantidad; i++) {
                const x = Math.random() * 100;
                const y = Math.random() * 100;
                const size = tamano + Math.random() * tamano;
                const dur = (3 + Math.random() * 5) / velocidad;
                const delay = Math.random() * 10;
                const maxOp = 0.3 + Math.random() * opacidad;
                const startScale = 0.3 + Math.random() * 0.4;
                const endScale = 0.9 + Math.random() * 0.4;
                particles += `<div class="particle-static" style="left:${x}%; top:${y}%; width:${size}px; height:${size}px; animation-duration:${dur}s; animation-delay:${delay}s; background-image:url('${starSVG}'); opacity:0; --max-op:${maxOp}; --start-scale:${startScale}; --end-scale:${endScale};"></div>`;
            }
        } else if (this.eventType === 'independence') {
            const fireworkSVG = `data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#fff"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="4" r="1"/><circle cx="12" cy="20" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="20" cy="12" r="1"/><circle cx="6.3" cy="6.3" r="1"/><circle cx="17.7" cy="17.7" r="1"/><circle cx="6.3" cy="17.7" r="1"/><circle cx="17.7" cy="6.3" r="1"/></svg>')}`;
            for (let i = 0; i < cantidad; i++) {
                const x = Math.random() * 100;
                const y = Math.random() * 100;
                const size = tamano + Math.random() * tamano;
                const dur = (2 + Math.random() * 3) / velocidad;
                const delay = Math.random() * 8;
                const maxOp = 0.5 + Math.random() * opacidad;
                const startScale = 0.1 + Math.random() * 0.3;
                const endScale = 1.0 + Math.random() * 0.6;
                particles += `<div class="particle-static" style="left:${x}%; top:${y}%; width:${size}px; height:${size}px; animation-duration:${dur}s; animation-delay:${delay}s; background-image:url('${fireworkSVG}'); opacity:0; --max-op:${maxOp}; --start-scale:${startScale}; --end-scale:${endScale};"></div>`;
            }
        } else if (this.eventType === 'thanksgiving') {
            const leafSVG = `data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#D2691E"><path d="M12 2s-1 2-1 4c0 3 2 4 3 6s-1 4-3 4-3-2-3-6c0-2-1-4-1-4s-1 2-1 4c0 6 4 10 10 10s10-4 10-10c0-2-1-4-1-4z"/></svg>')}`;
            for (let i = 0; i < cantidad; i++) {
                const x = Math.random() * 100;
                const y = Math.random() * 100;
                const size = tamano + Math.random() * tamano;
                const dur = (4 + Math.random() * 6) / velocidad;
                const delay = Math.random() * 12;
                const maxOp = 0.4 + Math.random() * opacidad;
                const startScale = 0.4 + Math.random() * 0.3;
                const endScale = 0.8 + Math.random() * 0.4;
                particles += `<div class="particle-static" style="left:${x}%; top:${y}%; width:${size}px; height:${size}px; animation-duration:${dur}s; animation-delay:${delay}s; background-image:url('${leafSVG}'); opacity:0; --max-op:${maxOp}; --start-scale:${startScale}; --end-scale:${endScale};"></div>`;
            }
        } else if (this.eventType === 'president') {
            const eagleSVG = `data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#3c3b6e"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/></svg>')}`;
            for (let i = 0; i < cantidad; i++) {
                const x = Math.random() * 100;
                const y = Math.random() * 100;
                const size = tamano + Math.random() * tamano;
                const dur = (4 + Math.random() * 5) / velocidad;
                const delay = Math.random() * 10;
                const maxOp = 0.3 + Math.random() * opacidad;
                const startScale = 0.3 + Math.random() * 0.3;
                const endScale = 0.7 + Math.random() * 0.5;
                particles += `<div class="particle-static" style="left:${x}%; top:${y}%; width:${size}px; height:${size}px; animation-duration:${dur}s; animation-delay:${delay}s; background-image:url('${eagleSVG}'); opacity:0; --max-op:${maxOp}; --start-scale:${startScale}; --end-scale:${endScale};"></div>`;
            }
        }

        const isPopup = promo && promo.display_mode === 'popup';
        const styles = `
            <style>
                :host {
                    position: ${isPopup ? 'fixed' : 'relative'};
                    top: 0; left: 0; width: 100%;
                    height: ${isPopup ? '100%' : 'auto'};
                    pointer-events: none;
                    z-index: 9999;
                    display: block !important;
                }
                .promo-container { font-family: 'Plus Jakarta Sans', sans-serif; }

                .particles-wrapper {
                    position: ${isPopup ? 'absolute' : 'fixed'};
                    inset: 0;
                    overflow: hidden;
                    pointer-events: none;
                    z-index: -1;
                }

                /* Particles */
                .particle {
                    position: absolute; top: -50px; background-size: contain; background-repeat: no-repeat;
                    animation: fall linear infinite; will-change: transform; opacity: 0.8;
                }
                .particle-static {
                    position: absolute; background-size: contain; background-repeat: no-repeat;
                    animation: appearDisappear linear infinite; will-change: opacity, transform; opacity: 0;
                }
                @keyframes fall {
                    0% { transform: translateY(-50px) translateX(0) rotate(0deg); }
                    100% { transform: translateY(calc(100vh + 50px)) translateX(var(--drift, 0)) rotate(360deg); }
                }
                @keyframes appearDisappear {
                    0%, 100% { opacity: 0; transform: scale(var(--start-scale, 0.5)); }
                    50% { opacity: var(--max-op, 0.8); transform: scale(var(--end-scale, 1.1)); }
                }

                /* Halloween Smoke */
                .smoke-layer {
                    position: absolute; inset: 0; background: url("https://menutechdeveloper.github.io/libreria/smoke5.png") repeat;
                    background-size: cover; opacity: 0.15; filter: blur(4px); animation: moveSmoke 60s linear infinite;
                }
                @keyframes moveSmoke {
                    0% { background-position: 0 0; }
                    100% { background-position: 2000px 1000px; }
                }

                .promo-popup-overlay {
                    position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);
                    display: flex; align-items: center; justify-content: center; z-index: 10000;
                    animation: fadeIn 0.5s ease;
                    pointer-events: auto;
                }
                .promo-popup-card {
                    position: relative; max-width: 500px; width: 90%; border-radius: 32px;
                    overflow: hidden; box-shadow: 0 40px 100px rgba(0,0,0,0.6);
                    animation: scaleUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
                    background: #fff; display: flex; flex-direction: column;
                }
                .promo-popup-card img { display: block; width: 100%; height: auto; max-height: 70vh; object-fit: cover; }

                .cta-container { padding: 25px; text-align: center; background: #fff; }
                .btn-cta {
                    display: inline-block; padding: 16px 32px; background: #ff9533; color: #fff;
                    text-decoration: none; border-radius: 16px; font-weight: 800; font-size: 1rem;
                    text-transform: uppercase; letter-spacing: 1px; transition: 0.3s;
                    box-shadow: 0 10px 20px rgba(255, 149, 51, 0.3);
                }
                .btn-cta:hover { transform: translateY(-3px); box-shadow: 0 15px 30px rgba(255, 149, 51, 0.4); }

                .close-btn {
                    position: absolute; top: 15px; right: 15px; width: 38px; height: 38px;
                    border-radius: 50%; background: rgba(255,255,255,0.9); border: none; cursor: pointer;
                    display: flex; align-items: center; justify-content: center; box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                    z-index: 10; transition: 0.3s;
                }
                .close-btn:hover { transform: rotate(90deg) scale(1.1); background: #fff; }

                .promo-section {
                    width: 100%; max-width: 700px; margin: 60px auto; padding: 0 24px;
                    display: flex; flex-direction: column; align-items: center; box-sizing: border-box;
                    text-align: center;
                }
                .promo-section img {
                    display: block; width: 100%; max-width: 600px; height: auto; max-height: 80vh;
                    object-fit: cover; border-radius: 32px; box-shadow: 0 20px 50px rgba(0,0,0,0.15);
                    margin-bottom: 30px;
                }

                @media (max-width: 768px) {
                    .promo-section { margin: 20px auto; padding: 0 16px; }
                    .promo-section img { max-height: 70vh; }
                }

                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes scaleUp { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            </style>
        `;

        const rawImageUrl = (promo && promo.image_url) ? promo.image_url.split('#')[0] : '';
        const imageUrl = window.optimizeCloudinaryUrl(rawImageUrl, { width: 1000 });

        const particlesHTML = `
            <div class="particles-wrapper">
                ${this.eventType === 'halloween' ? '<div class="smoke-layer"></div>' : ''}
                ${particles}
            </div>
        `;

        if (!showPromoContent) {
            this.shadowRoot.innerHTML = `${styles}${particlesHTML}`;
            return;
        }

        if (promo.display_mode === 'popup') {
            this.shadowRoot.innerHTML = `
                ${styles}
                ${particlesHTML}
                <div class="promo-popup-overlay" id="promo-overlay">
                    <div class="promo-popup-card">
                        <button class="close-btn" id="close-promo" title="Close">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:20px;height:20px;color:#000"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                        <img src="${imageUrl}" alt="${this.eventType} promotion" loading="lazy" width="500" height="500">
                        ${customLabel ? `
                            <div class="cta-container">
                                <a href="#" class="btn-cta" id="cta-button">${customLabel}</a>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
            this.shadowRoot.getElementById('close-promo').onclick = () => {
                this.shadowRoot.getElementById('promo-overlay').style.display = 'none';
            };
            if (customLabel) {
                this.shadowRoot.getElementById('cta-button').onclick = (e) => {
                    e.preventDefault();
                    this.shadowRoot.getElementById('promo-overlay').style.display = 'none';
                    // Optional: add smooth scroll to menu if it exists
                    const menu = document.querySelector('menutech-platform-orders, menutech-gallery');
                    if (menu) menu.scrollIntoView({ behavior: 'smooth' });
                };
            }
        } else {
            this.shadowRoot.innerHTML = `
                ${styles}
                ${particlesHTML}
                <div class="promo-section">
                    <img src="${imageUrl}" alt="${this.eventType} promotion" loading="lazy" width="600" height="600">
                    ${customLabel ? `
                        <a href="#" class="btn-cta" id="cta-button-section">${customLabel}</a>
                    ` : ''}
                </div>
            `;
            if (customLabel) {
                this.shadowRoot.getElementById('cta-button-section').onclick = (e) => {
                    e.preventDefault();
                    const menu = document.querySelector('menutech-platform-orders, menutech-gallery');
                    if (menu) menu.scrollIntoView({ behavior: 'smooth' });
                };
            }
        }
    }
}

customElements.define('menutech-christmas', class extends MenutechPromoBase { constructor() { super('christmas'); } });
customElements.define('menutech-halloween', class extends MenutechPromoBase { constructor() { super('halloween'); } });
customElements.define('menutech-valentine', class extends MenutechPromoBase { constructor() { super('valentine'); } });
customElements.define('menutech-president', class extends MenutechPromoBase { constructor() { super('president'); } });
customElements.define('menutech-newyear', class extends MenutechPromoBase { constructor() { super('newyear'); } });
customElements.define('menutech-independence', class extends MenutechPromoBase { constructor() { super('independence'); } });
customElements.define('menutech-thanksgiving', class extends MenutechPromoBase { constructor() { super('thanksgiving'); } });

/**
 * Menutech Forms Web Component
 * Usage: <menutech-forms domain="yoursite.com"></menutech-forms>
 */
class MenutechForms extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.config = MT_UI_CONFIG;
        this.supabase = null;
        this.formConfig = null;
    }

    async connectedCallback() {
        await this.initSupabase();
        this.render();
    }

    async initSupabase() {
        if (this.supabase) return;
        try {
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js");
            this.supabase = createClient(this.config.url, this.config.key);
        } catch (err) {
            console.error("MenutechForms Supabase Init Error:", err);
        }
    }

    async fetchFormConfig(domain) {
        if (!this.supabase) await this.initSupabase();
        try {
            const { data, error } = await this.supabase
                .from('menutech_forms')
                .select('*')
                .eq('domain', domain)
                .single();
            if (error) return null;
            return data;
        } catch (err) {
            return null;
        }
    }

    async render() {
        let domain = this.getAttribute('domain') || window.location.hostname;
        if (domain) domain = domain.replace(/^www\./, '').toLowerCase().trim();

        const fullData = await this.fetchFormConfig(domain);

        if (!fullData) {
            this.shadowRoot.innerHTML = '';
            return;
        }

        this.formId = fullData.id;
        this.formConfig = fullData.config;
        const { questions, primaryColor, successMsg, buttonText } = this.formConfig;

        const styles = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                    max-width: 600px;
                    margin: 40px auto;
                    font-family: 'Plus Jakarta Sans', sans-serif;
                    color: #1a1c1e;
                }
                .form-container {
                    background: #ffffff;
                    padding: 40px;
                    border-radius: 32px;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.05);
                    border: 1px solid #f0f0f0;
                    animation: fadeIn 0.8s ease;
                }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

                .form-group { margin-bottom: 24px; text-align: left; }
                .form-group label {
                    display: block;
                    font-size: 0.8rem;
                    font-weight: 700;
                    color: ${primaryColor};
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    margin-bottom: 10px;
                    margin-left: 4px;
                }
                .form-control {
                    width: 100%;
                    padding: 18px 22px;
                    border-radius: 20px;
                    border: 1.5px solid #eee;
                    background: #fcfcfc;
                    font-family: inherit;
                    font-size: 1rem;
                    box-sizing: border-box;
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .form-control:focus {
                    outline: none;
                    border-color: ${primaryColor};
                    background: #fff;
                    box-shadow: 0 0 0 5px ${primaryColor}15;
                }
                textarea.form-control { min-height: 120px; resize: vertical; }

                .btn-submit {
                    width: 100%;
                    padding: 20px;
                    border-radius: 22px;
                    border: none;
                    background: ${primaryColor};
                    color: #fff;
                    font-weight: 800;
                    font-size: 1rem;
                    cursor: pointer;
                    transition: 0.4s;
                    margin-top: 10px;
                    box-shadow: 0 10px 25px ${primaryColor}40;
                }
                .btn-submit:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 15px 30px ${primaryColor}60;
                }
                .btn-submit:active { transform: translateY(-1px); }
                .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

                .message {
                    margin-top: 25px;
                    padding: 20px;
                    border-radius: 20px;
                    font-weight: 600;
                    text-align: center;
                    display: none;
                    animation: slideUp 0.5s ease;
                }
                @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                .message.success { display: none; background: #ecfdf5; color: #059669; border: 1px solid #d1fae5; }
                .message.error { display: none; background: #fef2f2; color: #dc2626; border: 1px solid #fee2e2; }

                .error-shake { animation: shake 0.4s ease; border-color: #dc2626 !important; }
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }

                @media (max-width: 600px) {
                    .form-container { padding: 30px 20px; border-radius: 24px; }
                }
            </style>
        `;

        const questionsHtml = questions.map(q => {
            let input = '';
            const requiredAttr = q.required ? 'required' : '';
            if (q.type === 'textarea') {
                input = `<textarea class="form-control" name="${q.label}" ${requiredAttr} placeholder="Write here..."></textarea>`;
            } else if (q.type === 'select') {
                const options = q.options.split(',').map(o => o.trim());
                input = `
                    <select class="form-control" name="${q.label}" ${requiredAttr}>
                        <option value="" disabled selected>Select an option</option>
                        ${options.map(o => `<option value="${o}">${o}</option>`).join('')}
                    </select>
                `;
            } else {
                input = `<input type="${q.type}" class="form-control" name="${q.label}" ${requiredAttr} placeholder="Enter ${q.label.toLowerCase()}...">`;
            }

            return `
                <div class="form-group">
                    <label>${q.label}${q.required ? ' *' : ''}</label>
                    ${input}
                </div>
            `;
        }).join('');

        this.shadowRoot.innerHTML = `
            ${styles}
            <div class="form-container">
                <form id="mt-form">
                    ${questionsHtml}
                    <button type="submit" class="btn-submit">${buttonText || 'SEND RESPONSE'}</button>
                </form>
                <div id="msg-success" class="message success">${successMsg}</div>
                <div id="msg-error" class="message error">Please fill all required fields correctly.</div>
            </div>
        `;

        this.shadowRoot.getElementById('mt-form').onsubmit = (e) => this.handleSubmit(e);
        this.shadowRoot.querySelectorAll('.form-control').forEach(input => {
            input.oninput = () => input.classList.remove('error-shake');
        });
    }

    async handleSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const btn = form.querySelector('.btn-submit');
        const successMsg = this.shadowRoot.getElementById('msg-success');
        const errorMsg = this.shadowRoot.getElementById('msg-error');

        successMsg.style.display = 'none';
        errorMsg.style.display = 'none';

        const formData = new FormData(form);
        const respuestas = {};
        let isValid = true;

        this.formConfig.questions.forEach(q => {
            const val = formData.get(q.label);
            if (q.required && !val) {
                isValid = false;
                const input = form.querySelector(`[name="${q.label}"]`);
                input.classList.add('error-shake');
                setTimeout(() => input.classList.remove('error-shake'), 400);
            }
            respuestas[q.label] = val;
        });

        if (!isValid) {
            errorMsg.style.display = 'block';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'SENDING...';

        try {
            let domain = this.getAttribute('domain') || window.location.hostname;
            if (domain) domain = domain.replace(/^www\./, '').toLowerCase().trim();

            const { error } = await this.supabase
                .from('menutech_forms_respuestas')
                .insert({
                    form_id: this.formId,
                    domain: domain,
                    respuestas: respuestas
                });

            if (error) throw error;

            form.style.display = 'none';
            successMsg.style.display = 'block';
        } catch (err) {
            console.error("Form submission error:", err);
            btn.disabled = false;
            btn.textContent = 'SEND RESPONSE';
            errorMsg.textContent = 'An error occurred. Please try again later.';
            errorMsg.style.display = 'block';
        }
    }
}

if (!customElements.get('menutech-forms')) {
    customElements.define('menutech-forms', MenutechForms);
}

/**
 * Menutech Platform Orders Web Component
 * Usage: <menutech-platform-orders domain="yoursite.com"></menutech-platform-orders>
 */
class MenutechPlatformOrders extends HTMLElement {
    static get observedAttributes() {
        return ['domain', 'restaurant', 'view', 'custom-label'];
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal !== newVal) {
            this.render();
        }
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.config = MT_UI_CONFIG;
        this.supabase = null;
        this.menuData = null;
        this.cart = [];
        this.trackingChannel = null;
        this.popupRoot = this.shadowRoot;
    }

    async connectedCallback() {
        await this.initSupabase();
        // Prefetch data immediately so it's ready when clicked
        this.loadData();
        this.render();
        this.checkExistingOrder();
    }

    disconnectedCallback() {
        if (this._windowScrollHandler) {
            window.removeEventListener('scroll', this._windowScrollHandler);
        }
        if (this._dishObserver) {
            this._dishObserver.disconnect();
        }
        if (this._portal && this._portal.parentNode) {
            this._portal.parentNode.removeChild(this._portal);
        }
    }

    async initSupabase() {
        if (this.supabase) return;
        try {
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js");
            this.supabase = createClient(this.config.url, this.config.key);
        } catch (err) {
            console.error("MenutechPlatformOrders Supabase Init Error:", err);
        }
    }

    async fetchMenuData(identifier, isSlug = false) {
        if (!this.supabase) await this.initSupabase();
        try {
            const query = this.supabase.from('menutech_menus').select('*');
            if (isSlug) {
                query.eq('slug', identifier);
            } else {
                query.eq('domain', identifier);
            }
            const { data, error } = await query.single();
            if (error) return null;

            if (data && data.user_id && (!data.config || !data.config.restaurant_name)) {
                try {
                    const { data: prof } = await this.supabase
                        .from('profiles')
                        .select('username')
                        .eq('id', data.user_id)
                        .maybeSingle();
                    if (prof && prof.username) {
                        if (!data.config) data.config = {};
                        data.config.restaurant_name = prof.username;
                    }
                } catch(e) {}
            }

            return data;
        } catch (err) {
            return null;
        }
    }

    render() {
        const view = this.getAttribute('view');
        if (view === 'popup') {
            this.renderPopupTrigger();
        } else {
            this.renderLoading();
            this.loadData();
        }
        this.renderFloatingTracker();
    }

    renderFloatingTracker() {
        const lastOrderId = localStorage.getItem('mt_last_order_id');
        if (!lastOrderId) {
            const existing = this.popupRoot.getElementById('floating-tracker');
            if (existing) existing.remove();
            return;
        }

        let tracker = this.popupRoot.getElementById('floating-tracker');
        if (!tracker) {
            tracker = document.createElement('div');
            tracker.id = 'floating-tracker';
            this.popupRoot.appendChild(tracker);
        }

        tracker.innerHTML = `
            <style>
                #floating-tracker {
                    position: fixed; bottom: 100px; right: 30px; z-index: 400;
                    background: #1a1c1e; color: #fff; padding: 12px 20px;
                    border-radius: 30px; cursor: pointer; display: flex; align-items: center; gap: 10px;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.2); animation: slideIn 0.5s ease;
                    font-family: 'Plus Jakarta Sans', sans-serif; font-size: 0.85rem; font-weight: 700;
                }
                @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
                .tracker-dot { width: 8px; height: 8px; background: #ff9533; border-radius: 50%; animation: pulse 1.5s infinite; }
                @keyframes pulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } 100% { transform: scale(1); opacity: 1; } }
            </style>
            <div class="tracker-dot"></div>
            <span>TRACK MY ORDER</span>
        `;
        tracker.onclick = () => this.showOrderTracking(lastOrderId);
    }

    renderPopupTrigger() {
        // Initialize global Portal element in document.body
        let portal = document.getElementById('menutech-popup-portal');
        if (!portal) {
            portal = document.createElement('div');
            portal.id = 'menutech-popup-portal';
            portal.style.position = 'static';
            document.body.appendChild(portal);
        }
        this._portal = portal;
        if (!portal.shadowRoot) {
            portal.attachShadow({ mode: 'open' });
        }
        this.popupRoot = portal.shadowRoot;

        const customLabel = this.getAttribute('custom-label') || 'See MENU & Order Now!';
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    text-align: center;
                    width: 100%;
                    font-family: 'Helvetica', 'Arial', sans-serif;
                    box-sizing: border-box;
                }
                .btn-see-menu {
                    background: #ff9533;
                    color: #fff;
                    padding: 18px 36px;
                    border-radius: 40px;
                    font-weight: 800;
                    border: none;
                    cursor: pointer;
                    box-shadow: 0 10px 30px rgba(255,149,51,0.3);
                    text-transform: uppercase;
                    font-size: 1rem;
                    transition: 0.3s;
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    margin: 0 auto;
                }
                .btn-see-menu:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 15px 40px rgba(255,149,51,0.4);
                    filter: brightness(1.1);
                }
                .btn-see-menu svg { width: 20px; height: 20px; stroke-width: 2.5; }
            </style>
            <button class="btn-see-menu" id="trigger-popup">
                <span>${customLabel}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8L22 12L18 16"/><path d="M2 12H22"/></svg>
            </button>
        `;

        // Render the actual popup overlay inside the popupRoot portal shadow root
        this.popupRoot.innerHTML = `
            <style>
                .main-popup-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.8);
                    backdrop-filter: blur(10px);
                    z-index: 100000;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    animation: fadeIn 0.4s ease;
                    font-family: 'Helvetica', 'Arial', sans-serif;
                }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

                .main-popup-content {
                    width: 100%;
                    height: 100%;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                }

                #menu-container-inner {
                    height: 100%;
                    overflow: hidden;
                    background: #fff;
                }

                .close-main-popup {
                    position: absolute;
                    top: 15px;
                    right: 15px;
                    width: 38px;
                    height: 38px;
                    border-radius: 50%;
                    background: #ef4444;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 10px 20px rgba(0,0,0,0.25);
                    z-index: 100001;
                    transition: 0.3s;
                }
                .close-main-popup svg {
                    color: #fff !important;
                }
                .close-main-popup:hover {
                    transform: scale(1.1);
                    background: #dc2626;
                }

                @media (min-width: 769px) {
                    .main-popup-content {
                        width: 90%;
                        max-width: 800px;
                        height: 90%;
                        max-height: 800px;
                        border-radius: 24px;
                        overflow: visible;
                    }
                    #menu-container-inner {
                        border-radius: 24px;
                        box-shadow: 0 25px 50px rgba(0,0,0,0.5);
                    }
                    .close-main-popup {
                        top: -15px;
                        right: -15px;
                        width: 38px;
                        height: 38px;
                    }
                }
            </style>
            <div class="main-popup-overlay" id="main-menu-popup">
                <div class="main-popup-content">
                    <button class="close-main-popup" id="close-main-menu">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:20px;height:20px;color:#fff"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    <div id="menu-container-inner">
                        <div class="loader" style="padding: 100px; text-align: center; color: #ff9533; font-weight: 600;">Loading Menu...</div>
                    </div>
                </div>
            </div>
        `;

        this.shadowRoot.getElementById('trigger-popup').onclick = () => {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                const domain = this.getAttribute('domain') || window.location.hostname.replace(/^www\./, '');
                const slug = this.getAttribute('restaurant');
                // Construct path to menu.html relative to menutechUI.js or absolute depending on use
                let path = 'menu.html';
                if (slug) {
                    path += `?n=${slug}`;
                } else {
                    path += `?domain=${domain}`;
                }
                // Try absolute URL if we are embedded elsewhere
                const currentScript = document.querySelector('script[src*="menutechUI.js"]');
                if (currentScript) {
                    const src = currentScript.getAttribute('src');
                    if (src && src.startsWith('http')) {
                        const url = new URL(src);
                        path = `${url.origin}/menu.html` + (slug ? `?n=${slug}` : `?domain=${domain}`);
                    }
                }
                // Open directly in a new tab for mobile
                window.open(path, '_blank');
            } else {
                this.popupRoot.getElementById('main-menu-popup').style.display = 'flex';
                document.body.style.overflow = 'hidden';
                if (!this.menuData) {
                    this.loadData();
                }
            }
        };

        this.popupRoot.getElementById('close-main-menu').onclick = () => {
            this.popupRoot.getElementById('main-menu-popup').style.display = 'none';
            document.body.style.overflow = '';
        };
    }

    async loadData() {
        const slug = this.getAttribute('restaurant');
        const domain = this.getAttribute('domain') || window.location.hostname.replace(/^www\./, '');

        const data = slug
            ? await this.fetchMenuData(slug, true)
            : await this.fetchMenuData(domain, false);

        if (!data) {
            const errorMsg = '<div style="padding: 40px; text-align: center; color: #666;">Menu not found.</div>';
            if (this.getAttribute('view') === 'popup') {
                this.popupRoot.getElementById('menu-container-inner').innerHTML = errorMsg;
            } else {
                this.popupRoot.innerHTML = errorMsg;
            }
            return;
        }
        this.menuData = data;
        if (data.config && data.config.restaurant_name && document.title.includes('Menutech')) {
            document.title = data.config.restaurant_name;
        }

        // Check if restaurant is suspended or has Stripe online payments enabled
        this.onlinePaymentEnabled = false;
        if (data.user_id && this.supabase) {
            try {
                const { data: prof } = await this.supabase
                    .from('profiles')
                    .select('is_suspended')
                    .eq('id', data.user_id)
                    .maybeSingle();
                if (prof && prof.is_suspended) {
                    const isSpanish = (data.config && data.config.language === 'es') || (localStorage.getItem('menutech_restaurant_language') === 'es');
                    const suspendMsg = isSpanish
                        ? '<div style="padding: 60px 20px; text-align: center; font-family: sans-serif; color: #64748b;"><div style="font-size: 2.5rem; margin-bottom: 15px;">⏳</div><h3 style="color:#1a1c1e; margin-bottom: 8px;">Servicio no disponible temporalmente</h3><p style="margin: 0; font-size: 0.95rem;">El menú y sistema de pedidos no están disponibles en este momento. Por favor, intenta más tarde.</p></div>'
                        : '<div style="padding: 60px 20px; text-align: center; font-family: sans-serif; color: #64748b;"><div style="font-size: 2.5rem; margin-bottom: 15px;">⏳</div><h3 style="color:#1a1c1e; margin-bottom: 8px;">Service Temporarily Unavailable</h3><p style="margin: 0; font-size: 0.95rem;">The menu and ordering system are temporarily unavailable. Please check back later.</p></div>';

                    if (this.getAttribute('view') === 'popup') {
                        this.popupRoot.getElementById('menu-container-inner').innerHTML = suspendMsg;
                    } else {
                        this.popupRoot.innerHTML = suspendMsg;
                    }
                    return;
                }

                const { data: stripeAcc } = await this.supabase
                    .from('menutech_stripe_accounts')
                    .select('charges_enabled')
                    .eq('user_id', data.user_id)
                    .maybeSingle();
                if (stripeAcc && stripeAcc.charges_enabled) {
                    this.onlinePaymentEnabled = true;
                }
            } catch(e) {}
        }

        this.renderMenu();
    }

    renderLoading() {
        this.popupRoot.innerHTML = `
            <style>
                :host { display: block; font-family: 'Plus Jakarta Sans', sans-serif; }
                .loader { padding: 100px; text-align: center; color: #ff9533; font-weight: 600; }
            </style>
            <div class="loader">Loading Menu...</div>
        `;
    }

    renderMenu() {
        const { cover_url, cover_type, config, menu_style } = this.menuData;
        const isPopupView = this.getAttribute('view') === 'popup';
        const style = menu_style || 'mode1';
        const categoriesData = config.categories || [];
        const toppings = config.toppings || [];

        const now = new Date();
        const currentDay = now.getDay();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const localYear = now.getFullYear();
        const localMonth = String(now.getMonth() + 1).padStart(2, '0');
        const localDay = String(now.getDate()).padStart(2, '0');
        const currentDate = `${localYear}-${localMonth}-${localDay}`;

        const categories = categoriesData.filter(cat => {
            const vis = cat.visibility;
            if (!vis) return true;

            // Date Range Check (YYYY-MM-DD)
            if (vis.startDate && vis.startDate.trim() !== '' && currentDate < vis.startDate) return false;
            if (vis.endDate && vis.endDate.trim() !== '' && currentDate > vis.endDate) return false;

            // Days of Week Check (0 = Sun, 1 = Mon, ..., 6 = Sat)
            if (vis.days && Array.isArray(vis.days)) {
                const numDays = vis.days.map(Number);
                if (!numDays.includes(currentDay)) return false;
            }

            // Time Range Check (HH:MM)
            const startTime = vis.start ? vis.start.trim() : '';
            const endTime = vis.end ? vis.end.trim() : '';
            if (startTime && endTime) {
                if (startTime <= endTime) {
                    if (currentTime < startTime || currentTime > endTime) return false;
                } else {
                    // Overnight time range (e.g., 22:00 to 02:00)
                    if (currentTime < startTime && currentTime > endTime) return false;
                }
            } else if (startTime) {
                if (currentTime < startTime) return false;
            } else if (endTime) {
                if (currentTime > endTime) return false;
            }

            return true;
        });

        const hostStyle = isPopupView ? `
                :host {
                    display: block;
                    text-align: center;
                    width: 100%;
                    font-family: 'Helvetica', 'Arial', sans-serif;
                    box-sizing: border-box;
                }
        ` : `
                :host { display: block; font-family: 'Helvetica', 'Arial', sans-serif; color: #1a1c1e; background: #f0f2f5; min-height: 100vh; }
        `;

        const styles = `
            <style>
                ${hostStyle}

                * { box-sizing: border-box; }

                .menu-wrapper {
                    max-width: 940px; margin: 30px auto; background: #fff; height: calc(100vh - 60px);
                    box-shadow: 0 40px 120px rgba(0,0,0,0.2);
                    border-radius: 12px; overflow-y: auto;
                    position: relative;
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                }
                :host([view="popup"]) .menu-wrapper {
                    height: 100% !important;
                    margin: 0 !important;
                    border-radius: 24px !important;
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                }
                .menu-wrapper::-webkit-scrollbar { display: none; }
                .cart-left-col::-webkit-scrollbar, .cart-right-col > div::-webkit-scrollbar { display: none; }
                .popup-card::-webkit-scrollbar { display: none; }
                .popup-card { scrollbar-width: none; }

                @media (max-width: 1024px) {
                    :host { background: #fff; }
                    .menu-wrapper { margin: 0; width: 100%; height: 100vh; border-radius: 0; box-shadow: none; }
                }

                .cover-container { width: 100%; height: 200px; position: relative; overflow: hidden; }
                .cover-container img, .cover-container video { width: 100%; height: 100%; object-fit: cover; }

                .menu-content { padding: ${style === 'mode2' ? '0' : '20px'}; }

                /* Mode 1 Tabs */
                .category-tabs {
                    position: sticky; top: 0; background: rgba(255,255,255,0.8);
                    backdrop-filter: blur(10px); z-index: 100; margin: -20px -20px 20px -20px;
                    padding: 15px 20px; display: flex; gap: 12px; overflow-x: auto;
                    scrollbar-width: none; border-bottom: 1px solid #f0f0f0;
                }
                .category-tabs::-webkit-scrollbar { display: none; }
                .tab {
                    padding: 8px 18px; border-radius: 20px; background: #f0f0f0;
                    font-size: 0.9rem; font-weight: 600; white-space: nowrap; cursor: pointer;
                    transition: 0.3s; color: #666;
                }
                .tab.active { background: #ff9533; color: #fff; box-shadow: 0 4px 12px rgba(255,149,51,0.3); }

                /* Category Section */
                .category-section { margin-bottom: 60px; scroll-margin-top: 80px; }
                .category-header { margin-bottom: 20px; ${style === 'mode2' ? 'padding: 0 20px;' : ''} }
                .category-header h2 {
                    margin: 0; font-size: 1.6rem; color: #1a1c1e;
                    ${style === 'mode2' ? 'border-bottom: 2px solid #f0f0f0; padding-bottom: 10px; text-transform: uppercase; font-size: 1.8rem; letter-spacing: 2px; font-weight: 900; margin-top: 20px;' : ''}
                }
                .category-header p { margin: 5px 0 0; color: #666; font-size: 0.95rem; }

                /* Dish Grid - Mode 1 */
                .dish-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                @media (max-width: 600px) { .dish-grid { grid-template-columns: 1fr; } }

                .dish-card {
                    background: #fff; border-radius: 24px; padding: 15px;
                    display: flex; gap: 15px; cursor: pointer; transition: 0.3s;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.03); border: 1px solid #f8f8f8;
                    text-align: left;
                }
                .dish-card:hover { transform: translateY(-5px); box-shadow: 0 15px 40px rgba(0,0,0,0.06); }

                /* Mode 2 Styles */
                .mode2-main-header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 12px 20px; background: #fff; border-bottom: 1px solid #eee;
                }
                .restaurant-name { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 1.3rem; font-weight: 800; margin: 0; color: #444; text-transform: uppercase; letter-spacing: -0.5px; }
                .header-icons { display: flex; border: 1.5px solid #eee; border-radius: 6px; overflow: hidden; }
                .header-icon {
                    padding: 10px 14px; border-right: 1.5px solid #eee; display: flex; align-items: center; justify-content: center;
                    background: #fff; color: #333; cursor: pointer; position: relative;
                }
                .header-icon:last-child { border-right: none; }
                .header-icon svg { width: 22px; height: 22px; stroke-width: 1.8; }
                .header-icon.active { background: #f0f0f0; }
                .cart-count-badge {
                    position: absolute; top: 4px; right: 4px; background: #ff9533;
                    color: #fff; width: 16px; height: 16px; border-radius: 50%;
                    font-size: 9px; font-weight: 800; display: flex; align-items: center; justify-content: center;
                }

                .mode2-list { display: grid; grid-template-columns: 1fr 1fr; gap: 0 40px; padding: 0 20px; }
                @media (max-width: 768px) { .mode2-list { grid-template-columns: 1fr; gap: 0; } }
                .mode2-item {
                    display: flex; flex-direction: column; padding: 18px 0;
                    border-bottom: 1px solid #eee; cursor: pointer; transition: 0.2s;
                    text-align: left;
                }
                .mode2-item:hover { background: #fcfcfc; }
                .mode2-top-row { display: flex; justify-content: flex-start; align-items: flex-start; gap: 15px; }
                .mode2-left { flex: 1; text-align: left; }
                .mode2-name-price { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
                .mode2-name { font-weight: 800; font-size: 1.05rem; color: #333; text-transform: uppercase; font-family: 'Helvetica', 'Arial', sans-serif; text-align: left; }
                .mode2-price { font-weight: 800; color: #333; font-size: 1.05rem; font-family: 'Helvetica', 'Arial', sans-serif; }
                .mode2-image { width: 80px; height: 80px; border-radius: 12px; overflow: hidden; flex-shrink: 0; }
                .mode2-image img { width: 100%; height: 100%; object-fit: cover; }
                .mode2-desc { font-size: 0.88rem; color: #777; line-height: 1.4; margin: 0; font-family: 'Helvetica', 'Arial', sans-serif; text-align: left; }

                .dish-info { flex: 1; display: flex; flex-direction: column; justify-content: space-between; text-align: left; }
                .dish-info h3 { margin: 0; font-size: 1.1rem; color: #1a1c1e; text-align: left; }
                .dish-info p { margin: 5px 0; color: #666; font-size: 0.85rem; line-height: 1.4;
                    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-align: left; }
                .dish-price { font-weight: 700; color: #ff9533; font-size: 1.1rem; margin-top: 10px; }

                .dish-image { width: 100px; height: 100px; border-radius: 18px; overflow: hidden; flex-shrink: 0; }
                .dish-image img { width: 100%; height: 100%; object-fit: cover; }

                /* Cart Button */
                .cart-btn {
                    position: fixed; bottom: 30px; right: 30px;
                    background: #ff9533; color: #fff; width: 60px; height: 60px;
                    border-radius: 50%; display: flex; align-items: center; justify-content: center;
                    box-shadow: 0 15px 35px rgba(255,149,51,0.4); cursor: pointer; z-index: 500;
                    transition: 0.3s;
                }
                .cart-btn:hover { transform: scale(1.1); }
                .cart-count {
                    position: absolute; top: -5px; right: -5px; background: #000;
                    color: #fff; width: 22px; height: 22px; border-radius: 50%;
                    font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center;
                }

                /* Popup */
                .popup-overlay {
                    position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
                    z-index: 1000; display: none; align-items: center; justify-content: center;
                    transition: 0.3s;
                }
                .popup-overlay.side-popup { align-items: center; justify-content: center; }

                .popup-card {
                    background: #fff; width: 95%; max-width: 500px; border-radius: 24px;
                    max-height: 90vh; overflow-y: auto; position: relative;
                    scrollbar-width: none; -ms-overflow-style: none;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s;
                    margin: auto;
                }

                /* Cart Styles */
                .cart-section { margin-bottom: 0; border-bottom: 1.5px solid #eee; }
                .cart-section:last-child { border-bottom: none; }
                .cart-section-header {
                    padding: 18px 20px; display: flex; justify-content: space-between; align-items: center;
                    cursor: pointer; font-weight: 800; text-transform: uppercase; font-size: 0.82rem;
                    letter-spacing: 0.8px; color: #333; font-family: 'Helvetica', 'Arial', sans-serif;
                }
                .cart-section-content { padding: 0 20px 20px; display: none; }
                .cart-section.active .cart-section-content { display: block; }
                .cart-section.active .cart-section-header svg { transform: rotate(180deg); }
                .cart-section-header svg { transition: 0.3s; width: 18px; height: 18px; }

                /* Cart PC Two-Column Layout */
                .cart-pc-container { display: flex; flex-direction: row; gap: 0; align-items: stretch; min-height: 500px; }
                .cart-left-col { flex: 1; border-right: 1.5px solid #eee; padding: 0; }
                .cart-right-col { width: 380px; background: #fcfcfc; padding: 0; display: flex; flex-direction: column; }

                @media (max-width: 1024px) {
                    .cart-pc-container { flex-direction: column; }
                    .cart-left-col { border-right: none; border-bottom: 1.5px solid #eee; }
                    .cart-right-col { width: 100%; }
                }

                .cart-item { display: flex; justify-content: space-between; align-items: center; padding: 15px 0; border-bottom: 1px solid #f9f9f9; }
                .cart-item:last-child { border: none; }
                .cart-item-info { flex: 1; }
                .cart-item-info h4 { margin: 0; font-size: 1rem; }
                .cart-item-info p { margin: 4px 0 0; font-size: 0.8rem; color: #888; }
                .cart-item-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
                .cart-item-price { font-weight: 700; }
                .cart-qty-controls { display: flex; align-items: center; background: #f0f0f0; border-radius: 8px; padding: 2px; }
                .cart-qty-btn { width: 24px; height: 24px; border: none; background: none; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #333; }
                .cart-qty-val { width: 24px; text-align: center; font-size: 0.85rem; font-weight: 800; }
                .remove-item { color: #ff4444; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
                .remove-item:hover { color: #cc0000; transform: scale(1.1); }

                .cart-input-group { margin-bottom: 15px; }
                .cart-input-group label { display: block; font-size: 0.75rem; font-weight: 700; margin-bottom: 8px; color: #666; }
                .cart-input {
                    width: 100%; padding: 14px; border-radius: 12px; border: 1.5px solid #eee;
                    font-family: inherit; font-size: 0.95rem; box-sizing: border-box; transition: 0.3s;
                }
                .cart-input:focus { outline: none; border-color: #ff9533; background: #fffefb; }

                .payment-option, .type-option, .time-option {
                    display: flex; align-items: center; justify-content: space-between; padding: 16px;
                    border-radius: 12px; border: 1.5px solid #eee; margin-bottom: 12px;
                    cursor: pointer; transition: 0.2s; font-weight: 700; font-size: 0.9rem;
                    color: #555;
                }
                .payment-option.active, .type-option.active, .time-option.active {
                    border-color: #ff9533; background: #fffcf5; color: #ff9533;
                }
                .option-check {
                    width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid #ddd;
                    display: flex; align-items: center; justify-content: center; font-size: 12px; color: transparent;
                }
                .active .option-check { background: #ff9533; border-color: #ff9533; color: #fff; }

                .order-summary { background: #fafafa; padding: 20px; border-radius: 20px; margin-top: 20px; }
                .summary-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 0.9rem; }
                .summary-row.total { font-weight: 800; font-size: 1.2rem; color: #1a1c1e; margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee; }

                .sending-animation {
                    position: fixed; inset: 0; background: #fff; z-index: 2000;
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    text-align: center; padding: 40px; animation: fadeIn 0.5s ease;
                }
                .check-mark {
                    width: 80px; height: 80px; background: #059669; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    color: #fff; font-size: 40px; margin-bottom: 20px;
                    box-shadow: 0 10px 25px rgba(5,150,105,0.3);
                }

                @media (min-width: 1024px) {
                    .popup-overlay.side-popup { background: rgba(0,0,0,0.3); backdrop-filter: blur(4px); }
                    .popup-card.open-right { transform: translateX(250px); }
                    .popup-card.open-left { transform: translateX(-250px); }
                }

                @media (max-width: 1024px) {
                    .popup-overlay { align-items: stretch; padding: 0; }
                    .popup-card {
                        width: 100%; max-width: 100%; height: 100vh; max-height: 100vh;
                        border-radius: 0; margin: 0;
                    }
                    .popup-img { height: 280px; }
                }

                .popup-img { width: 100%; height: 250px; position: relative; }
                .popup-img img { width: 100%; height: 100%; object-fit: cover; }
                .close-popup {
                    position: absolute; top: 20px; right: 20px; width: 40px; height: 40px;
                    border-radius: 50%; background: #fff; border: none; cursor: pointer;
                    display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 20px rgba(0,0,0,0.1);
                    z-index: 100; transition: 0.3s;
                }
                .close-popup:hover { transform: scale(1.1); background: #f8f8f8; }

                .popup-body { padding: 25px; font-family: 'Helvetica', 'Arial', sans-serif; }
                .popup-body h2 { margin: 0; font-size: 1.4rem; font-weight: 800; text-transform: uppercase; color: #333; }
                .popup-body .desc { color: #777; margin: 8px 0 24px; font-size: 0.95rem; line-height: 1.5; }

                .option-group { margin-bottom: 24px; }
                .option-title { font-weight: 800; font-size: 0.85rem; margin-bottom: 12px; display: flex; justify-content: space-between; color: #444; text-transform: uppercase; letter-spacing: 0.5px; }
                .option-badge { font-size: 0.65rem; background: #eee; padding: 3px 8px; border-radius: 4px; color: #888; font-weight: 700; }

                .option-item {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 14px 0; border-bottom: 1px solid #eee; cursor: pointer;
                }
                .option-item:last-child { border: none; }
                .opt-name { display: flex; align-items: center; gap: 10px; }
                .opt-price { color: #ff9533; font-weight: 600; }

                .radio, .checkbox { width: 22px; height: 22px; border: 2px solid #ddd; border-radius: 50%; position: relative; }
                .checkbox { border-radius: 6px; }
                .active .radio::after { content: ''; position: absolute; inset: 4px; background: #ff9533; border-radius: 50%; }
                .active .checkbox::after { content: '✓'; position: absolute; inset: 0; color: #ff9533; display: flex; align-items: center; justify-content: center; font-weight: 900; }

                .add-to-cart {
                    padding: 18px 24px; background: #ff9533; color: #fff; border: none;
                    border-radius: 12px; width: 100%; font-weight: 800; font-size: 1rem;
                    cursor: pointer; margin-top: 20px; box-shadow: 0 8px 20px rgba(255,149,51,0.25);
                    text-transform: uppercase; transition: 0.3s;
                }
                .add-to-cart:hover { background: #f08a28; transform: translateY(-2px); }

                /* Custom Modal */
                .modal-overlay {
                    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
                    backdrop-filter: blur(4px); z-index: 10000;
                    display: none; align-items: center; justify-content: center;
                    animation: fadeIn 0.3s ease;
                    padding: 20px;
                }
                .modal-card {
                    background: #fff; border-radius: 24px; padding: 30px;
                    width: 100%; max-width: 400px; text-align: center;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.15);
                    animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                    box-sizing: border-box;
                }
                .modal-card h3 { margin: 0 0 10px; font-family: 'Outfit', sans-serif; font-size: 1.3rem; color: #1a1c1e; text-transform: uppercase; }
                .modal-card p { margin: 0 0 25px; color: #666; line-height: 1.5; font-size: 0.95rem; }
                .modal-btn {
                    background: #ff9533; color: #fff; border: none; padding: 14px 30px;
                    border-radius: 14px; font-weight: 800; cursor: pointer; width: 100%;
                    transition: 0.3s; text-transform: uppercase; letter-spacing: 0.5px;
                }
                .modal-btn:hover { background: #f08a28; transform: translateY(-2px); }
                @keyframes scaleUp { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            </style>
        `;

        const optimizedCoverUrl = cover_url ? window.optimizeCloudinaryUrl(cover_url, { width: 1000 }) : '';
        const coverHtml = cover_url ? `
            <div class="cover-container">
                ${cover_type === 'video'
                    ? `<video src="${cover_url}" autoplay loop muted playsinline></video>`
                    : `<img src="${optimizedCoverUrl}" width="940" height="200">`
                }
            </div>
        ` : '';

        const tabsHtml = categories.map((cat, i) => `
            <div class="tab ${i === 0 ? 'active' : ''}" data-target="cat-${i}">${cat.name}</div>
        `).join('');

        const sectionsHtml = categories.map((cat, i) => `
            <div class="category-section" id="cat-${i}">
                <div class="category-header">
                    <h2>${cat.name}</h2>
                    ${cat.description ? `<p>${cat.description}</p>` : ''}
                </div>
                ${style === 'mode1' ? `
                    <div class="dish-grid">
                        ${(cat.dishes || []).map(dish => `
                            <div class="dish-card" data-dish='${JSON.stringify(dish).replace(/'/g, "&apos;")}'>
                                <div class="dish-info">
                                    <div>
                                        <h3>${dish.name}</h3>
                                        <p>${dish.description || ''}</p>
                                    </div>
                                    <div class="dish-price">$${dish.price}</div>
                                </div>
                                ${dish.image ? `<div class="dish-image"><img src="${window.optimizeCloudinaryUrl(dish.image, { width: 200, height: 200, crop: 'fill' })}" loading="lazy" width="100" height="100"></div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                ` : `
                    <div class="mode2-list">
                        ${(cat.dishes || []).map(dish => `
                            <div class="mode2-item" data-dish='${JSON.stringify(dish).replace(/'/g, "&apos;")}'>
                                <div class="mode2-top-row">
                                    ${dish.image ? `<div class="mode2-image"><img src="${window.optimizeCloudinaryUrl(dish.image, { width: 200, height: 200, crop: 'fill' })}" loading="lazy" width="80" height="80"></div>` : ''}
                                    <div class="mode2-left">
                                        <div class="mode2-name-price">
                                            <span class="mode2-name">${dish.name}</span>
                                            <span class="mode2-price">$${dish.price}</span>
                                        </div>
                                        <p class="mode2-desc">${dish.description || ''}</p>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `).join('');

        const menuHtml = `
            ${styles}
            <div class="menu-wrapper" style="${isPopupView ? 'height: 100%; margin: 0; max-width: 100%; border-radius: 0;' : ''}">
                ${style === 'mode2' ? `
                    <div class="mode2-main-header" style="${isPopupView ? 'padding-right: 80px;' : ''}">
                        <h1 class="restaurant-name">${config.restaurant_name || ''}</h1>
                        <div class="header-icons">
                            <div class="header-icon active" id="header-menu-btn">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                            </div>
                            <div class="header-icon" id="header-info-btn">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                            </div>
                            <div class="header-icon" id="header-cart-btn-top">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                                <div class="cart-count-badge" id="cart-count-top" style="display:none">0</div>
                            </div>
                        </div>
                    </div>
                ` : ''}
                ${coverHtml}
                <div class="menu-content">
                    ${style === 'mode1' ? `<div class="category-tabs">${tabsHtml}</div>` : ''}
                    <div class="sections-container">${sectionsHtml}</div>
                </div>
            </div>
            <div class="cart-btn" id="cart-btn" style="display:none">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:24px;"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                <div class="cart-count" id="cart-count">0</div>
            </div>
            <div class="popup-overlay" id="popup">
                <div class="popup-card" id="popup-content"></div>
            </div>
            <div class="modal-overlay" id="custom-modal">
                <div class="modal-card">
                    <h3 id="modal-title"></h3>
                    <p id="modal-message"></p>
                    <button class="modal-btn" id="modal-close-btn">ACEPTAR</button>
                </div>
            </div>
        `;

        if (isPopupView) {
            this.popupRoot.getElementById('menu-container-inner').innerHTML = menuHtml;
        } else {
            this.popupRoot.innerHTML = menuHtml;
        }

        this.initInteractivity();
    }

    initInteractivity() {
        const tabs = this.popupRoot.querySelectorAll('.tab');
        // dishDetailOverlay refers to the detailed dish/checkout popup element (#popup)
        const dishDetailOverlay = this.popupRoot.getElementById('popup');
        const popupContent = this.popupRoot.getElementById('popup-content');

        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const targetId = tab.getAttribute('data-target');
                const target = this.popupRoot.getElementById(targetId);
                target.scrollIntoView({ behavior: 'smooth' });
            };
        });

        // Sticky scroll highlight
        const sections = this.popupRoot.querySelectorAll('.category-section');
        const container = this.popupRoot.querySelector('.menu-content');

        const isPopupView = this.getAttribute('view') === 'popup';
        const scrollContainer = isPopupView ? this.popupRoot.querySelector('.menu-wrapper') : window;

        if (this._windowScrollHandler) {
            window.removeEventListener('scroll', this._windowScrollHandler);
            this._windowScrollHandler = null;
        }
        if (this._popupScrollHandler) {
            const oldPopupContainer = this.popupRoot.querySelector('.menu-wrapper');
            if (oldPopupContainer) {
                oldPopupContainer.removeEventListener('scroll', this._popupScrollHandler);
            }
            this._popupScrollHandler = null;
        }

        const handleScroll = () => {
            let current = '';
            sections.forEach(section => {
                const rect = section.getBoundingClientRect();
                // In both popup mode and full-page mode, check when section top is near the top of the viewing area
                if (rect.top <= 150) {
                    current = section.getAttribute('id');
                }
            });
            if (current) {
                tabs.forEach(tab => {
                    tab.classList.remove('active');
                    if (tab.getAttribute('data-target') === current) {
                        tab.classList.add('active');
                    }
                });
            }
        };

        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
            if (isPopupView) {
                this._popupScrollHandler = handleScroll;
            } else {
                this._windowScrollHandler = handleScroll;
            }
        }

        const cards = this.popupRoot.querySelectorAll('.dish-card, .mode2-item');
        cards.forEach(card => {
            card.onclick = (e) => {
                const dish = JSON.parse(card.getAttribute('data-dish'));
                this.openDishPopup(dish, card);
            };
        });

        const headerCartBtn = this.popupRoot.getElementById('header-cart-btn-top');
        if (headerCartBtn) {
            headerCartBtn.onclick = () => this.openCartPopup();
        }

        const headerInfoBtn = this.popupRoot.getElementById('header-info-btn');
        if (headerInfoBtn) {
            headerInfoBtn.onclick = () => {
                this.showModal('INFORMACIÓN', (this.menuData.config && this.menuData.config.restaurant_name) || 'Información del Restaurante');
            };
        }

        const headerMenuBtn = this.popupRoot.getElementById('header-menu-btn');
        if (headerMenuBtn) {
            headerMenuBtn.onclick = () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
        }

        dishDetailOverlay.onclick = (e) => {
            if (e.target === dishDetailOverlay) {
                dishDetailOverlay.style.display = 'none';
            }
        };

        if (this._dishObserver) {
            this._dishObserver.disconnect();
        }

        // MutationObserver to automatically hide/show #close-main-menu when detailed popup (#popup) is active
        const closeMainMenuBtn = this.popupRoot.getElementById('close-main-menu');
        if (closeMainMenuBtn && dishDetailOverlay) {
            this._dishObserver = new MutationObserver(() => {
                if (dishDetailOverlay.style.display === 'flex') {
                    closeMainMenuBtn.style.setProperty('display', 'none', 'important');
                } else {
                    closeMainMenuBtn.style.setProperty('display', 'flex');
                }
            });
            this._dishObserver.observe(dishDetailOverlay, { attributes: true, attributeFilter: ['style'] });
        }

        const modal = this.popupRoot.getElementById('custom-modal');
        this.popupRoot.getElementById('modal-close-btn').onclick = () => {
            modal.style.display = 'none';
        };
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };
    }

    showModal(title, message) {
        const modal = this.popupRoot.getElementById('custom-modal');
        this.popupRoot.getElementById('modal-title').textContent = title;
        this.popupRoot.getElementById('modal-message').textContent = message;
        modal.style.display = 'flex';
    }

    openDishPopup(dish, cardEl) {
        const overlay = this.popupRoot.getElementById('popup');
        const popupContent = this.popupRoot.getElementById('popup-content');

        // Reset maxWidth to default to prevent inheriting the checkout modal's 900px width on desktop
        popupContent.style.maxWidth = '';

        if (window.innerWidth > 1024 && cardEl) {
            const rect = cardEl.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const screenCenter = window.innerWidth / 2;

            overlay.classList.add('side-popup');
            popupContent.classList.remove('open-left', 'open-right');
            if (centerX < screenCenter) {
                popupContent.classList.add('open-right');
            } else {
                popupContent.classList.add('open-left');
            }
        } else {
            overlay.classList.remove('side-popup');
            popupContent.classList.remove('open-left', 'open-right');
        }

        const hasSizes = dish.sizes && dish.sizes.length > 0;
        const allToppings = this.menuData.config.toppings || [];
        const dishToppings = allToppings.filter(t => (dish.toppings || []).includes(t.id));

        const basePrice = hasSizes ? dish.sizes[0].price : dish.price;

        popupContent.innerHTML = `
            <div class="popup-img">
                ${dish.image ? `<img src="${window.optimizeCloudinaryUrl(dish.image, { width: 600 })}" width="500" height="250">` : '<div style="height:100%; background:#f0f0f0;"></div>'}
                <button class="close-popup">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:18px;height:18px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="popup-body">
                <h2>${dish.name}</h2>
                <p class="desc">${dish.description || ''}</p>

                ${hasSizes ? `
                    <div class="option-group">
                        <div class="option-title">CHOOSE SIZE <span class="option-badge">REQUIRED</span></div>
                        ${dish.sizes.map((s, i) => `
                            <div class="option-item ${i === 0 ? 'active' : ''}" data-type="size">
                                <div class="opt-name">
                                    <div class="radio"></div>
                                    <span>${s.name}</span>
                                </div>
                                <div class="opt-price">$${s.price}</div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                ${dishToppings.map(group => `
                    <div class="option-group" data-group-id="${group.id}" data-min="${group.min}" data-max="${group.max}">
                        <div class="option-title">
                            ${group.name.toUpperCase()}
                            <span class="option-badge">${group.min > 0 ? 'REQUIRED' : 'OPTIONAL'}</span>
                        </div>
                        ${group.items.map(item => `
                            <div class="option-item" data-type="topping" data-price="${item.price}">
                                <div class="opt-name">
                                    <div class="${group.max === 1 ? 'radio' : 'checkbox'}"></div>
                                    <span>${item.name}</span>
                                </div>
                                <div class="opt-price">${item.price > 0 ? '+$' + item.price : 'Free'}</div>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}

                <div class="option-group">
                    <div class="option-title">SPECIAL INSTRUCTIONS</div>
                    <textarea id="dish-instructions" style="width:100%; padding:15px; border-radius:12px; border:1.5px solid #eee; font-family:inherit; min-height:80px; resize:none; box-sizing:border-box; font-size:0.9rem;"></textarea>
                </div>

                <div style="display:flex; align-items:center; gap:15px; margin-top:25px;">
                    <div style="display:flex; align-items:center; background:#f8f8f8; border-radius:12px; padding:4px; border:1.5px solid #eee;">
                        <button class="qty-btn" id="qty-minus" style="width:36px; height:36px; border:none; background:none; font-size:1.2rem; cursor:pointer; color:#333; font-weight:800;">-</button>
                        <span id="dish-qty" style="width:36px; text-align:center; font-weight:800; font-size:1rem; color:#333;">1</span>
                        <button class="qty-btn" id="qty-plus" style="width:36px; height:36px; border:none; background:none; font-size:1.2rem; cursor:pointer; color:#333; font-weight:800;">+</button>
                    </div>
                    <button class="add-to-cart" style="margin-top:0; flex:1;">ADD TO CART • $${basePrice}</button>
                </div>
            </div>
        `;

        overlay.style.display = 'flex';

        popupContent.querySelector('.close-popup').onclick = () => {
            overlay.style.display = 'none';
        };

        // Size selection logic
        popupContent.querySelectorAll('.option-item[data-type="size"]').forEach(item => {
            item.onclick = () => {
                popupContent.querySelectorAll('.option-item[data-type="size"]').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this.updatePopupTotal(dish);
            };
        });

        // Quantity logic
        let qty = 1;
        const qtyEl = popupContent.querySelector('#dish-qty');
        popupContent.querySelector('#qty-plus').onclick = () => { qty++; qtyEl.textContent = qty; this.updatePopupTotal(dish, qty); };
        popupContent.querySelector('#qty-minus').onclick = () => { if(qty > 1) { qty--; qtyEl.textContent = qty; this.updatePopupTotal(dish, qty); } };

        // Topping selection logic
        popupContent.querySelectorAll('.option-group[data-group-id]').forEach(group => {
            const max = parseInt(group.getAttribute('data-max'));
            group.querySelectorAll('.option-item[data-type="topping"]').forEach(item => {
                item.onclick = () => {
                    if (max === 1) {
                        group.querySelectorAll('.option-item').forEach(i => i.classList.remove('active'));
                        item.classList.add('active');
                    } else {
                        const activeCount = group.querySelectorAll('.option-item.active').length;
                        if (item.classList.contains('active')) {
                            item.classList.remove('active');
                        } else if (activeCount < max) {
                            item.classList.add('active');
                        }
                    }
                    this.updatePopupTotal(dish, qty);
                };
            });
        });

        this.updatePopupTotal(dish, qty);
    }

    updatePopupTotal(dish, qty = 1) {
        const popupContent = this.popupRoot.getElementById('popup-content');
        let baseTotal = parseFloat(dish.price);

        // Check if size is selected
        const selectedSize = popupContent.querySelector('.option-item[data-type="size"].active');
        if (selectedSize) {
            baseTotal = parseFloat(selectedSize.querySelector('.opt-price').textContent.replace('$', ''));
        }

        // Add toppings
        popupContent.querySelectorAll('.option-item[data-type="topping"].active').forEach(item => {
            baseTotal += parseFloat(item.getAttribute('price') || item.getAttribute('data-price') || 0);
        });

        const total = baseTotal * qty;
        const btn = popupContent.querySelector('.add-to-cart');
        btn.textContent = `ADD TO CART • $${total.toFixed(2)}`;

        btn.onclick = () => {
            const item = {
                name: dish.name,
                price: baseTotal,
                total: total,
                quantity: qty,
                instructions: popupContent.querySelector('#dish-instructions').value,
                size: selectedSize ? selectedSize.querySelector('span').textContent : null,
                toppings: Array.from(popupContent.querySelectorAll('.option-item[data-type="topping"].active')).map(i => i.querySelector('span').textContent)
            };
            this.addToCart(item);
            this.popupRoot.getElementById('popup').style.display = 'none';
        };
    }

    addToCart(item) {
        this.cart.push(item);
        this.updateCartUI();
    }

    updateCartUI() {
        const btn = this.popupRoot.getElementById('cart-btn');
        const count = this.popupRoot.getElementById('cart-count');
        const countTop = this.popupRoot.getElementById('cart-count-top');

        const totalItems = this.cart.reduce((sum, item) => sum + (item.quantity || 1), 0);

        if (this.cart.length > 0) {
            if (btn) btn.style.display = 'flex';
            if (count) count.textContent = totalItems;
            if (countTop) {
                countTop.style.display = 'flex';
                countTop.textContent = totalItems;
            }
        } else {
            if (btn) btn.style.display = 'none';
            if (countTop) countTop.style.display = 'none';
        }

        if (btn) btn.onclick = () => this.openCartPopup();
    }

    openCartPopup() {
        const overlay = this.popupRoot.getElementById('popup');
        const popupContent = this.popupRoot.getElementById('popup-content');

        // Load saved values from localStorage
        const savedData = JSON.parse(localStorage.getItem('mt_customer_info') || '{}');

        // Save current form values if they exist
        const currentVals = {
            name: popupContent.querySelector('#cust-name')?.value || savedData.name || '',
            phone: popupContent.querySelector('#cust-phone')?.value || savedData.phone || '',
            email: popupContent.querySelector('#cust-email')?.value || savedData.email || '',
            address: popupContent.querySelector('#order-address')?.value || savedData.address || '',
            reference: popupContent.querySelector('#order-reference')?.value || savedData.reference || '',
            date: popupContent.querySelector('#order-date')?.value || '',
            time: popupContent.querySelector('#order-time')?.value || '',
            type: popupContent.querySelector('.type-option.active')?.dataset.type || 'pickup',
            timeMode: popupContent.querySelector('.time-option.active')?.dataset.time || 'asap',
            pay: popupContent.querySelector('.payment-option.active')?.dataset.pay || 'cash'
        };

        overlay.classList.remove('side-popup');
        popupContent.classList.remove('open-left', 'open-right');

        // Set width for two-column layout on PC
        if (window.innerWidth > 1024) {
            popupContent.style.maxWidth = '900px';
        } else {
            popupContent.style.maxWidth = '';
        }

        const total = this.cart.reduce((sum, item) => sum + (item.total || item.price), 0);
        const subtotal = total;

        popupContent.innerHTML = `
            <div class="popup-body" style="padding:0">
                <div style="padding:20px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f0f0f0;">
                    <h2 style="margin:0; font-size:1.4rem;">CHECKOUT</h2>
                    <button class="close-popup" style="position:static; border:1px solid #eee;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:18px;height:18px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div class="cart-pc-container">
                    <!-- Left Column: Information (Accordions) -->
                    <div class="cart-left-col" style="overflow-y:auto; scrollbar-width:none; height: 100%;">
                        <!-- Section: Contact Info -->
                        <div class="cart-section">
                            <div class="cart-section-header">1. CONTACT INFORMATION <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                            <div class="cart-section-content">
                                <div class="cart-input-group">
                                    <label>FULL NAME</label>
                                    <input type="text" id="cust-name" class="cart-input">
                                </div>
                                <div class="cart-input-group">
                                    <label>PHONE</label>
                                    <input type="tel" id="cust-phone" class="cart-input">
                                </div>
                                <div class="cart-input-group">
                                    <label>EMAIL</label>
                                    <input type="email" id="cust-email" class="cart-input">
                                </div>
                            </div>
                        </div>

                        <!-- Section: Type of Order -->
                        <div class="cart-section">
                            <div class="cart-section-header">2. ORDER TYPE <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                            <div class="cart-section-content">
                                <div class="type-option active" data-type="pickup">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
                                        PICKUP AT RESTAURANT
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                                <div class="type-option" data-type="delivery">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                                        HOME DELIVERY
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                                <div id="delivery-fields" style="display:none; margin-top:15px;">
                                    <div class="cart-input-group">
                                        <label>FULL ADDRESS</label>
                                        <div style="display:flex; gap:8px;">
                                            <input type="text" id="order-address" class="cart-input" placeholder="Street, number, neighborhood...">
                                            <button type="button" id="btn-verify-delivery-addr" style="background:#ff9533; color:#fff; border:none; border-radius:8px; padding:0 12px; font-weight:700; cursor:pointer; font-size:0.75rem;">CHECK</button>
                                        </div>
                                    </div>
                                    <div id="delivery-zone-status" style="margin-top:8px; font-size:0.75rem; font-weight:700; display:none;"></div>
                                    <div class="cart-input-group" style="margin-top:10px;">
                                        <label>REFERENCE / INDICATIONS</label>
                                        <input type="text" id="order-reference" class="cart-input" placeholder="Apartment, gate code, landmarks...">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Section: Schedule -->
                        <div class="cart-section">
                            <div class="cart-section-header">3. CHOOSE AVAILABLE TIME <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                            <div class="cart-section-content">
                                <div class="time-option active" data-time="asap">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                        AS SOON AS POSSIBLE (30 MIN APPROX.)
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                                <div class="time-option" data-time="later">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                        SCHEDULE FOR LATER
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                                <div id="later-fields" style="display:none; margin-top:15px; gap:10px;">
                                    <div class="cart-input-group" style="flex:1">
                                        <label>DATE</label>
                                        <input type="date" id="order-date" class="cart-input">
                                    </div>
                                    <div class="cart-input-group" style="flex:1">
                                        <label>TIME</label>
                                        <input type="time" id="order-time" class="cart-input">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Section: Payment Method -->
                        <div class="cart-section">
                            <div class="cart-section-header">4. PAYMENT METHOD <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                            <div class="cart-section-content">
                                <div class="payment-option active" data-pay="cash">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
                                        PAY AT RESTAURANT
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                                ${this.onlinePaymentEnabled ? `
                                    <div class="payment-option" data-pay="online">
                                        <div style="display:flex; align-items:center; gap:12px;">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                                            ONLINE PAYMENT (STRIPE)
                                        </div>
                                        <div class="option-check">✓</div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- Right Column: Summary & Items -->
                    <div class="cart-right-col">
                        <div style="padding:20px; flex:1; overflow-y:auto; scrollbar-width:none;">
                            <div style="font-weight:800; font-size:0.8rem; color:#888; text-transform:uppercase; margin-bottom:15px; letter-spacing:0.5px;">PRODUCTS SUMMARY</div>
                            ${this.cart.map((item, i) => `
                                <div class="cart-item">
                                    <div class="cart-item-info">
                                        <h4 style="text-transform:uppercase; font-family:'Helvetica', 'Arial', sans-serif;">${item.name}</h4>
                                        <p style="font-size:0.75rem;">${item.size ? item.size : ''} ${item.toppings.length > 0 ? '• ' + item.toppings.join(', ') : ''}</p>
                                        ${item.instructions ? `<p style="color:#ff9533; font-style:italic; font-size:0.75rem;">"${item.instructions}"</p>` : ''}
                                    </div>
                                    <div class="cart-item-right">
                                        <div class="cart-item-price" style="font-family:'Helvetica', 'Arial', sans-serif;">$${(item.total || (item.price * item.quantity)).toFixed(2)}</div>
                                        <div style="display:flex; align-items:center; gap:10px;">
                                            <div class="cart-qty-controls">
                                                <button class="cart-qty-btn cart-minus" data-index="${i}">-</button>
                                                <span class="cart-qty-val">${item.quantity}</span>
                                                <button class="cart-qty-btn cart-plus" data-index="${i}">+</button>
                                            </div>
                                            <div class="remove-item" data-index="${i}">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px; height:16px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>

                        <div class="order-summary" style="margin:0; padding:20px; background:#f0f0f0; border-top:1.5px solid #eee;">
                            <div class="summary-row"><span>SUBTOTAL</span><span id="summary-subtotal-val">$${subtotal.toFixed(2)}</span></div>
                            <div class="summary-row"><span id="summary-shipping-label">SHIPPING</span><span id="summary-shipping-val">$0.00</span></div>
                            <div class="summary-row total" style="border-top-color:#ddd;"><span>TOTAL</span><span id="summary-total-val">$${total.toFixed(2)}</span></div>
                            <button class="add-to-cart" id="send-order-btn" style="margin-top:20px; width:100%;">SEND ORDER • $${total.toFixed(2)}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        overlay.style.display = 'flex';
        popupContent.querySelector('.close-popup').onclick = () => overlay.style.display = 'none';

        // Restore values
        if (currentVals.name) popupContent.querySelector('#cust-name').value = currentVals.name;
        if (currentVals.phone) popupContent.querySelector('#cust-phone').value = currentVals.phone;
        if (currentVals.email && popupContent.querySelector('#cust-email')) popupContent.querySelector('#cust-email').value = currentVals.email;
        if (popupContent.querySelector('#order-address')) popupContent.querySelector('#order-address').value = currentVals.address;
        if (popupContent.querySelector('#order-reference')) popupContent.querySelector('#order-reference').value = currentVals.reference;
        if (popupContent.querySelector('#order-date')) popupContent.querySelector('#order-date').value = currentVals.date;
        if (popupContent.querySelector('#order-time')) popupContent.querySelector('#order-time').value = currentVals.time;

        // Restore active states
        if (currentVals.type === 'delivery') {
            popupContent.querySelectorAll('.type-option').forEach(o => o.classList.toggle('active', o.dataset.type === 'delivery'));
            const df = popupContent.querySelector('#delivery-fields');
            if (df) df.style.display = 'block';
        }
        if (currentVals.timeMode === 'later') {
            popupContent.querySelectorAll('.time-option').forEach(o => o.classList.toggle('active', o.dataset.time === 'later'));
            const lf = popupContent.querySelector('#later-fields');
            if (lf) lf.style.display = 'flex';
        }
        if (currentVals.pay === 'transfer') {
            popupContent.querySelectorAll('.payment-option').forEach(o => o.classList.toggle('active', o.dataset.pay === 'transfer'));
        }

        // Exclusive Accordion logic
        popupContent.querySelectorAll('.cart-section-header').forEach(header => {
            header.onclick = () => {
                const currentSection = header.parentElement;
                const wasActive = currentSection.classList.contains('active');

                // Close all sections
                popupContent.querySelectorAll('.cart-section').forEach(sec => sec.classList.remove('active'));

                // Toggle current if it wasn't active
                if (!wasActive) {
                    currentSection.classList.add('active');
                }
            };
        });

        // Type of Order toggles
        const typeOptions = popupContent.querySelectorAll('.type-option');
        const deliveryFields = popupContent.querySelector('#delivery-fields');
        typeOptions.forEach(opt => {
            opt.onclick = () => {
                typeOptions.forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                const isDelivery = opt.dataset.type === 'delivery';
                if (deliveryFields) deliveryFields.style.display = isDelivery ? 'block' : 'none';
                if (!isDelivery) {
                    this.appliedDeliveryFee = 0;
                    this.appliedDeliveryZone = null;
                    this.updateCartSummaryTotals();
                } else {
                    const currentAddr = popupContent.querySelector('#order-address')?.value;
                    if (currentAddr && currentAddr.trim().length > 3) {
                        this.validateDeliveryAddressCoverage(currentAddr.trim());
                    }
                }
            };
        });

        // Delivery address check button
        const checkAddrBtn = popupContent.querySelector('#btn-verify-delivery-addr');
        const addrInput = popupContent.querySelector('#order-address');
        if (checkAddrBtn && addrInput) {
            checkAddrBtn.onclick = () => {
                const addr = addrInput.value.trim();
                if (addr) this.validateDeliveryAddressCoverage(addr);
            };
            addrInput.onchange = () => {
                const addr = addrInput.value.trim();
                if (addr) this.validateDeliveryAddressCoverage(addr);
            };
        }

        // Time selection toggles
        const timeOptions = popupContent.querySelectorAll('.time-option');
        const laterFields = popupContent.querySelector('#later-fields');
        timeOptions.forEach(opt => {
            opt.onclick = () => {
                timeOptions.forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                if (laterFields) laterFields.style.display = opt.dataset.time === 'later' ? 'flex' : 'none';
            };
        });

        // Payment toggles
        const payOptions = popupContent.querySelectorAll('.payment-option');
        payOptions.forEach(opt => {
            opt.onclick = () => {
                payOptions.forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
            };
        });

        const sendBtn = popupContent.querySelector('#send-order-btn');
        if (sendBtn) sendBtn.onclick = () => this.sendOrder();

        // Cart manipulation logic
        popupContent.querySelectorAll('.cart-plus').forEach(btn => {
            btn.onclick = () => {
                const index = parseInt(btn.dataset.index);
                this.updateItemQuantity(index, 1);
            };
        });

        popupContent.querySelectorAll('.cart-minus').forEach(btn => {
            btn.onclick = () => {
                const index = parseInt(btn.dataset.index);
                this.updateItemQuantity(index, -1);
            };
        });

        popupContent.querySelectorAll('.remove-item').forEach(btn => {
            btn.onclick = () => {
                const index = parseInt(btn.dataset.index);
                this.removeItem(index);
            };
        });
    }

    updateCartSummaryTotals() {
        const popupContent = this.popupRoot.getElementById('popup-content');
        if (!popupContent) return;

        const subtotal = this.cart.reduce((sum, item) => sum + (item.total || item.price), 0);
        const fee = this.appliedDeliveryFee || 0;
        const total = subtotal + fee;

        const subtotalEl = popupContent.querySelector('#summary-subtotal-val');
        const shipLabelEl = popupContent.querySelector('#summary-shipping-label');
        const shipValEl = popupContent.querySelector('#summary-shipping-val');
        const totalEl = popupContent.querySelector('#summary-total-val');
        const sendBtn = popupContent.querySelector('#send-order-btn');

        if (subtotalEl) subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
        if (shipLabelEl) shipLabelEl.textContent = this.appliedDeliveryZone ? `DELIVERY (${this.appliedDeliveryZone.name})` : 'SHIPPING';
        if (shipValEl) shipValEl.textContent = `$${fee.toFixed(2)}`;
        if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
        if (sendBtn) sendBtn.textContent = `SEND ORDER • $${total.toFixed(2)}`;
    }

    async validateDeliveryAddressCoverage(address) {
        const popupContent = this.popupRoot.getElementById('popup-content');
        if (!popupContent) return false;

        const statusEl = popupContent.querySelector('#delivery-zone-status');
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#ff9533';
            statusEl.textContent = 'Checking delivery coverage...';
        }

        try {
            if (!this.supabase) await this.initSupabase();

            // Fetch active delivery zones for this restaurant
            const { data: zones } = await this.supabase
                .from('menutech_delivery_zones')
                .select('*')
                .eq('user_id', this.menuData.user_id)
                .eq('is_active', true)
                .order('fee', { ascending: true });

            if (!zones || zones.length === 0) {
                // No zones configured: delivery is available without fee restriction
                this.appliedDeliveryFee = 0;
                this.appliedDeliveryZone = null;
                if (statusEl) {
                    statusEl.style.color = '#059669';
                    statusEl.textContent = '✓ Delivery available';
                }
                this.updateCartSummaryTotals();
                return true;
            }

            // Geocode address via OpenStreetMap Nominatim
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
            const geoData = await geoRes.json();

            if (!geoData || geoData.length === 0) {
                if (statusEl) {
                    statusEl.style.color = '#dc2626';
                    statusEl.textContent = 'Address not recognized. Please provide a more specific street and number.';
                }
                this.appliedDeliveryFee = 0;
                this.appliedDeliveryZone = null;
                this.updateCartSummaryTotals();
                return false;
            }

            const clientLng = parseFloat(geoData[0].lon);
            const clientLat = parseFloat(geoData[0].lat);

            // Find matching zone using Ray-Casting Point-in-Polygon
            let matchedZone = null;

            for (const zone of zones) {
                let geom = zone.geojson;
                if (typeof geom === 'string') {
                    try { geom = JSON.parse(geom); } catch (e) {}
                }
                if (!geom) continue;

                const coords = geom.coordinates;
                if (!coords || !coords[0]) continue;

                // Handle Polygon or MultiPolygon
                let isInside = false;
                if (geom.type === 'Polygon') {
                    isInside = this.isPointInPolygon([clientLng, clientLat], coords[0]);
                } else if (geom.type === 'MultiPolygon') {
                    for (const poly of coords) {
                        if (this.isPointInPolygon([clientLng, clientLat], poly[0])) {
                            isInside = true;
                            break;
                        }
                    }
                }

                if (isInside) {
                    matchedZone = zone;
                    break; // Priority to lowest fee due to order by fee ascending
                }
            }

            if (matchedZone) {
                this.appliedDeliveryFee = parseFloat(matchedZone.fee || 0);
                this.appliedDeliveryZone = matchedZone;
                if (statusEl) {
                    statusEl.style.color = '#059669';
                    statusEl.textContent = `✓ Coverage confirmed: ${matchedZone.name} (Delivery fee: $${this.appliedDeliveryFee.toFixed(2)})`;
                }
                this.updateCartSummaryTotals();
                return true;
            } else {
                this.appliedDeliveryFee = 0;
                this.appliedDeliveryZone = null;
                if (statusEl) {
                    statusEl.style.color = '#dc2626';
                    statusEl.textContent = '✗ Out of delivery coverage area for this restaurant.';
                }
                this.updateCartSummaryTotals();
                return false;
            }

        } catch (e) {
            console.error('Delivery coverage check error:', e);
            if (statusEl) {
                statusEl.style.color = '#d97706';
                statusEl.textContent = 'Could not verify delivery zone automatically. Proceeding with standard delivery.';
            }
            return true;
        }
    }

    isPointInPolygon(point, ring) {
        const x = point[0], y = point[1];
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    updateItemQuantity(index, delta) {
        if (this.cart[index]) {
            this.cart[index].quantity += delta;
            if (this.cart[index].quantity < 1) {
                this.removeItem(index);
            } else {
                this.cart[index].total = this.cart[index].price * this.cart[index].quantity;
                this.updateCartUI();
                this.openCartPopup(); // Refresh popup
            }
        }
    }

    removeItem(index) {
        this.cart.splice(index, 1);
        this.updateCartUI();
        if (this.cart.length > 0) {
            this.openCartPopup(); // Refresh popup
        } else {
            this.popupRoot.getElementById('popup').style.display = 'none';
        }
    }

    async sendOrder() {
        const popupContent = this.popupRoot.getElementById('popup-content');
        const name = popupContent.querySelector('#cust-name').value;
        const phone = popupContent.querySelector('#cust-phone').value;
        const email = popupContent.querySelector('#cust-email')?.value || '';

        if (!name || !phone) {
            this.showModal('MISSING DATA', 'Please complete your name and phone.');
            return;
        }

        const orderType = popupContent.querySelector('.type-option.active').dataset.type;
        const address = popupContent.querySelector('#order-address')?.value || '';
        const reference = popupContent.querySelector('#order-reference')?.value || '';
        const timeMode = popupContent.querySelector('.time-option.active').dataset.time;
        const date = popupContent.querySelector('#order-date')?.value || '';
        const time = popupContent.querySelector('#order-time')?.value || '';
        const payment = popupContent.querySelector('.payment-option.active').dataset.pay;

        // If delivery order, validate delivery address and coverage
        if (orderType === 'delivery') {
            if (!address) {
                this.showModal('MISSING ADDRESS', 'Please enter your delivery address.');
                return;
            }

            const covered = await this.validateDeliveryAddressCoverage(address);
            if (!covered && this.appliedDeliveryZone === null) {
                const { data: hasZones } = await this.supabase
                    .from('menutech_delivery_zones')
                    .select('id')
                    .eq('user_id', this.menuData.user_id)
                    .eq('is_active', true)
                    .limit(1);

                if (hasZones && hasZones.length > 0) {
                    this.showModal('OUT OF COVERAGE', 'The provided delivery address is outside of this restaurant\'s delivery zones.');
                    return;
                }
            }
        }

        // Save to localStorage
        localStorage.setItem('mt_customer_info', JSON.stringify({ name, phone, email, address, reference }));

        const subtotal = this.cart.reduce((sum, item) => sum + (item.total || item.price), 0);
        const deliveryFee = orderType === 'delivery' ? (this.appliedDeliveryFee || 0) : 0;
        const total = subtotal + deliveryFee;

        const btn = popupContent.querySelector('#send-order-btn');
        btn.textContent = 'SENDING...';
        btn.disabled = true;

        if (!this.supabase) await this.initSupabase();

        try {
            const orderData = {
                user_id: this.menuData.user_id,
                items: this.cart,
                subtotal: subtotal,
                delivery_fee: deliveryFee,
                delivery_zone_name: orderType === 'delivery' ? (this.appliedDeliveryZone?.name || null) : null,
                total: total,
                customer_name: name,
                customer_phone: phone,
                customer_email: email,
                order_type: orderType,
                address: orderType === 'delivery' ? address : null,
                reference: orderType === 'delivery' ? reference : null,
                delivery_time_mode: timeMode,
                delivery_date: date,
                delivery_time: time,
                payment_method: payment,
                payment_status: payment === 'online' ? 'unpaid' : 'unpaid',
                status: 'pending'
            };

            const { data, error } = await this.supabase.from('menutech_orders').insert(orderData).select('id').single();

            if (error) {
                console.error('Supabase error inserting order:', error);
                throw error;
            }

            if (data && data.id) {
                localStorage.setItem('mt_last_order_id', data.id);
            }

            this.showSuccessAnimation(data ? data.id : null);
            this.cart = [];
            this.updateCartUI();
            this.popupRoot.getElementById('popup').style.display = 'none';
        } catch (e) {
            this.showModal('ERROR', 'Error sending order: ' + e.message);
            btn.textContent = `SEND ORDER • $${total.toFixed(2)}`;
            btn.disabled = false;
        }
    }

    async checkExistingOrder() {
        const lastId = localStorage.getItem('mt_last_order_id');
        if (!lastId) return;

        if (!this.supabase) await this.initSupabase();
        const { data } = await this.supabase.from('menutech_orders').select('status').eq('id', lastId).single();
        if (data && (data.status === 'delivered' || data.status === 'rejected')) {
            localStorage.removeItem('mt_last_order_id');
            this.renderFloatingTracker();
        }
    }

    showSuccessAnimation(orderId) {
        const anim = document.createElement('div');
        anim.className = 'sending-animation';
        anim.innerHTML = `
            <style>
                @keyframes scaleIn { from { transform: scale(0); } to { transform: scale(1); } }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            </style>
            <div class="check-mark" style="animation: scaleIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)">✓</div>
            <h1 style="font-family:'Outfit'; margin:0;">Order Received!</h1>
            <p style="color:#666; margin:10px 0 30px;">We are processing your order, please stay tuned for updates.</p>
            <div style="background:#fff7ed; color:#c2410c; padding:12px 24px; border-radius:20px; font-weight:700; font-size:0.9rem; display:flex; align-items:center; gap:10px;">
                <span style="width:8px; height:8px; background:#f97316; border-radius:50%; display:inline-block;"></span>
                SENDING ORDER...
            </div>
            <button id="track-btn" style="margin-top:50px; background:#ff9533; color:#fff; border:none; padding:15px 40px; border-radius:20px; font-weight:700; cursor:pointer; width: 100%; max-width: 300px;">TRACK MY ORDER</button>
            <button id="close-anim" style="margin-top:15px; background:transparent; color:#666; border:none; padding:10px; font-weight:600; cursor:pointer;">DONE</button>
        `;
        this.popupRoot.appendChild(anim);

        this.popupRoot.getElementById('track-btn').onclick = () => {
            anim.remove();
            if (orderId) this.showOrderTracking(orderId);
        };

        this.popupRoot.getElementById('close-anim').onclick = () => {
            anim.remove();
            this.renderFloatingTracker();
        };

        if (orderId) {
            setTimeout(() => {
                const statusLabel = anim.querySelector('div > span + span');
                if (statusLabel) statusLabel.textContent = 'WAITING FOR CONFIRMATION';
            }, 2000);
        }
    }

    async showOrderTracking(orderId) {
        if (!this.supabase) await this.initSupabase();

        // Open modal immediately with loading state
        const overlay = this.popupRoot.getElementById('popup');
        const popupContent = this.popupRoot.getElementById('popup-content');
        overlay.style.display = 'flex';
        overlay.classList.remove('side-popup');
        popupContent.style.maxWidth = '500px';
        popupContent.innerHTML = '<div style="padding: 100px; text-align: center; color: #ff9533; font-weight: 600;">Loading Tracking...</div>';

        // Subscribe to real-time updates
        if (this.trackingChannel) this.supabase.removeChannel(this.trackingChannel);

        this.trackingChannel = this.supabase.channel('tracking_' + orderId.substring(0, 8))
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'menutech_orders',
                filter: 'id=eq.' + orderId
            }, (payload) => {
                console.log('Order status updated:', payload.new.status);
                this.renderTrackingUI(payload.new);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('Subscribed to tracking for:', orderId);
                }
            });

        const { data: order } = await this.supabase.from('menutech_orders').select('*').eq('id', orderId).single();
        if (order) {
            this.renderTrackingUI(order);
        }
    }

    renderTrackingUI(order) {
        const popupContent = this.popupRoot.getElementById('popup-content');
        if (!popupContent) return;

        const status = order.status;
        const steps = [
            { id: 'pending', label: 'Received', active: true },
            { id: 'accepted', label: 'Accepted', active: ['accepted', 'preparing', 'finished', 'delivered'].includes(status) },
            { id: 'preparing', label: 'Preparing', active: ['preparing', 'finished', 'delivered'].includes(status) },
            { id: 'finished', label: 'Ready', active: ['finished', 'delivered'].includes(status) },
            { id: 'delivered', label: 'Delivered', active: status === 'delivered' }
        ];

        if (status === 'rejected') {
            steps[1] = { id: 'rejected', label: 'Rejected', active: true, error: true };
            steps.splice(2);
        }

        let currentMsg = "We're processing your order.";
        if (status === 'accepted') currentMsg = "Your order has been accepted!";
        if (status === 'preparing') currentMsg = "Chef is preparing your food!";
        if (status === 'finished') currentMsg = "Your order is ready!";
        if (status === 'delivered') currentMsg = "Order delivered. Enjoy!";
        if (status === 'rejected') currentMsg = "Order rejected: " + (order.rejection_reason || "Not specified");

        const isOnlinePayment = order.payment_method === 'online';
        const isPaid = order.payment_status === 'paid';
        const canPayOnline = isOnlinePayment && !isPaid && status !== 'rejected' && status !== 'delivered';

        popupContent.innerHTML = `
            <style>
                .tracking-container { padding: 40px 30px; font-family: 'Plus Jakarta Sans', sans-serif; text-align: center; }
                .tracking-title { font-family: 'Outfit'; font-size: 1.8rem; margin-bottom: 10px; }
                .tracking-msg { color: #666; margin-bottom: 40px; line-height: 1.5; }
                .steps-container { position: relative; display: flex; flex-direction: column; gap: 30px; text-align: left; max-width: 250px; margin: 0 auto; }
                .steps-container::before { content: ''; position: absolute; left: 14px; top: 0; bottom: 0; width: 2px; background: #eee; z-index: 0; }
                .step { display: flex; align-items: center; gap: 20px; position: relative; z-index: 1; }
                .step-dot { width: 30px; height: 30px; border-radius: 50%; background: #fff; border: 2px solid #eee; display: flex; align-items: center; justify-content: center; font-size: 14px; transition: 0.3s; }
                .step.active .step-dot { border-color: #ff9533; background: #ff9533; color: #fff; box-shadow: 0 0 15px rgba(255,149,51,0.4); }
                .step.active .step-label { color: #1a1c1e; font-weight: 800; }
                .step.error .step-dot { border-color: #ef4444; background: #ef4444; }
                .step-label { color: #94a3b8; font-weight: 600; font-size: 0.95rem; }
                .order-id { margin-top: 30px; font-size: 0.7rem; color: #cbd5e1; text-transform: uppercase; letter-spacing: 1px; }
                .btn-track-done { margin-top: 20px; width: 100%; padding: 16px; border-radius: 16px; border: none; background: #1a1c1e; color: #fff; font-weight: 700; cursor: pointer; }
                .btn-pay-now { margin-top: 20px; width: 100%; padding: 18px; border-radius: 16px; border: none; background: #ff9533; color: #fff; font-weight: 800; font-size: 1rem; cursor: pointer; text-transform: uppercase; box-shadow: 0 8px 25px rgba(255, 149, 51, 0.3); transition: 0.3s; }
                .btn-pay-now:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(255, 149, 51, 0.4); }
                .paid-badge { margin-top: 20px; background: rgba(5, 150, 105, 0.12); color: #059669; border: 1px solid rgba(5, 150, 105, 0.3); padding: 12px 20px; border-radius: 20px; font-weight: 800; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 8px; }
            </style>
            <div class="tracking-container">
                <button class="close-popup" style="right: 20px; top: 20px;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:18px;height:18px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <h2 class="tracking-title">Track Order</h2>
                <p class="tracking-msg">${currentMsg}</p>

                <div class="steps-container">
                    ${steps.map(step => `
                        <div class="step ${step.active ? 'active' : ''} ${step.error ? 'error' : ''}">
                            <div class="step-dot">${step.active ? '✓' : ''}</div>
                            <div class="step-label">${step.label}</div>
                        </div>
                    `).join('')}
                </div>

                ${isPaid ? `
                    <div><div class="paid-badge">✅ Payment Confirmed (Paid)</div></div>
                ` : canPayOnline ? `
                    <button class="btn-pay-now" id="btn-pay-online-now">PAY ONLINE NOW • $${(parseFloat(order.total || 0)).toFixed(2)}</button>
                ` : ''}

                <div class="order-id">Order ID: ${order.id.substring(0, 8)}</div>
                ${(status === 'delivered' || status === 'rejected') ? `
                    <button class="btn-track-done" id="track-finish-btn">ORDER AGAIN</button>
                ` : `
                    <button class="btn-track-done" id="track-close-btn">CLOSE</button>
                `}
            </div>
        `;

        const payNowBtn = popupContent.querySelector('#btn-pay-online-now');
        if (payNowBtn) {
            payNowBtn.onclick = async () => {
                payNowBtn.textContent = 'PREPARING PAYMENT...';
                payNowBtn.disabled = true;

                try {
                    const response = await this.supabase.functions.invoke('stripe-payment', {
                        body: {
                            action: 'create_order_checkout_session',
                            order_id: order.id,
                            origin_url: window.location.origin
                        }
                    });

                    if (response.data && response.data.url) {
                        window.location.href = response.data.url;
                    } else if (response.data && response.data.error) {
                        this.showModal('PAYMENT ERROR', response.data.error);
                        payNowBtn.textContent = `PAY ONLINE NOW • $${(parseFloat(order.total || 0)).toFixed(2)}`;
                        payNowBtn.disabled = false;
                    }
                } catch(e) {
                    this.showModal('ERROR', 'Failed to initiate payment session: ' + e.message);
                    payNowBtn.textContent = `PAY ONLINE NOW • $${(parseFloat(order.total || 0)).toFixed(2)}`;
                    payNowBtn.disabled = false;
                }
            };
        }

        popupContent.querySelector('.close-popup').onclick = () => {
            this.popupRoot.getElementById('popup').style.display = 'none';
            this.renderFloatingTracker();
        };

        const finishBtn = popupContent.querySelector('#track-finish-btn');
        if (finishBtn) {
            finishBtn.onclick = () => {
                localStorage.removeItem('mt_last_order_id');
                this.popupRoot.getElementById('popup').style.display = 'none';
                this.renderFloatingTracker();
                if (this.trackingChannel) this.supabase.removeChannel(this.trackingChannel);
            };
        }

        const closeBtn = popupContent.querySelector('#track-close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                this.popupRoot.getElementById('popup').style.display = 'none';
                this.renderFloatingTracker();
            };
        }

        if (status === 'delivered' || status === 'rejected') {
             // We don't remove mt_last_order_id immediately so they can see the result,
             // but maybe we should after they close.
        }
    }

}

if (!customElements.get('menutech-platform-orders')) {
    customElements.define('menutech-platform-orders', MenutechPlatformOrders);
}

/**
 * Menutech Footer Web Component
 * Usage: <menutech-footer domain="yoursite.com"></menutech-footer>
 */
class MenutechFooter extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.config = MT_UI_CONFIG;
        this.supabase = null;
    }

    static get observedAttributes() {
        return ['domain', 'address', 'phone', 'facebook', 'instagram', 'bgimage', 'legal', 'primarycolor'];
    }

    attributeChangedCallback() {
        this.render();
    }

    async connectedCallback() {
        await this.initSupabase();
        this.render();
    }

    async initSupabase() {
        if (this.supabase) return;
        try {
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js");
            this.supabase = createClient(this.config.url, this.config.key);
        } catch (err) {
            console.error("MenutechFooter Supabase Init Error:", err);
        }
    }

    async fetchFooterData(domain) {
        if (!this.supabase) await this.initSupabase();
        try {
            const { data, error } = await this.supabase
                .from('menutech_footers')
                .select('*')
                .eq('domain', domain)
                .single();
            if (error) return null;
            return data;
        } catch (err) {
            return null;
        }
    }

    async render() {
        if (this._rendering) return;
        this._rendering = true;

        let domain = this.getAttribute('domain') || window.location.hostname.replace(/^www\./, '');

        if (!this._dbConfig && domain && domain !== 'localhost' && !domain.includes('127.0.0.1')) {
            const fullData = await this.fetchFooterData(domain);
            if (fullData && fullData.config) {
                this._dbConfig = fullData.config;
            }
        }

        const footerConfig = this._dbConfig || {};

        const address = this.getAttribute('address') || footerConfig.address;
        const phone = this.getAttribute('phone') || footerConfig.phone;
        const fb = this.getAttribute('facebook') || footerConfig.fb;
        const ig = this.getAttribute('instagram') || footerConfig.ig;
        const bgImage = this.getAttribute('bgimage') || footerConfig.bgImage;
        const legal = this.getAttribute('legal') || footerConfig.legal;
        const primaryColor = this.getAttribute('primarycolor') || footerConfig.primaryColor || '#ff9533';

        const currentYear = new Date().getFullYear();
        const yearDisplay = currentYear > 2015 ? `2015 - ${currentYear}` : '2015';

        const parseLinks = (text) => {
            if (!text) return [];
            return text.split('\n').filter(line => line.includes(',')).map(line => {
                const parts = line.split(',');
                if (parts.length < 2) return null;
                const [label, url] = parts;
                return { label: label.trim(), url: url.trim() };
            }).filter(item => item !== null);
        };
        const legalLinks = parseLinks(legal);

        const styles = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');

                :host {
                    display: block;
                    width: 100%;
                    font-family: 'Outfit', sans-serif;
                    color: #ffffff;
                }

                .f-wrapper {
                    background: #0f1113;
                    position: relative;
                    padding: 60px 24px 40px;
                    overflow: hidden;
                    text-align: center;
                }

                .f-overlay {
                    position: absolute; inset: 0;
                    background: rgba(8, 9, 10, 0.97);
                    z-index: 1;
                }

                ${bgImage ? `
                .f-bg {
                    position: absolute; inset: 0;
                    background: url('${bgImage}') center/cover no-repeat;
                    opacity: 0.25;
                    filter: grayscale(100%);
                    pointer-events: none;
                    z-index: 0;
                }
                ` : ''}

                .f-container {
                    max-width: 1240px;
                    margin: 0 auto;
                    position: relative;
                    z-index: 2;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 30px;
                }

                .f-row {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-wrap: wrap;
                    gap: 20px;
                    width: 100%;
                }

                .f-phone {
                    font-size: 1.4rem;
                    font-weight: 700;
                    color: #ffffff;
                    margin: 0;
                }

                .f-address {
                    font-size: 1.1rem;
                    font-weight: 500;
                    color: rgba(255,255,255,0.8);
                    margin: 0;
                    max-width: 600px;
                }

                .f-socials {
                    display: flex;
                    gap: 15px;
                }

                .f-social-btn {
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.1);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #ffffff;
                    text-decoration: none;
                    transition: all 0.3s ease;
                }
                .f-social-btn:hover {
                    background: ${primaryColor};
                    border-color: ${primaryColor};
                    color: #fff;
                    transform: translateY(-3px);
                }
                .f-social-btn svg { width: 18px; height: 18px; fill: currentColor; }

                .f-legal {
                    display: flex;
                    gap: 25px;
                    justify-content: center;
                    flex-wrap: wrap;
                }
                .f-legal a {
                    color: rgba(255,255,255,0.5);
                    text-decoration: none;
                    font-size: 0.9rem;
                    font-weight: 600;
                    transition: 0.3s;
                }
                .f-legal a:hover { color: #ffffff; }

                .f-copyright {
                    font-size: 0.9rem;
                    font-weight: 500;
                    color: rgba(255,255,255,0.3);
                    margin-top: 10px;
                }
                .f-copyright a {
                    color: #ff9533 !important;
                    text-decoration: none;
                    font-weight: 800;
                }

                @media (max-width: 768px) {
                    .f-wrapper { padding: 50px 20px 30px; }
                    .f-phone { font-size: 1.2rem; }
                    .f-address { font-size: 1rem; }
                    .f-container { gap: 25px; }
                }
            </style>
        `;

        const socialHtml = `
            <div class="f-socials">
                ${fb ? `<a href="${fb}" class="f-social-btn" target="_blank"><svg viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg></a>` : ''}
                ${ig ? `<a href="${ig}" class="f-social-btn" target="_blank"><svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg></a>` : ''}
            </div>
        `;

        this.shadowRoot.innerHTML = `
            ${styles}
            <div class="f-wrapper">
                ${bgImage ? `<div class="f-bg"></div>` : ''}
                <div class="f-overlay"></div>
                <div class="f-container">
                    <div class="f-row">
                        ${phone ? `<p class="f-phone">${phone}</p>` : ''}
                        ${socialHtml}
                    </div>

                    ${address ? `<div class="f-row"><p class="f-address">${address}</p></div>` : ''}

                    ${legalLinks.length > 0 ? `
                        <div class="f-row">
                            <div class="f-legal">
                                ${legalLinks.map(link => `<a href="${link.url}">${link.label}</a>`).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <div class="f-row">
                        <div class="f-copyright">&copy; ${yearDisplay} Powered by <a href="https://menutech.xyz/" target="_blank">Menutech</a></div>
                    </div>
                </div>
            </div>
        `;

        this._rendering = false;
    }
}

if (!customElements.get('menutech-footer')) {
    customElements.define('menutech-footer', MenutechFooter);
}

/**
 * Menutech Reservations Web Component i18n
 */
const RES_I18N = {
    en: {
        trigger_default: "Book a Table",
        modal_title: "Table Reservation",
        res_unavailable_title: "Reservations Unavailable",
        res_unavailable_body: "Table reservations are currently not available for this restaurant.",
        step1_title: "Reserve a Table",
        guests_label: "Number of Guests",
        guests_unit: "Guests",
        date_label: "Date",
        time_label: "Time",
        time_placeholder: "Select reservation time...",
        comments_label: "Comments (Optional)",
        comments_placeholder: "Allergies, high chairs, special seating preferences...",
        hold_notice: "The table is held for {min} minutes after the reservation time. We appreciate arriving on time.",
        next_btn: "Next",
        select_time_title: "Select Time",
        select_time_msg: "Please select a valid reservation time slot.",
        step2_title: "Pre-order Food",
        preorder_question: "Would you like to pre-order food?",
        preorder_desc: "Have your favorite dishes ready at the table as soon as you arrive at the restaurant.",
        selected_preorder_header: "Selected Pre-order Items:",
        preorder_yes: "Yes, Order Food Now",
        preorder_no: "No, Order at Restaurant",
        step3_title: "Contact Information",
        name_label: "Full Name *",
        name_placeholder: "Your Full Name",
        phone_label: "Phone Number *",
        phone_placeholder: "Phone Number",
        email_label: "Email Address",
        email_placeholder: "Email Address",
        summary_title: "Reservation Summary",
        table_for_guests: "Table for {guests} Guests",
        at: "at",
        preorder_total: "Pre-order Total: ${total} ({items} items)",
        submit_btn: "Make Table Reservation Now",
        submitting: "Submitting...",
        missing_info_title: "Missing Information",
        missing_info_msg: "Please provide your full name and phone number.",
        res_error_title: "Reservation Error",
        res_error_msg: "Error creating table reservation: ",
        confirming_title: "Confirming Reservation",
        waiting_moment: "Waiting a moment...",
        waiting_desc: "We are confirming your reservation in real time with the restaurant.",
        id_label: "ID: ",
        cancelled_title: "Reservation Cancelled",
        not_confirmed_title: "Reservation Not Confirmed",
        not_accepted_msg: "Sorry {name}, your reservation could not be accepted at this time.",
        done_btn: "DONE",
        confirmed_title: "Reservation Confirmed",
        thanks_reserving: "Thank you for reserving!",
        accepted_success_msg: "Your reservation has been successfully accepted.",
        res_details_header: "Reservation Details",
        guests_count_label: "guests",
        date_item_label: "Date: ",
        time_item_label: "Time: ",
        tel_item_label: "Tel: ",
        email_item_label: "Email: ",
        note_item_label: "Note: ",
        preorder_food_header: "Pre-ordered Food",
        total_item_label: "Total: ",
        preorder_picker_desc: "Select dishes to pre-order for your table reservation:",
        confirm_preorder_btn: "Confirm Pre-order & Continue",
        add_btn: "+ Add",
        added_btn: "✓ Added",
        select_date_title: "Select Date",
        select_date_msg: "Please select a date first.",
        select_hour: "Select Hour",
        select_minutes: "Select Minutes ({step}m steps)",
        cancel_btn: "Cancel",
        set_btn: "Set",
        outside_hours_title: "Outside Operating Hours",
        outside_hours_msg: "Selected time is outside operating hours ({start} - {end}).",
        lead_time_title: "Notice Required",
        lead_time_msg: "Reservations require at least {min} minutes advance notice.",
        accept_modal_btn: "OK",
        notification_title: "Notification"
    },
    es: {
        trigger_default: "Reservar una Mesa",
        modal_title: "Reservación de Mesa",
        res_unavailable_title: "Reservaciones No Disponibles",
        res_unavailable_body: "Las reservaciones de mesa no están disponibles por el momento para este restaurante.",
        step1_title: "Reservar una Mesa",
        guests_label: "Número de Personas",
        guests_unit: "Personas",
        date_label: "Fecha",
        time_label: "Hora",
        time_placeholder: "Selecciona la hora de reservación...",
        comments_label: "Comentarios (Opcional)",
        comments_placeholder: "Alergias, sillas altas, preferencias de asiento...",
        hold_notice: "La mesa se guardará durante {min} minutos después de la hora de reserva. Agradecemos llegar a tiempo.",
        next_btn: "Siguiente",
        select_time_title: "Seleccionar Hora",
        select_time_msg: "Por favor selecciona un horario de reservación válido.",
        step2_title: "Pre-ordenar Comida",
        preorder_question: "¿Te gustaría ordenar tu comida por adelantado?",
        preorder_desc: "Ten tus platillos favoritos listos en la mesa tan pronto como llegues al restaurante.",
        selected_preorder_header: "Platillos Pre-ordenados Seleccionados:",
        preorder_yes: "Sí, Ordenar Comida Ahora",
        preorder_no: "No, Ordenar en el Restaurante",
        step3_title: "Información de Contacto",
        name_label: "Nombre Completo *",
        name_placeholder: "Tu Nombre Completo",
        phone_label: "Número de Teléfono *",
        phone_placeholder: "Número de Teléfono",
        email_label: "Correo Electrónico",
        email_placeholder: "Correo Electrónico",
        summary_title: "Resumen de la Reserva",
        table_for_guests: "Mesa para {guests} Personas",
        at: "a las",
        preorder_total: "Total Pre-orden: ${total} ({items} platillos)",
        submit_btn: "Hacer Reservación de Mesa Ahora",
        submitting: "Enviando...",
        missing_info_title: "Información Faltante",
        missing_info_msg: "Por favor proporciona tu nombre completo y número de teléfono.",
        res_error_title: "Error de Reservación",
        res_error_msg: "Error al crear la reservación de mesa: ",
        confirming_title: "Confirmando Reservación",
        waiting_moment: "Espera un momento...",
        waiting_desc: "Estamos confirmando tu reservación en tiempo real con el restaurante.",
        id_label: "ID: ",
        cancelled_title: "Reservación Cancelada",
        not_confirmed_title: "Reservación No Confirmada",
        not_accepted_msg: "Lo sentimos {name}, tu reservación no pudo ser aceptada en este momento.",
        done_btn: "HECHO",
        confirmed_title: "Reservación Confirmada",
        thanks_reserving: "¡Gracias por reservar!",
        accepted_success_msg: "Tu reservación ha sido aceptada con éxito.",
        res_details_header: "Detalles de la Reserva",
        guests_count_label: "invitados",
        date_item_label: "Fecha: ",
        time_item_label: "Hora: ",
        tel_item_label: "Tel: ",
        email_item_label: "Email: ",
        note_item_label: "Nota: ",
        preorder_food_header: "Pre-orden de Comida",
        total_item_label: "Total: ",
        preorder_picker_desc: "Selecciona platillos para pre-ordenar en tu reservación:",
        confirm_preorder_btn: "Confirmar Pre-orden y Continuar",
        add_btn: "+ Agregar",
        added_btn: "✓ Agregado",
        select_date_title: "Seleccionar Fecha",
        select_date_msg: "Por favor selecciona una fecha primero.",
        select_hour: "Seleccionar Hora",
        select_minutes: "Seleccionar Minutos (pasos de {step}m)",
        cancel_btn: "Cancelar",
        set_btn: "Aceptar",
        outside_hours_title: "Fuera de Horario",
        outside_hours_msg: "La hora seleccionada está fuera del horario de atención ({start} - {end}).",
        lead_time_title: "Anticipación Requerida",
        lead_time_msg: "Las reservaciones requieren al menos {min} minutos de anticipación.",
        accept_modal_btn: "Aceptar",
        notification_title: "Notificación"
    }
};

/**
 * Menutech Reservations Web Component
 * Usage: <menutech-reservations domain="yoursite.com"></menutech-reservations>
 */
class MenutechReservations extends HTMLElement {
    static get observedAttributes() {
        return ['domain', 'custom-label', 'view', 'lang', 'language'];
    }

    attributeChangedCallback() {
        this.render();
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.config = MT_UI_CONFIG;
        this.supabase = null;
        this.settings = null;
        this.restaurantInfo = null;
        this.menuData = null;
        this.preorderCart = [];
        this.step = 1; // 1: DateTime, 2: Preorder Choice, 3: Contact/Review, 4: Tracking/Success
        this.reservationId = null;
        this.reservationStatus = 'pending';
        this.resTrackingChannel = null;
        this.bookingData = {
            guests: 2,
            date: '',
            time: '',
            comments: '',
            name: '',
            phone: '',
            email: ''
        };
    }

    async connectedCallback() {
        await this.initSupabase();
        await this.loadData();
        this.render();
    }

    async initSupabase() {
        if (this.supabase) return;
        try {
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js");
            this.supabase = createClient(this.config.url, this.config.key);
        } catch (err) {
            console.error("MenutechReservations Supabase Init Error:", err);
        }
    }

    async loadData() {
        if (!this.supabase) await this.initSupabase();
        let domain = this.getAttribute('domain') || window.location.hostname.replace(/^www\./, '');

        try {
            // Find settings by domain or fallback profile
            let { data: resSettings } = await this.supabase
                .from('menutech_reservation_settings')
                .select('*')
                .eq('domain', domain)
                .maybeSingle();

            // Find profile user_id by domain or username
            let userId = resSettings ? resSettings.user_id : null;
            if (!userId) {
                const { data: prof } = await this.supabase
                    .from('profiles')
                    .select('id')
                    .or(`domain.eq.${domain},username.eq.${domain}`)
                    .maybeSingle();
                if (prof) userId = prof.id;
            }

            // Fallback: search in menutech_menus by slug or domain
            if (!userId) {
                const { data: menu } = await this.supabase
                    .from('menutech_menus')
                    .select('user_id')
                    .or(`slug.eq.${domain},domain.eq.${domain}`)
                    .maybeSingle();
                if (menu) userId = menu.user_id;
            }

            // If userId was found but resSettings wasn't, fetch settings by user_id
            if (userId && !resSettings) {
                const { data: resSetByUserId } = await this.supabase
                    .from('menutech_reservation_settings')
                    .select('*')
                    .eq('user_id', userId)
                    .maybeSingle();
                if (resSetByUserId) resSettings = resSetByUserId;
            }

            // Check if profile is suspended
            if (userId) {
                const { data: prof } = await this.supabase
                    .from('profiles')
                    .select('is_suspended')
                    .eq('id', userId)
                    .maybeSingle();
                if (prof && prof.is_suspended) {
                    this.isSuspended = true;
                }

                // Fetch restaurant schedule
                const { data: rest } = await this.supabase
                    .from('menutech_restaurants')
                    .select('*')
                    .eq('user_id', userId)
                    .maybeSingle();
                if (rest) {
                    this.restaurantInfo = rest;
                    if (rest.schedule && Array.isArray(rest.schedule)) schedule = rest.schedule;
                }

                // Fetch menu for preorder if needed
                const { data: menu } = await this.supabase
                    .from('menutech_menus')
                    .select('*')
                    .eq('user_id', userId)
                    .maybeSingle();
                if (menu) this.menuData = menu;
            }

            this.settings = {
                user_id: userId,
                enabled: this.isSuspended ? false : (resSettings ? (resSettings.enabled !== false) : true),
                min_guests: resSettings ? (resSettings.min_guests || 2) : 2,
                max_guests: resSettings ? (resSettings.max_guests || 8) : 8,
                min_lead_time_min: resSettings ? (resSettings.min_lead_time_min !== undefined ? resSettings.min_lead_time_min : 15) : 15,
                max_advance_days: resSettings ? (resSettings.max_advance_days || 8) : 8,
                hold_duration_min: resSettings ? (resSettings.hold_duration_min !== undefined ? resSettings.hold_duration_min : 15) : 15,
                allow_preorder: resSettings ? (resSettings.allow_preorder !== false) : true,
                custom_schedule: (resSettings && resSettings.custom_schedule && resSettings.custom_schedule.length > 0)
                    ? resSettings.custom_schedule
                    : schedule
            };

            this.bookingData.guests = this.settings.min_guests;
        } catch (e) {
            console.error("Error loading reservation configuration:", e);
        }
    }

    getLang() {
        const attrLang = this.getAttribute('lang') || this.getAttribute('language');
        if (attrLang) {
            const clean = attrLang.toLowerCase().trim();
            if (clean.startsWith('es')) return 'es';
            if (clean.startsWith('en')) return 'en';
        }
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const queryLang = urlParams.get('lang');
            if (queryLang) {
                const clean = queryLang.toLowerCase().trim();
                if (clean.startsWith('es')) return 'es';
                if (clean.startsWith('en')) return 'en';
            }
        } catch (e) {}
        if (this.restaurantInfo && this.restaurantInfo.language) {
            const clean = this.restaurantInfo.language.toLowerCase().trim();
            if (clean.startsWith('es')) return 'es';
            if (clean.startsWith('en')) return 'en';
        }
        return 'en';
    }

    t(key, params = {}) {
        const lang = this.getLang();
        const dict = RES_I18N[lang] || RES_I18N.en;
        let str = dict[key] || RES_I18N.en[key] || key;
        Object.keys(params).forEach(p => {
            str = str.replace(new RegExp(`\\{${p}\\}`, 'g'), params[p]);
        });
        return str;
    }

    render() {
        const customLabel = this.getAttribute('custom-label') || this.t('trigger_default');
        const viewMode = this.getAttribute('view');
        const isStandalone = viewMode === 'standalone';

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: ${isStandalone ? 'block' : 'inline-block'};
                    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
                    ${isStandalone ? 'width: 100%; max-width: 520px; margin: 30px auto; padding: 0 15px; box-sizing: border-box;' : ''}
                }
                .btn-reserve-trigger {
                    display: ${isStandalone ? 'none' : 'inline-flex'};
                    background: #ff9533;
                    color: #fff;
                    padding: 16px 32px;
                    border-radius: 40px;
                    font-weight: 800;
                    border: none;
                    cursor: pointer;
                    box-shadow: 0 10px 30px rgba(255,149,51,0.3);
                    text-transform: uppercase;
                    font-size: 0.95rem;
                    transition: 0.3s;
                    align-items: center;
                    gap: 10px;
                }
                .btn-reserve-trigger:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 15px 40px rgba(255,149,51,0.4);
                    filter: brightness(1.1);
                }
                .btn-reserve-trigger svg { width: 20px; height: 20px; }

                /* Modal Overlay & PC Centering */
                .res-modal-overlay {
                    position: ${isStandalone ? 'relative' : 'fixed'};
                    inset: ${isStandalone ? 'auto' : '0'};
                    background: ${isStandalone ? 'transparent' : 'rgba(0,0,0,0.75)'};
                    backdrop-filter: ${isStandalone ? 'none' : 'blur(8px)'};
                    z-index: ${isStandalone ? '1' : '200000'};
                    display: ${isStandalone ? 'flex' : 'none'};
                    align-items: center;
                    justify-content: center;
                    animation: fadeIn 0.3s ease;
                    padding: ${isStandalone ? '0' : '15px'};
                    box-sizing: border-box;
                    width: 100%;
                }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

                @media (min-width: 769px) {
                    ${isStandalone ? `
                    :host {
                        min-height: 100vh;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        margin: 0 auto !important;
                        box-sizing: border-box;
                    }
                    .res-modal-overlay {
                        min-height: 100vh;
                        align-items: center !important;
                        justify-content: center !important;
                        margin: auto !important;
                    }
                    ` : ''}
                }

                @media (max-width: 768px) {
                    ${isStandalone ? `
                    :host {
                        margin: 30px auto;
                        min-height: auto;
                        display: block;
                    }
                    .res-modal-overlay {
                        min-height: auto;
                        align-items: flex-start;
                    }
                    ` : ''}
                }

                .res-card {
                    background: #ffffff; width: 100%; max-width: 520px; border-radius: 28px;
                    box-shadow: ${isStandalone ? '0 20px 50px rgba(0,0,0,0.08)' : '0 25px 60px rgba(0,0,0,0.3)'};
                    border: ${isStandalone ? '1.5px solid #f8e8d8' : 'none'};
                    overflow: hidden; position: relative;
                    animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); color: #1a1c1e;
                    max-height: ${isStandalone ? 'none' : '90vh'}; display: flex; flex-direction: column;
                }
                @keyframes scaleUp { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }

                /* Clock Time Picker Modal */
                .mt-clock-modal-overlay {
                    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(6px);
                    z-index: 300000; display: flex; align-items: center; justify-content: center; padding: 16px;
                    opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
                }
                .mt-clock-modal-overlay.active { opacity: 1; pointer-events: auto; }
                .mt-clock-modal-card {
                    background: #ffffff; border: 1px solid #f8e8d8; border-radius: 28px; width: 100%; max-width: 340px;
                    overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.3); transform: scale(0.9); transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1); color: #1a1c1e;
                }
                .mt-clock-modal-overlay.active .mt-clock-modal-card { transform: scale(1); }
                .mt-clock-header { background: linear-gradient(135deg, #ff9533 0%, #e07a1e 100%); color: #ffffff; padding: 24px 20px; display: flex; align-items: center; justify-content: space-between; }
                .mt-clock-time-display { font-size: 3.2rem; font-weight: 800; font-family: 'Outfit', sans-serif; line-height: 1; display: flex; align-items: center; gap: 2px; letter-spacing: -1px; }
                .mt-clock-digit { cursor: pointer; padding: 2px 6px; border-radius: 12px; transition: background 0.2s, opacity 0.2s; opacity: 0.65; }
                .mt-clock-digit.active { opacity: 1; background: rgba(255, 255, 255, 0.22); }
                .mt-clock-colon { opacity: 0.8; font-weight: 600; }
                .mt-clock-ampm-group { display: flex; flex-direction: column; gap: 6px; }
                .mt-clock-ampm-btn { background: rgba(255, 255, 255, 0.15); border: none; color: #ffffff; font-size: 0.75rem; font-weight: 800; padding: 6px 12px; border-radius: 10px; cursor: pointer; transition: 0.2s; }
                .mt-clock-ampm-btn.active { background: #ffffff; color: #ff9533; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
                .mt-clock-body { padding: 20px 16px; display: flex; flex-direction: column; align-items: center; }
                .mt-clock-mode-indicator { font-size: 0.75rem; font-weight: 700; color: #ff9533; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
                .mt-clock-dial-container { width: 230px; height: 230px; border-radius: 50%; background: #fffef5; border: 1px solid #f8e8d8; position: relative; user-select: none; touch-action: none; cursor: pointer; }
                .mt-clock-center-dot { position: absolute; top: 50%; left: 50%; width: 10px; height: 10px; background: #ff9533; border-radius: 50%; transform: translate(-50%, -50%); z-index: 3; }
                .mt-clock-hand { position: absolute; bottom: 50%; left: calc(50% - 1px); width: 2px; height: 75px; background: #ff9533; transform-origin: bottom center; transform: rotate(0deg); z-index: 2; pointer-events: none; transition: transform 0.15s ease-out; }
                .mt-clock-hand.dragging { transition: none; }
                .mt-clock-hand-head { position: absolute; top: -18px; left: 50%; width: 36px; height: 36px; background: #ff9533; border-radius: 50%; transform: translateX(-50%); display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 800; font-size: 0.85rem; box-shadow: 0 4px 12px rgba(255, 149, 51, 0.4); }
                .mt-clock-numbers { position: absolute; inset: 0; pointer-events: none; }
                .mt-clock-num { position: absolute; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 700; color: #1a1c1e; transform: translate(-50%, -50%); pointer-events: none; transition: color 0.2s; }
                .mt-clock-num.selected { color: #ffffff; font-weight: 800; }
                .mt-clock-footer { padding: 16px 20px; display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid #f8e8d8; background: #ffffff; }
                .mt-clock-btn { padding: 10px 20px; border-radius: 14px; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: 0.2s; border: none; }
                .mt-clock-btn.cancel { background: transparent; color: #4a5568; }
                .mt-clock-btn.cancel:hover { background: #fffef5; color: #1a1c1e; }
                .mt-clock-btn.confirm { background: #ff9533; color: #ffffff; box-shadow: 0 6px 18px rgba(255, 149, 51, 0.3); }
                .mt-clock-btn.confirm:hover { transform: translateY(-2px); filter: brightness(1.05); }

                .res-card-header {
                    padding: 22px 28px; background: #fff; border-bottom: 1px solid #f0f0f0;
                    display: flex; justify-content: space-between; align-items: center;
                }
                .res-card-header h3 { margin: 0; font-family: 'Outfit', sans-serif; font-size: 1.3rem; font-weight: 800; text-transform: uppercase; color: #333; }
                .close-btn {
                    display: ${isStandalone ? 'none' : 'flex'};
                    background: #f5f5f5; border: none; width: 36px; height: 36px; border-radius: 50%;
                    align-items: center; justify-content: center; cursor: pointer; transition: 0.2s;
                }
                .close-btn:hover { background: #eee; transform: scale(1.05); }

                .res-card-body { padding: 28px; overflow-y: auto; flex: 1; }

                .field-group { margin-bottom: 20px; }
                .field-group label { display: block; font-size: 0.75rem; font-weight: 800; color: #ff9533; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }
                .field-control {
                    width: 100%; padding: 15px 18px; border-radius: 16px; border: 1.5px solid #eee;
                    background: #fcfcfc; font-family: inherit; font-size: 0.95rem; box-sizing: border-box; transition: 0.3s; color: #333;
                }
                .field-control:focus { outline: none; border-color: #ff9533; background: #fff; box-shadow: 0 0 0 4px rgba(255,149,51,0.1); }
                textarea.field-control { min-height: 90px; resize: vertical; }

                .info-notice { background: #fffcf5; border: 1px solid #f8e8d8; border-radius: 16px; padding: 16px; font-size: 0.82rem; color: #666; line-height: 1.4; margin-top: 15px; }

                .btn-action {
                    width: 100%; padding: 18px; border-radius: 18px; border: none; background: #ff9533;
                    color: #fff; font-weight: 800; font-size: 1rem; cursor: pointer; transition: 0.3s;
                    text-transform: uppercase; letter-spacing: 0.5px; margin-top: 15px; box-shadow: 0 10px 25px rgba(255,149,51,0.3);
                }
                .btn-action:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(255,149,51,0.4); }
                .btn-secondary { background: #f0f0f0; color: #555; box-shadow: none; margin-top: 10px; }
                .btn-secondary:hover { background: #e5e5e5; color: #111; box-shadow: none; }

                /* Preorder Popup Card */
                .preorder-item-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #eee; }
                .preorder-item-row:last-child { border-bottom: none; }

                .check-mark { width: 70px; height: 70px; background: #059669; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 36px; margin: 0 auto 20px auto; }

                .res-custom-modal-overlay {
                    position: fixed; inset: 0; background: rgba(0,0,0,0.65);
                    backdrop-filter: blur(6px); z-index: 350000;
                    display: none; align-items: center; justify-content: center;
                    animation: fadeIn 0.25s ease;
                    padding: 20px; box-sizing: border-box;
                }
                .res-custom-modal-card {
                    background: #ffffff; border-radius: 24px; padding: 28px 24px;
                    width: 100%; max-width: 380px; text-align: center;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.25);
                    animation: scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
                    box-sizing: border-box; color: #1a1c1e; border: 1px solid #f8e8d8;
                }
                .res-custom-modal-card h3 { margin: 0 0 10px; font-family: 'Outfit', 'Plus Jakarta Sans', sans-serif; font-size: 1.25rem; font-weight: 800; color: #1a1c1e; text-transform: uppercase; letter-spacing: 0.5px; }
                .res-custom-modal-card p { margin: 0 0 24px; color: #555555; line-height: 1.5; font-size: 0.95rem; font-weight: 500; }
                .res-custom-modal-btn {
                    background: #ff9533; color: #ffffff; border: none; padding: 14px 28px;
                    border-radius: 16px; font-weight: 800; font-size: 0.9rem; cursor: pointer; width: 100%;
                    transition: 0.25s; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 6px 18px rgba(255, 149, 51, 0.3);
                }
                .res-custom-modal-btn:hover { background: #f08a28; transform: translateY(-2px); box-shadow: 0 10px 22px rgba(255, 149, 51, 0.4); }
            </style>

            <button class="btn-reserve-trigger" id="open-res-modal">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/></svg>
                <span>${customLabel}</span>
            </button>

            <div class="res-modal-overlay" id="res-modal">
                <div class="res-card">
                    <div class="res-card-header">
                        <h3 id="res-modal-title">${this.t('modal_title')}</h3>
                        <button class="close-btn" id="close-res-modal">✕</button>
                    </div>
                    <div class="res-card-body" id="res-modal-body">
                        <!-- Step views rendered dynamically -->
                    </div>
                </div>
            </div>

            <div class="res-custom-modal-overlay" id="res-custom-modal">
                <div class="res-custom-modal-card">
                    <h3 id="res-modal-msg-title">${this.t('notification_title')}</h3>
                    <p id="res-modal-msg-body"></p>
                    <button class="res-custom-modal-btn" id="res-modal-msg-close">${this.t('accept_modal_btn')}</button>
                </div>
            </div>
        `;

        const customModal = this.shadowRoot.getElementById('res-custom-modal');
        const customModalClose = this.shadowRoot.getElementById('res-modal-msg-close');
        if (customModalClose) {
            customModalClose.onclick = () => {
                if (customModal) customModal.style.display = 'none';
            };
        }
        if (customModal) {
            customModal.onclick = (e) => {
                if (e.target === customModal) customModal.style.display = 'none';
            };
        }

        if (!isStandalone) {
            this.shadowRoot.getElementById('open-res-modal').onclick = () => {
                if (!this.settings) this.loadData();
                this.step = 1;
                this.shadowRoot.getElementById('res-modal').style.display = 'flex';
                this.renderStep();
            };

            this.shadowRoot.getElementById('close-res-modal').onclick = () => {
                this.shadowRoot.getElementById('res-modal').style.display = 'none';
            };

            this.shadowRoot.getElementById('res-modal').onclick = (e) => {
                if (e.target === this.shadowRoot.getElementById('res-modal')) {
                    this.shadowRoot.getElementById('res-modal').style.display = 'none';
                }
            };
        } else {
            this.renderStep();
        }
    }

    showModal(title, message) {
        const modal = this.shadowRoot.getElementById('res-custom-modal');
        if (!modal) return;
        const titleEl = this.shadowRoot.getElementById('res-modal-msg-title');
        const bodyEl = this.shadowRoot.getElementById('res-modal-msg-body');
        if (titleEl) titleEl.textContent = title || this.t('notification_title');
        if (bodyEl) bodyEl.textContent = message || '';
        modal.style.display = 'flex';
    }

    renderStep() {
        const body = this.shadowRoot.getElementById('res-modal-body');
        const title = this.shadowRoot.getElementById('res-modal-title');

        if (!this.settings || !this.settings.enabled) {
            title.textContent = this.t('res_unavailable_title');
            body.innerHTML = `<div style="text-align:center; padding:40px; color:#666;">${this.t('res_unavailable_body')}</div>`;
            return;
        }

        if (this.step === 1) {
            title.textContent = this.t('step1_title');

            // Guests options
            let guestsOptions = '';
            for (let g = this.settings.min_guests; g <= this.settings.max_guests; g++) {
                guestsOptions += `<option value="${g}" ${this.bookingData.guests == g ? 'selected' : ''}>${g} ${this.t('guests_unit')}</option>`;
            }

            // Min and max date
            const today = new Date();
            const minDateStr = today.toISOString().split('T')[0];
            const maxDate = new Date();
            maxDate.setDate(today.getDate() + this.settings.max_advance_days);
            const maxDateStr = maxDate.toISOString().split('T')[0];

            if (!this.bookingData.date) this.bookingData.date = minDateStr;

            body.innerHTML = `
                <div class="field-group">
                    <label>${this.t('guests_label')}</label>
                    <select class="field-control" id="field-guests">
                        ${guestsOptions}
                    </select>
                </div>

                <div class="field-group">
                    <label>${this.t('date_label')}</label>
                    <input type="date" class="field-control" id="field-date" min="${minDateStr}" max="${maxDateStr}" value="${this.bookingData.date}">
                </div>

                <div class="field-group">
                    <label>${this.t('time_label')}</label>
                    <input type="text" class="field-control" id="field-time" readonly placeholder="${this.t('time_placeholder')}" value="${this.bookingData.time ? this.formatTime12h(this.bookingData.time) : ''}" style="cursor: pointer; background: #fffef5;">
                </div>

                <div class="field-group">
                    <label>${this.t('comments_label')}</label>
                    <textarea class="field-control" id="field-comments" placeholder="${this.t('comments_placeholder')}">${this.bookingData.comments}</textarea>
                </div>

                <div class="info-notice">
                    ${this.t('hold_notice', { min: this.settings.hold_duration_min })}
                </div>

                <button class="btn-action" id="btn-step1-next">${this.t('next_btn')}</button>
            `;

            const dateInput = body.querySelector('#field-date');
            const timeInput = body.querySelector('#field-time');

            timeInput.onclick = () => {
                this.openClockPicker(dateInput.value, timeInput);
            };

            dateInput.onchange = () => {
                timeInput.value = '';
                this.bookingData.time = '';
            };

            body.querySelector('#btn-step1-next').onclick = () => {
                if (!this.bookingData.time) {
                    this.showModal(this.t('select_time_title'), this.t('select_time_msg'));
                    return;
                }

                this.bookingData.guests = parseInt(body.querySelector('#field-guests').value);
                this.bookingData.date = dateInput.value;
                this.bookingData.comments = body.querySelector('#field-comments').value;

                if (this.settings.allow_preorder && this.menuData) {
                    this.step = 2;
                } else {
                    this.step = 3;
                }
                this.renderStep();
            };

        } else if (this.step === 2) {
            title.textContent = this.t('step2_title');
            body.innerHTML = `
                <div style="text-align:center; padding: 10px 0 20px 0;">
                    <div style="display: flex; justify-content: center; align-items: center; margin-bottom: 15px;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 56px; height: 56px; color: #1a1c1e;">
                            <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
                            <path d="M7 2v20"/>
                            <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>
                        </svg>
                    </div>
                    <h4 style="font-size:1.15rem; font-weight:800; margin-bottom:12px; color:#333;">${this.t('preorder_question')}</h4>
                    <p style="font-size:0.9rem; color:#666; line-height:1.5;">${this.t('preorder_desc')}</p>
                </div>

                ${this.preorderCart.length > 0 ? `
                    <div style="background:#f9f9f9; border-radius:16px; padding:15px; margin-bottom:20px;">
                        <div style="font-size:0.75rem; font-weight:800; color:#ff9533; text-transform:uppercase; margin-bottom:10px;">${this.t('selected_preorder_header')}</div>
                        ${this.preorderCart.map(i => `
                            <div class="preorder-item-row">
                                <span style="font-weight:600; font-size:0.9rem;">${i.quantity}x ${i.name}</span>
                                <span style="font-weight:700; color:#ff9533;">$${(i.price * i.quantity).toFixed(2)}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <button class="btn-action" id="btn-preorder-yes">${this.t('preorder_yes')}</button>
                <button class="btn-action btn-secondary" id="btn-preorder-no">${this.t('preorder_no')}</button>
            `;

            body.querySelector('#btn-preorder-yes').onclick = () => {
                this.showMenuPickerModal();
            };

            body.querySelector('#btn-preorder-no').onclick = () => {
                this.step = 3;
                this.renderStep();
            };

        } else if (this.step === 3) {
            title.textContent = this.t('step3_title');

            // Saved contact info from localStorage
            const savedInfo = JSON.parse(localStorage.getItem('mt_customer_info') || '{}');
            const name = this.bookingData.name || savedInfo.name || '';
            const phone = this.bookingData.phone || savedInfo.phone || '';
            const email = this.bookingData.email || savedInfo.email || '';

            const preorderTotal = this.preorderCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

            body.innerHTML = `
                <div class="field-group">
                    <label>${this.t('name_label')}</label>
                    <input type="text" class="field-control" id="field-name" value="${name}" placeholder="${this.t('name_placeholder')}">
                </div>

                <div class="field-group">
                    <label>${this.t('phone_label')}</label>
                    <input type="tel" class="field-control" id="field-phone" value="${phone}" placeholder="${this.t('phone_placeholder')}">
                </div>

                <div class="field-group">
                    <label>${this.t('email_label')}</label>
                    <input type="email" class="field-control" id="field-email" value="${email}" placeholder="${this.t('email_placeholder')}">
                </div>

                <div style="background:#fdfdfd; border:1px solid #eee; border-radius:18px; padding:18px; margin-top:15px;">
                    <div style="font-size:0.75rem; font-weight:800; color:#ff9533; text-transform:uppercase; margin-bottom:10px;">${this.t('summary_title')}</div>
                    <p style="font-size:0.85rem; font-weight:600; margin:4px 0;">${this.t('table_for_guests', { guests: this.bookingData.guests })}</p>
                    <p style="font-size:0.85rem; color:#666; margin:4px 0;">${this.bookingData.date} ${this.t('at')} ${this.formatTime12h(this.bookingData.time)}</p>
                    ${this.preorderCart.length > 0 ? `<p style="font-size:0.85rem; color:#ff9533; font-weight:700; margin-top:8px;">${this.t('preorder_total', { total: preorderTotal.toFixed(2), items: this.preorderCart.length })}</p>` : ''}
                </div>

                <div class="info-notice">
                    ${this.t('hold_notice', { min: this.settings.hold_duration_min })}
                </div>

                <button class="btn-action" id="btn-submit-res">${this.t('submit_btn')}</button>
            `;

            body.querySelector('#btn-submit-res').onclick = () => this.submitBooking(body);

        } else if (this.step === 4) {
            const isPending = this.reservationStatus === 'pending';
            const isRejected = ['rejected', 'cancelled'].includes(this.reservationStatus);

            if (isPending) {
                title.textContent = this.t('confirming_title');
                body.innerHTML = `
                    <div style="text-align:center; padding:30px 10px;">
                        <div style="width: 60px; height: 60px; border: 4px solid #fff2e5; border-top-color: #ff9533; border-radius: 50%; margin: 0 auto 20px auto; animation: spinRes 1s infinite linear;"></div>
                        <style>@keyframes spinRes { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                        <h3 style="font-family:'Outfit'; font-size:1.4rem; margin-bottom:12px; color:#1a1c1e;">${this.t('waiting_moment')}</h3>
                        <p style="color:#666; font-size:0.95rem; line-height:1.5; margin-bottom:20px;">${this.t('waiting_desc')}</p>
                        <div style="font-size:0.75rem; color:#aaa; font-weight:700; text-transform:uppercase; letter-spacing:1px;">${this.t('id_label')}${this.reservationId ? this.reservationId.substring(0, 8) : ''}</div>
                    </div>
                `;
            } else if (isRejected) {
                title.textContent = this.t('cancelled_title');
                body.innerHTML = `
                    <div style="text-align:center; padding:20px 0;">
                        <div style="width:70px; height:70px; background:#ef4444; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:36px; margin:0 auto 20px auto;">✕</div>
                        <h3 style="font-family:'Outfit'; font-size:1.4rem; margin-bottom:10px; color:#1a1c1e;">${this.t('not_confirmed_title')}</h3>
                        <p style="color:#666; font-size:0.95rem; line-height:1.5; margin-bottom:20px;">${this.t('not_accepted_msg', { name: this.bookingData.name })}</p>
                        <button class="btn-action" id="btn-res-done">${this.t('done_btn')}</button>
                    </div>
                `;
                body.querySelector('#btn-res-done').onclick = () => this.handleDoneRedirect();
            } else {
                title.textContent = this.t('confirmed_title');
                const preorderTotal = this.preorderCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                const isPaid = this.reservationPaymentStatus === 'paid';
                const canPayOnline = preorderTotal > 0 && !isPaid && this.reservationId;

                body.innerHTML = `
                    <div style="text-align:center; padding:10px 0;">
                        <div class="check-mark">✓</div>
                        <h3 style="font-family:'Outfit'; font-size:1.5rem; margin-bottom:8px; color:#1a1c1e;">${this.t('thanks_reserving')}</h3>
                        <p style="color:#666; font-size:0.92rem; line-height:1.5; margin-bottom:20px;">${this.t('accepted_success_msg')}</p>

                        <div style="background:#fdfdfd; border:1px solid #f8e8d8; border-radius:18px; padding:20px; text-align:left; margin-bottom:20px;">
                            <div style="font-size:0.75rem; font-weight:800; color:#ff9533; text-transform:uppercase; margin-bottom:12px; letter-spacing:0.5px;">${this.t('res_details_header')}</div>
                            <div style="font-size:0.9rem; font-weight:700; color:#1a1c1e; margin-bottom:6px;">👤 ${this.bookingData.name}</div>
                            <div style="font-size:0.85rem; color:#555; margin-bottom:4px;">👥 ${this.t('guests_label')}: <strong>${this.bookingData.guests} ${this.t('guests_count_label')}</strong></div>
                            <div style="font-size:0.85rem; color:#555; margin-bottom:4px;">📅 ${this.t('date_item_label')}<strong>${this.bookingData.date}</strong></div>
                            <div style="font-size:0.85rem; color:#555; margin-bottom:4px;">⏰ ${this.t('time_item_label')}<strong>${this.formatTime12h(this.bookingData.time)}</strong></div>
                            ${this.bookingData.phone ? `<div style="font-size:0.85rem; color:#555; margin-bottom:4px;">📞 ${this.t('tel_item_label')}${this.bookingData.phone}</div>` : ''}
                            ${this.bookingData.email ? `<div style="font-size:0.85rem; color:#555; margin-bottom:4px;">✉️ ${this.t('email_item_label')}${this.bookingData.email}</div>` : ''}
                            ${this.bookingData.comments ? `<div style="font-size:0.85rem; color:#777; margin-top:8px; font-style:italic;">💬 ${this.t('note_item_label')}${this.bookingData.comments}</div>` : ''}

                            ${this.preorderCart.length > 0 ? `
                                <div style="border-top: 1px dashed #eee; margin-top: 12px; padding-top: 10px;">
                                    <div style="font-size:0.75rem; font-weight:800; color:#ff9533; text-transform:uppercase; margin-bottom:6px;">${this.t('preorder_food_header')}</div>
                                    ${this.preorderCart.map(i => `<div style="font-size:0.82rem; color:#444; display:flex; justify-content:space-between;"><span>${i.quantity}x ${i.name}</span><span>$${(i.price * i.quantity).toFixed(2)}</span></div>`).join('')}
                                    <div style="font-size:0.85rem; font-weight:800; color:#ff9533; margin-top:6px; text-align:right;">${this.t('total_item_label')}$${preorderTotal.toFixed(2)}</div>
                                </div>
                            ` : ''}
                        </div>

                        ${isPaid ? `
                            <div style="margin-bottom:20px; background:rgba(5, 150, 105, 0.12); color:#059669; border:1px solid rgba(5, 150, 105, 0.3); padding:12px 20px; border-radius:20px; font-weight:800; font-size:0.85rem; text-transform:uppercase; display:inline-block;">✅ PRE-ORDER PAID</div>
                        ` : canPayOnline ? `
                            <button class="btn-action" id="btn-pay-res-now" style="margin-bottom:15px;">PAY PRE-ORDER NOW • $${preorderTotal.toFixed(2)}</button>
                        ` : ''}

                        <button class="btn-action btn-secondary" id="btn-res-done">${this.t('done_btn')}</button>
                    </div>
                `;

                const payResBtn = body.querySelector('#btn-pay-res-now');
                if (payResBtn) {
                    payResBtn.onclick = async () => {
                        payResBtn.textContent = 'PREPARING PAYMENT...';
                        payResBtn.disabled = true;

                        try {
                            const response = await this.supabase.functions.invoke('stripe-payment', {
                                body: {
                                    action: 'create_reservation_checkout_session',
                                    reservation_id: this.reservationId,
                                    origin_url: window.location.origin
                                }
                            });

                            if (response.data && response.data.url) {
                                window.location.href = response.data.url;
                            } else if (response.data && response.data.error) {
                                this.showModal(this.t('res_error_title'), response.data.error);
                                payResBtn.textContent = `PAY PRE-ORDER NOW • $${preorderTotal.toFixed(2)}`;
                                payResBtn.disabled = false;
                            }
                        } catch(e) {
                            this.showModal(this.t('res_error_title'), 'Error: ' + e.message);
                            payResBtn.textContent = `PAY PRE-ORDER NOW • $${preorderTotal.toFixed(2)}`;
                            payResBtn.disabled = false;
                        }
                    };
                }

                body.querySelector('#btn-res-done').onclick = () => this.handleDoneRedirect();
            }
        }
    }

    handleDoneRedirect() {
        const domain = this.getAttribute('domain') || window.location.hostname.replace(/^www\./, '');
        if (domain && !domain.includes('menutech.io') && !domain.includes('localhost')) {
            window.location.href = `https://${domain}`;
        } else {
            window.location.href = `https://${domain}`;
        }
    }

    showMenuPickerModal() {
        const body = this.shadowRoot.getElementById('res-modal-body');
        const categories = (this.menuData.config && this.menuData.config.categories) ? this.menuData.config.categories : [];

        let dishesHtml = '';
        categories.forEach(cat => {
            dishesHtml += `<div style="font-size:0.8rem; font-weight:800; color:#ff9533; text-transform:uppercase; margin:15px 0 8px 0;">${cat.name}</div>`;
            (cat.dishes || []).forEach((dish, idx) => {
                dishesHtml += `
                    <div class="preorder-item-row">
                        <div>
                            <div style="font-weight:700; font-size:0.9rem;">${dish.name}</div>
                            <div style="font-weight:700; color:#ff9533; font-size:0.85rem;">$${dish.price}</div>
                        </div>
                        <button class="btn-action" style="width:auto; padding:8px 16px; font-size:0.75rem; margin:0;" data-dish='${JSON.stringify(dish).replace(/'/g, "&apos;")}'>${this.t('add_btn')}</button>
                    </div>
                `;
            });
        });

        body.innerHTML = `
            <div style="font-size:0.85rem; color:#666; margin-bottom:15px;">${this.t('preorder_picker_desc')}</div>
            <div style="max-height:300px; overflow-y:auto; padding-right:5px;">
                ${dishesHtml}
            </div>
            <button class="btn-action" id="btn-finish-preorder" style="margin-top:20px;">${this.t('confirm_preorder_btn')}</button>
        `;

        body.querySelectorAll('button[data-dish]').forEach(btn => {
            btn.onclick = () => {
                const dish = JSON.parse(btn.getAttribute('data-dish'));
                const existing = this.preorderCart.find(i => i.name === dish.name);
                if (existing) {
                    existing.quantity++;
                } else {
                    this.preorderCart.push({
                        name: dish.name,
                        price: parseFloat(dish.price),
                        quantity: 1
                    });
                }
                btn.textContent = this.t('added_btn');
                setTimeout(() => btn.textContent = this.t('add_btn'), 1000);
            };
        });

        body.querySelector('#btn-finish-preorder').onclick = () => {
            this.step = 3;
            this.renderStep();
        };
    }

    parseTimeStringToMinutes(timeStr) {
        if (!timeStr) return null;
        const s = timeStr.trim().toUpperCase();
        const isPM = s.includes('PM');
        const isAM = s.includes('AM');
        const clean = s.replace(/AM|PM/g, '').trim();
        const parts = clean.split(':');
        let hours = parseInt(parts[0], 10);
        if (isNaN(hours)) return null;
        let mins = parts[1] ? (parseInt(parts[1], 10) || 0) : 0;
        if (isPM && hours < 12) hours += 12;
        if (isAM && hours === 12) hours = 0;
        return hours * 60 + mins;
    }

    formatMinutes12h(totalMins) {
        if (totalMins === null || totalMins === undefined || isNaN(totalMins)) return '';
        const h24 = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        const ampm = h24 >= 12 ? 'PM' : 'AM';
        const h12 = h24 % 12 || 12;
        return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
    }

    formatTime12h(time24) {
        if (!time24) return '';
        const [hStr, mStr] = time24.split(':');
        let h = parseInt(hStr);
        const m = parseInt(mStr);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
    }

    openClockPicker(selectedDateStr, timeInputEl) {
        if (!selectedDateStr) {
            this.showModal(this.t('select_date_title'), this.t('select_date_msg'));
            return;
        }

        const interval = this.settings.min_lead_time_min > 0 ? this.settings.min_lead_time_min : 15;

        // Calculate store opening and closing bounds for selected date
        const dateObj = new Date(selectedDateStr + 'T00:00:00');
        const dayIndex = dateObj.getDay();
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        const sched = this.settings.custom_schedule || [];
        let dayHoursStr = '';
        sched.forEach(s => {
            const dayLower = (s.day || '').toLowerCase();
            if (dayLower.includes(dayNames[dayIndex].toLowerCase()) || dayLower.includes('daily') || dayLower.includes('mon-sun') || (dayLower.includes('mon-fri') && dayIndex >= 1 && dayIndex <= 5)) {
                dayHoursStr = s.hours;
            }
        });

        let startMinutes = 10 * 60; // Default 10:00 AM
        let endMinutes = 22 * 60;   // Default 10:00 PM
        if (dayHoursStr && dayHoursStr.includes('-')) {
            const parts = dayHoursStr.split('-');
            const sM = this.parseTimeStringToMinutes(parts[0]);
            const eM = this.parseTimeStringToMinutes(parts[1]);
            if (sM !== null) startMinutes = sM;
            if (eM !== null) endMinutes = eM;
        }

        let clockState = {
            hour: 9,
            minute: 0,
            ampm: 'AM',
            mode: 'hour'
        };

        if (this.bookingData.time) {
            const [h24, m24] = this.bookingData.time.split(':').map(Number);
            clockState.hour = h24 % 12 || 12;
            clockState.minute = Math.round(m24 / interval) * interval % 60;
            clockState.ampm = h24 >= 12 ? 'PM' : 'AM';
        } else {
            clockState.hour = 12;
            clockState.ampm = 'PM';
            clockState.minute = 0;
        }

        let modalOverlay = this.shadowRoot.querySelector('#mt-clock-modal-overlay');
        if (!modalOverlay) {
            const modalHtml = `
                <div id="mt-clock-modal-overlay" class="mt-clock-modal-overlay">
                    <div class="mt-clock-modal-card">
                        <div class="mt-clock-header">
                            <div class="mt-clock-time-display">
                                <span id="mt-clock-hour-display" class="mt-clock-digit active">09</span>
                                <span class="mt-clock-colon">:</span>
                                <span id="mt-clock-minute-display" class="mt-clock-digit">00</span>
                            </div>
                            <div class="mt-clock-ampm-group">
                                <button type="button" id="mt-clock-am-btn" class="mt-clock-ampm-btn active">A. M.</button>
                                <button type="button" id="mt-clock-pm-btn" class="mt-clock-ampm-btn">P. M.</button>
                            </div>
                        </div>
                        <div class="mt-clock-body">
                            <div id="mt-clock-mode-indicator" class="mt-clock-mode-indicator">Select Hour</div>
                            <div id="mt-clock-dial" class="mt-clock-dial-container">
                                <div class="mt-clock-center-dot"></div>
                                <div id="mt-clock-hand" class="mt-clock-hand">
                                    <div id="mt-clock-hand-head" class="mt-clock-hand-head">9</div>
                                </div>
                                <div id="mt-clock-numbers" class="mt-clock-numbers"></div>
                            </div>
                        </div>
                        <div class="mt-clock-footer">
                            <button type="button" id="mt-clock-cancel-btn" class="mt-clock-btn cancel">${this.t('cancel_btn')}</button>
                            <button type="button" id="mt-clock-confirm-btn" class="mt-clock-btn confirm">${this.t('set_btn')}</button>
                        </div>
                    </div>
                </div>
            `;
            this.shadowRoot.querySelector('.res-card').insertAdjacentHTML('beforeend', modalHtml);
            modalOverlay = this.shadowRoot.querySelector('#mt-clock-modal-overlay');
        }

        const hourDisplay = modalOverlay.querySelector('#mt-clock-hour-display');
        const minDisplay = modalOverlay.querySelector('#mt-clock-minute-display');
        const amBtn = modalOverlay.querySelector('#mt-clock-am-btn');
        const pmBtn = modalOverlay.querySelector('#mt-clock-pm-btn');
        const cancelBtn = modalOverlay.querySelector('#mt-clock-cancel-btn');
        const confirmBtn = modalOverlay.querySelector('#mt-clock-confirm-btn');
        const dial = modalOverlay.querySelector('#mt-clock-dial');

        const setClockMode = (mode) => {
            clockState.mode = mode;
            modalOverlay.querySelector('#mt-clock-mode-indicator').textContent = mode === 'hour' ? 'Select Hour' : `Select Minutes (${interval}m steps)`;
            hourDisplay.classList.toggle('active', mode === 'hour');
            minDisplay.classList.toggle('active', mode === 'minute');
            renderClockNumbers();
            updateClockUI();
        };

        const renderClockNumbers = () => {
            const container = modalOverlay.querySelector('#mt-clock-numbers');
            container.innerHTML = '';
            const isHour = clockState.mode === 'hour';
            const radius = 90;

            if (isHour) {
                for (let i = 1; i <= 12; i++) {
                    const angle = (i * 30 - 90) * (Math.PI / 180);
                    const x = 115 + radius * Math.cos(angle);
                    const y = 115 + radius * Math.sin(angle);

                    const numEl = document.createElement('div');
                    numEl.className = 'mt-clock-num';
                    numEl.style.left = `${x}px`;
                    numEl.style.top = `${y}px`;
                    numEl.dataset.val = i;
                    numEl.textContent = i;
                    container.appendChild(numEl);
                }
            } else {
                const count = Math.floor(60 / interval);
                for (let i = 0; i < count; i++) {
                    const mVal = i * interval;
                    const angle = (mVal * 6 - 90) * (Math.PI / 180);
                    const x = 115 + radius * Math.cos(angle);
                    const y = 115 + radius * Math.sin(angle);

                    const numEl = document.createElement('div');
                    numEl.className = 'mt-clock-num';
                    numEl.style.left = `${x}px`;
                    numEl.style.top = `${y}px`;
                    numEl.dataset.val = mVal;
                    numEl.textContent = mVal.toString().padStart(2, '0');
                    container.appendChild(numEl);
                }
            }
        };

        const updateClockUI = () => {
            hourDisplay.textContent = clockState.hour.toString().padStart(2, '0');
            minDisplay.textContent = clockState.minute.toString().padStart(2, '0');

            const isHour = clockState.mode === 'hour';
            const hand = modalOverlay.querySelector('#mt-clock-hand');
            const head = modalOverlay.querySelector('#mt-clock-hand-head');

            let deg = 0;
            if (isHour) {
                deg = (clockState.hour % 12) * 30;
                head.textContent = clockState.hour;
            } else {
                deg = clockState.minute * 6;
                head.textContent = clockState.minute.toString().padStart(2, '0');
            }

            hand.style.transform = `rotate(${deg}deg)`;

            const nums = modalOverlay.querySelectorAll('.mt-clock-num');
            nums.forEach(num => {
                const targetVal = isHour ? clockState.hour : clockState.minute;
                num.classList.toggle('selected', parseInt(num.dataset.val) === targetVal);
            });
        };

        hourDisplay.onclick = () => setClockMode('hour');
        minDisplay.onclick = () => setClockMode('minute');

        amBtn.onclick = () => {
            clockState.ampm = 'AM';
            amBtn.classList.add('active');
            pmBtn.classList.remove('active');
        };
        pmBtn.onclick = () => {
            clockState.ampm = 'PM';
            pmBtn.classList.add('active');
            amBtn.classList.remove('active');
        };

        amBtn.classList.toggle('active', clockState.ampm === 'AM');
        pmBtn.classList.toggle('active', clockState.ampm === 'PM');

        const closeClock = () => {
            modalOverlay.classList.remove('active');
        };

        cancelBtn.onclick = closeClock;

        confirmBtn.onclick = () => {
            let h24 = clockState.hour;
            if (clockState.ampm === 'PM' && h24 < 12) h24 += 12;
            if (clockState.ampm === 'AM' && h24 === 12) h24 = 0;

            const slotTime24 = `${String(h24).padStart(2, '0')}:${String(clockState.minute).padStart(2, '0')}`;
            const selectedMinutes = h24 * 60 + clockState.minute;

            // Check store opening hours
            let isOpen = false;
            if (startMinutes <= endMinutes) {
                isOpen = selectedMinutes >= startMinutes && selectedMinutes < endMinutes;
            } else {
                // Overnight schedule
                isOpen = selectedMinutes >= startMinutes || selectedMinutes < endMinutes;
            }

            if (!isOpen) {
                const startStr = this.formatMinutes12h(startMinutes);
                const endStr = this.formatMinutes12h(endMinutes);
                this.showModal(this.t('outside_hours_title'), this.t('outside_hours_msg', { start: startStr, end: endStr }));
                return;
            }

            // Check lead time if today
            const now = new Date();
            const isToday = selectedDateStr === now.toISOString().split('T')[0];
            const leadTimeMs = (this.settings.min_lead_time_min || 15) * 60 * 1000;
            const selectedTs = new Date(`${selectedDateStr}T${slotTime24}:00`).getTime();

            if (isToday && selectedTs < (now.getTime() + leadTimeMs)) {
                this.showModal(this.t('lead_time_title'), this.t('lead_time_msg', { min: this.settings.min_lead_time_min }));
                return;
            }

            this.bookingData.time = slotTime24;
            timeInputEl.value = this.formatTime12h(slotTime24);
            closeClock();
        };

        // Pointer / drag logic
        let isDragging = false;
        const handlePointer = (e) => {
            const rect = dial.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const dx = clientX - centerX;
            const dy = clientY - centerY;

            let deg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
            if (deg < 0) deg += 360;

            if (clockState.mode === 'hour') {
                let hour = Math.round(deg / 30);
                if (hour === 0) hour = 12;
                clockState.hour = hour;
            } else {
                let minuteRaw = Math.round(deg / 6);
                if (minuteRaw === 60) minuteRaw = 0;
                let minuteSnapped = Math.round(minuteRaw / interval) * interval;
                if (minuteSnapped >= 60) minuteSnapped = 0;
                clockState.minute = minuteSnapped;
            }
            updateClockUI();
        };

        dial.onmousedown = (e) => {
            isDragging = true;
            modalOverlay.querySelector('#mt-clock-hand').classList.add('dragging');
            handlePointer(e);
        };

        const onMouseMove = (e) => {
            if (isDragging) handlePointer(e);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                modalOverlay.querySelector('#mt-clock-hand').classList.remove('dragging');
                if (clockState.mode === 'hour') {
                    setClockMode('minute');
                }
            }
        });

        dial.ontouchstart = (e) => {
            isDragging = true;
            modalOverlay.querySelector('#mt-clock-hand').classList.add('dragging');
            handlePointer(e);
        };
        dial.ontouchmove = (e) => {
            if (isDragging) handlePointer(e);
        };
        dial.ontouchend = () => {
            if (isDragging) {
                isDragging = false;
                modalOverlay.querySelector('#mt-clock-hand').classList.remove('dragging');
                if (clockState.mode === 'hour') {
                    setClockMode('minute');
                }
            }
        };

        setClockMode('hour');
        modalOverlay.classList.add('active');
    }

    async submitBooking(body) {
        const name = body.querySelector('#field-name').value.trim();
        const phone = body.querySelector('#field-phone').value.trim();
        const email = body.querySelector('#field-email').value.trim();

        if (!name || !phone) {
            this.showModal(this.t('missing_info_title'), this.t('missing_info_msg'));
            return;
        }

        this.bookingData.name = name;
        this.bookingData.phone = phone;
        this.bookingData.email = email;

        // Save contact info to localStorage
        localStorage.setItem('mt_customer_info', JSON.stringify({ name, phone, email }));

        const btn = body.querySelector('#btn-submit-res');
        btn.textContent = this.t('submitting');
        btn.disabled = true;

        if (!this.supabase) await this.initSupabase();

        try {
            const domain = this.getAttribute('domain') || window.location.hostname.replace(/^www\./, '');
            const payload = {
                user_id: this.settings.user_id,
                domain: domain,
                customer_name: name,
                customer_phone: phone,
                customer_email: email,
                guests_count: this.bookingData.guests,
                reservation_date: this.bookingData.date,
                reservation_time: this.bookingData.time,
                comments: this.bookingData.comments,
                preorder_items: this.preorderCart,
                status: 'pending'
            };

            const { data: inserted, error } = await this.supabase.from('menutech_reservations').insert(payload).select().single();
            if (error) throw error;

            this.reservationId = inserted.id;
            this.reservationStatus = inserted.status || 'pending';
            this.step = 4;
            this.renderStep();
            this.startReservationTracking(inserted.id);
        } catch (e) {
            this.showModal(this.t('res_error_title'), this.t('res_error_msg') + e.message);
            btn.textContent = this.t('submit_btn');
            btn.disabled = false;
        }
    }

    startReservationTracking(resId) {
        if (!this.supabase || !resId) return;
        if (this.resTrackingChannel) {
            this.supabase.removeChannel(this.resTrackingChannel);
        }

        this.resTrackingChannel = this.supabase.channel('res_tracking_' + resId.substring(0, 8))
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'menutech_reservations',
                filter: 'id=eq.' + resId
            }, (payload) => {
                if (payload.new) {
                    if (payload.new.status) this.reservationStatus = payload.new.status;
                    if (payload.new.payment_status) this.reservationPaymentStatus = payload.new.payment_status;
                    if (this.step === 4) {
                        this.renderStep();
                    }
                }
            })
            .subscribe();
    }
}

if (!customElements.get('menutech-reservations')) {
    customElements.define('menutech-reservations', MenutechReservations);
}
