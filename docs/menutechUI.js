const MT_UI_CONFIG = {
    url: "https://eemqyrysdgasfjlitads.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlbXF5cnlzZGdhc2ZqbGl0YWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MjA0NDUsImV4cCI6MjA4OTI5NjQ0NX0.UiyZLqhXSQ1Z_FoL006PDrDYKXbr_pxCOugYTulhdPY"
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
                const slidesHtml = images.map((img, i) => `
                    <div class="swiper-slide">
                        <img src="${img.image_url}" />
                        ${isAdmin ? `
                            <div class="admin-overlay">
                                <button class="btn-delete" data-index="${i}">Remove</button>
                            </div>
                        ` : ''}
                    </div>
                `).join('');

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
                    const sw = match ? match[1] : 2;
                    const sh = match ? match[2] : 2;

                    return `
                        <div class="gallery-item" data-index="${i}" style="grid-column: span ${sw}; grid-row: span ${sh};" draggable="${isAdmin}">
                            <div class="item-inner">
                                <img src="${img.image_url}" loading="lazy">
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
                const itemsHtml = images.map((img, i) => `
                    <div class="gallery-item ${this.getPattern(i)}">
                        <img src="${img.image_url}" loading="lazy">
                        ${isAdmin ? `
                            <div class="admin-overlay">
                                <button class="btn-delete" data-index="${i}">Remove</button>
                            </div>
                        ` : ''}
                    </div>
                `).join('');

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
                .eq('is_active', true)
                .single();

            if (error) return null;
            return data;
        } catch (err) {
            return null;
        }
    }

    isPromoValid(promo) {
        if (!promo) return false;
        const now = new Date();
        const start = promo.start_date ? new Date(promo.start_date) : null;
        const end = promo.end_date ? new Date(promo.end_date) : null;

        // Default event dates fallback if no dates provided
        if (!start && !end) {
            const currentYear = now.getFullYear();
            let eventDate;
            switch(this.eventType) {
                case 'christmas': eventDate = new Date(currentYear, 11, 25); break;
                case 'halloween': eventDate = new Date(currentYear, 9, 31); break;
                case 'valentine': eventDate = new Date(currentYear, 1, 14); break;
                case 'president': eventDate = new Date(currentYear, 1, 15); break; // Simplified
            }
            return now.toDateString() === eventDate.toDateString();
        }

        if (start && now < start) return false;
        if (end && now > end) return false;
        return true;
    }

    async render() {
        let domain = this.getAttribute('domain') || window.location.hostname.replace(/^www\./, '');
        const promo = await this.fetchPromoData(domain);

        if (!this.isPromoValid(promo)) {
            this.shadowRoot.innerHTML = '';
            return;
        }

        const color = this.getAttribute("color") || (this.eventType === 'halloween' ? "#ff6600" : "#ffffff");
        const cantidad = parseInt(this.getAttribute("cantidad")) || 50;
        const tamano = parseFloat(this.getAttribute("tamano")) || 5;
        const velocidad = parseFloat(this.getAttribute("velocidad")) || 1;
        const opacidad = parseFloat(this.getAttribute("opacidad")) || 0.8;

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
                const size = tamano + Math.random() * tamano;
                const dur = (5 + Math.random() * 5) / velocidad;
                const delay = Math.random() * 5;
                const img = snowImages[i % snowImages.length];
                particles += `<div class="particle" style="left:${x}%; width:${size}px; height:${size}px; animation-duration:${dur}s; animation-delay:${delay}s; background-image:url('${img}'); opacity:${opacidad};"></div>`;
            }
        } else if (this.eventType === 'halloween') {
            const hwImages = [
                "https://menutechdeveloper.github.io/libreria/hw1.png",
                "https://menutechdeveloper.github.io/libreria/hw2.png",
                "https://menutechdeveloper.github.io/libreria/hw3.png"
            ];
            for (let i = 0; i < cantidad; i++) {
                const x = Math.random() * 100;
                const y = Math.random() * 100;
                const size = (tamano * 2) + Math.random() * (tamano * 2);
                const dur = (4 + Math.random() * 4) / velocidad;
                const delay = Math.random() * 3;
                const img = hwImages[i % hwImages.length];
                particles += `<div class="particle-static" style="left:${x}%; top:${y}%; width:${size}px; height:${size}px; animation-duration:${dur}s; animation-delay:${delay}s; background-image:url('${img}'); opacity:0;"></div>`;
            }
        }

        const isPopup = promo.display_mode === 'popup';
        const styles = `
            <style>
                :host {
                    position: ${isPopup ? 'fixed' : 'relative'};
                    top: 0; left: 0; width: 100%;
                    height: ${isPopup ? '100%' : 'auto'};
                    pointer-events: none;
                    z-index: 9999;
                    overflow: ${isPopup ? 'hidden' : 'visible'};
                    display: block;
                }
                .promo-container { font-family: 'Plus Jakarta Sans', sans-serif; }

                /* Particles */
                .particle {
                    position: absolute; top: -20px; background-size: contain; background-repeat: no-repeat;
                    animation: fall linear infinite; will-change: transform; opacity: 0.8;
                }
                .particle-static {
                    position: absolute; background-size: contain; background-repeat: no-repeat;
                    animation: appearDisappear linear infinite; will-change: opacity, transform; opacity: 0;
                }
                @keyframes fall {
                    0% { transform: translateY(0) rotate(0deg); }
                    100% { transform: translateY(110vh) rotate(360deg); }
                }
                @keyframes appearDisappear {
                    0%, 100% { opacity: 0; transform: scale(0.5); }
                    50% { opacity: 0.8; transform: scale(1.1); }
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
                    position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px);
                    display: flex; align-items: center; justify-content: center; z-index: 10000;
                    animation: fadeIn 0.5s ease;
                    pointer-events: auto;
                }
                .promo-popup-card {
                    position: relative; max-width: 90%; max-height: 90%; border-radius: 30px;
                    overflow: hidden; box-shadow: 0 30px 60px rgba(0,0,0,0.5);
                    animation: scaleUp 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .promo-popup-card img { display: block; max-width: 100%; max-height: 85vh; object-fit: contain; }
                .close-btn {
                    position: absolute; top: 20px; right: 20px; width: 40px; height: 40px;
                    border-radius: 50%; background: white; border: none; cursor: pointer;
                    display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 20px rgba(0,0,0,0.2);
                }
                .promo-section {
                    width: 100%; max-width: 650px; margin: 40px auto; padding: 0 24px;
                    display: flex; flex-direction: column; align-items: center; box-sizing: border-box;
                }
                .promo-section img {
                    display: block; width: auto; max-width: 100%; max-height: 80vh;
                    object-fit: contain; border-radius: 28px; box-shadow: 0 15px 40px rgba(0,0,0,0.2);
                }

                @media (max-width: 768px) {
                    .promo-section { margin: 20px auto; padding: 0 16px; }
                    .promo-section img { max-height: 70vh; }
                }

                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes scaleUp { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            </style>
        `;

        if (promo.display_mode === 'popup') {
            this.shadowRoot.innerHTML = `
                ${styles}
                ${this.eventType === 'halloween' ? '<div class="smoke-layer"></div>' : ''}
                ${particles}
                <div class="promo-popup-overlay" id="promo-overlay">
                    <div class="promo-popup-card">
                        <button class="close-btn" id="close-promo">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:20px;height:20px;color:#000"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                        <img src="${promo.image_url}" alt="${this.eventType} promotion">
                    </div>
                </div>
            `;
            this.shadowRoot.getElementById('close-promo').onclick = () => {
                this.shadowRoot.getElementById('promo-overlay').style.display = 'none';
            };
        } else {
            this.shadowRoot.innerHTML = `
                ${styles}
                ${this.eventType === 'halloween' ? '<div class="smoke-layer"></div>' : ''}
                ${particles}
                <div class="promo-section">
                    <img src="${promo.image_url}" alt="${this.eventType} promotion">
                </div>
            `;
        }
    }
}

customElements.define('menutech-christmas', class extends MenutechPromoBase { constructor() { super('christmas'); } });
customElements.define('menutech-halloween', class extends MenutechPromoBase { constructor() { super('halloween'); } });
customElements.define('menutech-valentine', class extends MenutechPromoBase { constructor() { super('valentine'); } });
customElements.define('menutech-president', class extends MenutechPromoBase { constructor() { super('president'); } });

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
        return ['domain', 'restaurant', 'view'];
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
    }

    renderPopupTrigger() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; font-family: 'Helvetica', 'Arial', sans-serif; }
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
                }
                .btn-see-menu:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 15px 40px rgba(255,149,51,0.4);
                    filter: brightness(1.1);
                }
                .btn-see-menu svg { width: 20px; height: 20px; stroke-width: 2.5; }

                .main-popup-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.85);
                    backdrop-filter: blur(10px);
                    z-index: 100000;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    animation: fadeIn 0.4s ease;
                }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

                .main-popup-content {
                    width: 100%;
                    height: 100%;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                }

                .close-main-popup {
                    position: absolute;
                    top: 25px;
                    right: 25px;
                    width: 45px;
                    height: 45px;
                    border-radius: 50%;
                    background: #fff;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 10px 20px rgba(0,0,0,0.2);
                    z-index: 100001;
                    transition: 0.3s;
                }
                .close-main-popup:hover { transform: scale(1.1); }
            </style>
            <button class="btn-see-menu" id="trigger-popup">
                <span>See MENU & Order Now!</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8L22 12L18 16"/><path d="M2 12H22"/></svg>
            </button>
            <div class="main-popup-overlay" id="main-menu-popup">
                <div class="main-popup-content">
                    <button class="close-main-popup" id="close-main-menu">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:20px;height:20px;color:#000"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    <div id="menu-container-inner" style="height: 100%; overflow-y: auto;">
                        <div class="loader" style="padding: 100px; text-align: center; color: #ff9533; font-weight: 600;">Loading Menu...</div>
                    </div>
                </div>
            </div>
        `;

        this.shadowRoot.getElementById('trigger-popup').onclick = () => {
            this.shadowRoot.getElementById('main-menu-popup').style.display = 'flex';
            document.body.style.overflow = 'hidden';
            if (!this.menuData) {
                this.loadData();
            }
        };

        this.shadowRoot.getElementById('close-main-menu').onclick = () => {
            this.shadowRoot.getElementById('main-menu-popup').style.display = 'none';
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
                this.shadowRoot.getElementById('menu-container-inner').innerHTML = errorMsg;
            } else {
                this.shadowRoot.innerHTML = errorMsg;
            }
            return;
        }
        this.menuData = data;
        this.renderMenu();
    }

    renderLoading() {
        this.shadowRoot.innerHTML = `
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
        const currentDate = now.toISOString().split('T')[0];

        const categories = categoriesData.filter(cat => {
            const vis = cat.visibility;
            if (!vis) return true;
            if (vis.startDate && currentDate < vis.startDate) return false;
            if (vis.endDate && currentDate > vis.endDate) return false;
            if (vis.days && vis.days.length > 0 && !vis.days.includes(currentDay)) return false;
            if (vis.start && currentTime < vis.start) return false;
            if (vis.end && currentTime > vis.end) return false;
            return true;
        });

        const styles = `
            <style>
                :host { display: block; font-family: 'Helvetica', 'Arial', sans-serif; color: #1a1c1e; background: #f0f2f5; min-height: 100vh; }

                * { box-sizing: border-box; }

                .menu-wrapper {
                    max-width: 940px; margin: 30px auto; background: #fff; height: calc(100vh - 60px);
                    box-shadow: 0 40px 120px rgba(0,0,0,0.2);
                    border-radius: 12px; overflow-y: auto;
                    position: relative;
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
                .category-section { margin-bottom: 40px; scroll-margin-top: 80px; }
                .category-header { margin-bottom: 20px; }
                .category-header h2 {
                    margin: 0; font-size: 1.6rem; color: #1a1c1e;
                    ${style === 'mode2' ? 'border-bottom: 2px solid #f0f0f0; padding-bottom: 10px; text-transform: uppercase; font-size: 1.4rem; letter-spacing: 1px;' : ''}
                }
                .category-header p { margin: 5px 0 0; color: #666; font-size: 0.95rem; }

                /* Dish Grid - Mode 1 */
                .dish-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                @media (max-width: 600px) { .dish-grid { grid-template-columns: 1fr; } }

                .dish-card {
                    background: #fff; border-radius: 24px; padding: 15px;
                    display: flex; gap: 15px; cursor: pointer; transition: 0.3s;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.03); border: 1px solid #f8f8f8;
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
                }
                .mode2-item:hover { background: #fcfcfc; }
                .mode2-top-row { display: flex; justify-content: flex-start; align-items: flex-start; gap: 15px; }
                .mode2-left { flex: 1; }
                .mode2-name-price { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
                .mode2-name { font-weight: 800; font-size: 1.05rem; color: #333; text-transform: uppercase; font-family: 'Helvetica', 'Arial', sans-serif; }
                .mode2-price { font-weight: 800; color: #333; font-size: 1.05rem; font-family: 'Helvetica', 'Arial', sans-serif; }
                .mode2-image { width: 80px; height: 80px; border-radius: 12px; overflow: hidden; flex-shrink: 0; }
                .mode2-image img { width: 100%; height: 100%; object-fit: cover; }
                .mode2-desc { font-size: 0.88rem; color: #777; line-height: 1.4; margin: 0; font-family: 'Helvetica', 'Arial', sans-serif; }

                .dish-info { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
                .dish-info h3 { margin: 0; font-size: 1.1rem; color: #1a1c1e; }
                .dish-info p { margin: 5px 0; color: #666; font-size: 0.85rem; line-height: 1.4;
                    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
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
                    background: #fff; width: 100%; max-width: 500px; border-radius: 24px;
                    max-height: 90vh; overflow-y: auto; position: relative;
                    scrollbar-width: none; -ms-overflow-style: none;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s;
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

                .cart-item { display: flex; justify-content: space-between; padding: 15px 0; border-bottom: 1px solid #f9f9f9; }
                .cart-item:last-child { border: none; }
                .cart-item-info h4 { margin: 0; font-size: 1rem; }
                .cart-item-info p { margin: 4px 0 0; font-size: 0.8rem; color: #888; }
                .cart-item-price { font-weight: 700; }

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
                }

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

        const coverHtml = cover_url ? `
            <div class="cover-container">
                ${cover_type === 'video'
                    ? `<video src="${cover_url}" autoplay loop muted playsinline></video>`
                    : `<img src="${cover_url}">`
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
                                ${dish.image ? `<div class="dish-image"><img src="${dish.image}"></div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                ` : `
                    <div class="mode2-list">
                        ${(cat.dishes || []).map(dish => `
                            <div class="mode2-item" data-dish='${JSON.stringify(dish).replace(/'/g, "&apos;")}'>
                                <div class="mode2-top-row">
                                    ${dish.image ? `<div class="mode2-image"><img src="${dish.image}"></div>` : ''}
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
            <div class="menu-wrapper" style="${isPopupView ? 'height: 100vh; margin: 0; max-width: 100%; border-radius: 0;' : ''}">
                ${style === 'mode2' ? `
                    <div class="mode2-main-header">
                        <h1 class="restaurant-name">${config.restaurant_name || 'Menutech'}</h1>
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
            this.shadowRoot.getElementById('menu-container-inner').innerHTML = menuHtml;
        } else {
            this.shadowRoot.innerHTML = menuHtml;
        }

        this.initInteractivity();
    }

    initInteractivity() {
        const tabs = this.shadowRoot.querySelectorAll('.tab');
        const overlay = this.shadowRoot.getElementById('popup');
        const popupContent = this.shadowRoot.getElementById('popup-content');

        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const targetId = tab.getAttribute('data-target');
                const target = this.shadowRoot.getElementById(targetId);
                target.scrollIntoView({ behavior: 'smooth' });
            };
        });

        // Sticky scroll highlight
        const sections = this.shadowRoot.querySelectorAll('.category-section');
        const container = this.shadowRoot.querySelector('.menu-content');
        window.addEventListener('scroll', () => {
            let current = '';
            sections.forEach(section => {
                const sectionTop = section.offsetTop;
                if (window.pageYOffset >= sectionTop - 100) {
                    current = section.getAttribute('id');
                }
            });
            tabs.forEach(tab => {
                tab.classList.remove('active');
                if (tab.getAttribute('data-target') === current) {
                    tab.classList.add('active');
                }
            });
        }, { passive: true });

        const cards = this.shadowRoot.querySelectorAll('.dish-card, .mode2-item');
        cards.forEach(card => {
            card.onclick = (e) => {
                const dish = JSON.parse(card.getAttribute('data-dish'));
                this.openDishPopup(dish, card);
            };
        });

        const headerCartBtn = this.shadowRoot.getElementById('header-cart-btn-top');
        if (headerCartBtn) {
            headerCartBtn.onclick = () => this.openCartPopup();
        }

        const headerInfoBtn = this.shadowRoot.getElementById('header-info-btn');
        if (headerInfoBtn) {
            headerInfoBtn.onclick = () => {
                this.showModal('INFORMACIÓN', this.menuData.config.restaurant_name || 'Menutech Restaurant Information');
            };
        }

        const headerMenuBtn = this.shadowRoot.getElementById('header-menu-btn');
        if (headerMenuBtn) {
            headerMenuBtn.onclick = () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
        }

        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
            }
        };

        const modal = this.shadowRoot.getElementById('custom-modal');
        this.shadowRoot.getElementById('modal-close-btn').onclick = () => {
            modal.style.display = 'none';
        };
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };
    }

    showModal(title, message) {
        const modal = this.shadowRoot.getElementById('custom-modal');
        this.shadowRoot.getElementById('modal-title').textContent = title;
        this.shadowRoot.getElementById('modal-message').textContent = message;
        modal.style.display = 'flex';
    }

    openDishPopup(dish, cardEl) {
        const overlay = this.shadowRoot.getElementById('popup');
        const popupContent = this.shadowRoot.getElementById('popup-content');

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
                ${dish.image ? `<img src="${dish.image}">` : '<div style="height:100%; background:#f0f0f0;"></div>'}
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
                    <div class="option-title">INSTRUCCIONES ESPECIALES</div>
                    <textarea id="dish-instructions" placeholder="Ejem: Sin cebolla, extra salsa..." style="width:100%; padding:15px; border-radius:12px; border:1.5px solid #eee; font-family:inherit; min-height:80px; resize:none; box-sizing:border-box; font-size:0.9rem;"></textarea>
                </div>

                <div style="display:flex; align-items:center; gap:15px; margin-top:25px;">
                    <div style="display:flex; align-items:center; background:#f8f8f8; border-radius:12px; padding:4px; border:1.5px solid #eee;">
                        <button class="qty-btn" id="qty-minus" style="width:36px; height:36px; border:none; background:none; font-size:1.2rem; cursor:pointer; color:#333; font-weight:800;">-</button>
                        <span id="dish-qty" style="width:36px; text-align:center; font-weight:800; font-size:1rem; color:#333;">1</span>
                        <button class="qty-btn" id="qty-plus" style="width:36px; height:36px; border:none; background:none; font-size:1.2rem; cursor:pointer; color:#333; font-weight:800;">+</button>
                    </div>
                    <button class="add-to-cart" style="margin-top:0; flex:1;">AGREGAR AL CARRITO • $${basePrice}</button>
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
        const popupContent = this.shadowRoot.getElementById('popup-content');
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
        btn.textContent = `AGREGAR AL CARRITO • $${total.toFixed(2)}`;

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
            this.shadowRoot.getElementById('popup').style.display = 'none';
        };
    }

    addToCart(item) {
        this.cart.push(item);
        this.updateCartUI();
    }

    updateCartUI() {
        const btn = this.shadowRoot.getElementById('cart-btn');
        const count = this.shadowRoot.getElementById('cart-count');
        const countTop = this.shadowRoot.getElementById('cart-count-top');

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
        const overlay = this.shadowRoot.getElementById('popup');
        const popupContent = this.shadowRoot.getElementById('popup-content');
        overlay.classList.remove('side-popup');
        popupContent.classList.remove('open-left', 'open-right');

        // Set width for two-column layout on PC
        if (window.innerWidth > 1024) {
            popupContent.style.maxWidth = '900px';
        }

        const total = this.cart.reduce((sum, item) => sum + (item.total || item.price), 0);
        const subtotal = total;

        popupContent.innerHTML = `
            <div class="popup-body" style="padding:0">
                <div style="padding:20px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f0f0f0;">
                    <h2 style="margin:0; font-size:1.4rem;">FINALIZAR PEDIDO</h2>
                    <button class="close-popup" style="position:static; border:1px solid #eee;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:18px;height:18px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div class="cart-pc-container">
                    <!-- Left Column: Information (Accordions) -->
                    <div class="cart-left-col" style="overflow-y:auto; scrollbar-width:none; height: 100%;">
                        <!-- Section: Contact Info -->
                        <div class="cart-section">
                            <div class="cart-section-header">1. DATOS DE CONTACTO <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                            <div class="cart-section-content">
                                <div class="cart-input-group">
                                    <label>NOMBRE COMPLETO</label>
                                    <input type="text" id="cust-name" class="cart-input" placeholder="Tu nombre...">
                                </div>
                                <div class="cart-input-group">
                                    <label>TELÉFONO (WHATSAPP)</label>
                                    <input type="tel" id="cust-phone" class="cart-input" placeholder="10 dígitos...">
                                </div>
                            </div>
                        </div>

                        <!-- Section: Type of Order -->
                        <div class="cart-section">
                            <div class="cart-section-header">2. TIPO DE PEDIDO <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                            <div class="cart-section-content">
                                <div class="type-option active" data-type="pickup">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
                                        RECOGER EN RESTAURANTE
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                                <div class="type-option" data-type="delivery">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                                        ENTREGA A DOMICILIO
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                                <div id="delivery-fields" style="display:none; margin-top:15px;">
                                    <div class="cart-input-group">
                                        <label>DIRECCIÓN COMPLETA</label>
                                        <input type="text" id="order-address" class="cart-input" placeholder="Calle, número, colonia...">
                                    </div>
                                    <div class="cart-input-group">
                                        <label>REFERENCIA / INDICACIONES</label>
                                        <input type="text" id="order-reference" class="cart-input" placeholder="Portón azul, junto al Oxxo...">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Section: Schedule -->
                        <div class="cart-section">
                            <div class="cart-section-header">3. ELEGIR HORA DISPONIBLE <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                            <div class="cart-section-content">
                                <div class="time-option active" data-time="asap">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                        LO ANTES POSIBLE (30 MIN APROX.)
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                                <div class="time-option" data-time="later">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                        PROGRAMAR PARA MÁS TARDE
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                                <div id="later-fields" style="display:none; margin-top:15px; gap:10px;">
                                    <div class="cart-input-group" style="flex:1">
                                        <label>FECHA</label>
                                        <input type="date" id="order-date" class="cart-input">
                                    </div>
                                    <div class="cart-input-group" style="flex:1">
                                        <label>HORA</label>
                                        <input type="time" id="order-time" class="cart-input">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Section: Payment Method -->
                        <div class="cart-section">
                            <div class="cart-section-header">4. MÉTODO DE PAGO <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                            <div class="cart-section-content">
                                <div class="payment-option active" data-pay="cash">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
                                        EFECTIVO
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                                <div class="payment-option" data-pay="transfer">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                                        TRANSFERENCIA BANCARIA
                                    </div>
                                    <div class="option-check">✓</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Right Column: Summary & Items -->
                    <div class="cart-right-col">
                        <div style="padding:20px; flex:1; overflow-y:auto; scrollbar-width:none;">
                            <div style="font-weight:800; font-size:0.8rem; color:#888; text-transform:uppercase; margin-bottom:15px; letter-spacing:0.5px;">RESUMEN DE PRODUCTOS</div>
                            ${this.cart.map((item, i) => `
                                <div class="cart-item">
                                    <div class="cart-item-info">
                                        <h4 style="text-transform:uppercase; font-family:'Helvetica', 'Arial', sans-serif;">${item.quantity > 1 ? item.quantity + 'x ' : ''}${item.name}</h4>
                                        <p style="font-size:0.75rem;">${item.size ? item.size : ''} ${item.toppings.length > 0 ? '• ' + item.toppings.join(', ') : ''}</p>
                                        ${item.instructions ? `<p style="color:#ff9533; font-style:italic; font-size:0.75rem;">"${item.instructions}"</p>` : ''}
                                    </div>
                                    <div class="cart-item-price" style="font-family:'Helvetica', 'Arial', sans-serif;">$${(item.total || item.price).toFixed(2)}</div>
                                </div>
                            `).join('')}
                        </div>

                        <div class="order-summary" style="margin:0; padding:20px; background:#f0f0f0; border-top:1.5px solid #eee;">
                            <div class="summary-row"><span>SUBTOTAL</span><span>$${subtotal.toFixed(2)}</span></div>
                            <div class="summary-row"><span>ENVÍO</span><span>$0.00</span></div>
                            <div class="summary-row total" style="border-top-color:#ddd;"><span>TOTAL</span><span>$${total.toFixed(2)}</span></div>
                            <button class="add-to-cart" id="send-order-btn" style="margin-top:20px; width:100%;">ENVIAR PEDIDO • $${total.toFixed(2)}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        overlay.style.display = 'flex';
        popupContent.querySelector('.close-popup').onclick = () => overlay.style.display = 'none';

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
                if (deliveryFields) deliveryFields.style.display = opt.dataset.type === 'delivery' ? 'block' : 'none';
            };
        });

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
    }

    async sendOrder() {
        const popupContent = this.shadowRoot.getElementById('popup-content');
        const name = popupContent.querySelector('#cust-name').value;
        const phone = popupContent.querySelector('#cust-phone').value;

        if (!name || !phone) {
            this.showModal('DATOS FALTANTES', 'Por favor completa tu nombre y teléfono.');
            return;
        }

        const orderType = popupContent.querySelector('.type-option.active').dataset.type;
        const address = popupContent.querySelector('#order-address')?.value || '';
        const reference = popupContent.querySelector('#order-reference')?.value || '';
        const timeMode = popupContent.querySelector('.time-option.active').dataset.time;
        const date = popupContent.querySelector('#order-date')?.value || '';
        const time = popupContent.querySelector('#order-time')?.value || '';
        const payment = popupContent.querySelector('.payment-option.active').dataset.pay;

        const total = this.cart.reduce((sum, item) => sum + (item.total || item.price), 0);
        const btn = popupContent.querySelector('#send-order-btn');
        btn.textContent = 'ENVIANDO...';
        btn.disabled = true;

        if (!this.supabase) await this.initSupabase();

        try {
            const { error } = await this.supabase.from('menutech_orders').insert({
                user_id: this.menuData.user_id,
                items: this.cart,
                total: total,
                customer_name: name,
                customer_phone: phone,
                order_type: orderType,
                address: address,
                reference: reference,
                delivery_time_mode: timeMode,
                delivery_date: date,
                delivery_time: time,
                payment_method: payment,
                status: 'pending'
            });

            if (error) throw error;

            this.showSuccessAnimation();
            this.cart = [];
            this.updateCartUI();
            this.shadowRoot.getElementById('popup').style.display = 'none';
        } catch (e) {
            this.showModal('ERROR', 'Error al enviar pedido: ' + e.message);
            btn.textContent = `ENVIAR PEDIDO • $${total.toFixed(2)}`;
            btn.disabled = false;
        }
    }

    showSuccessAnimation() {
        const anim = document.createElement('div');
        anim.className = 'sending-animation';
        anim.innerHTML = `
            <style>
                @keyframes scaleIn { from { transform: scale(0); } to { transform: scale(1); } }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            </style>
            <div class="check-mark" style="animation: scaleIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)">✓</div>
            <h1 style="font-family:'Outfit'; margin:0;">¡Ya nos llegó tu pedido!</h1>
            <p style="color:#666; margin:10px 0 30px;">Estamos procesando tu orden, por favor mantente al tanto de tu WhatsApp.</p>
            <div style="background:#fff7ed; color:#c2410c; padding:12px 24px; border-radius:20px; font-weight:700; font-size:0.9rem; display:flex; align-items:center; gap:10px;">
                <span style="width:8px; height:8px; background:#f97316; border-radius:50%; display:inline-block;"></span>
                FALTA POR CONFIRMAR
            </div>
            <button id="close-anim" style="margin-top:50px; background:#1a1c1e; color:#fff; border:none; padding:15px 40px; border-radius:20px; font-weight:700; cursor:pointer;">LISTO</button>
        `;
        this.shadowRoot.appendChild(anim);
        this.shadowRoot.getElementById('close-anim').onclick = () => anim.remove();
    }
}

if (!customElements.get('menutech-platform-orders')) {
    customElements.define('menutech-platform-orders', MenutechPlatformOrders);
}

/**
 * Menutech Action Buttons for GloriaFood
 */
class MenutechActionBase extends HTMLElement {
    constructor(type) {
        super();
        this.attachShadow({ mode: 'open' });
        this.type = type; // 'orders' or 'reservations'
    }

    connectedCallback() {
        this.render();
    }

    static get observedAttributes() {
        return ['cuid', 'ruid', 'background', 'color', 'textcolor', 'label'];
    }

    attributeChangedCallback() {
        this.render();
    }

    render() {
        const cuid = this.getAttribute('cuid') || '';
        const ruid = this.getAttribute('ruid') || '';
        const bg = this.getAttribute('background') || (this.type === 'orders' ? '#f2a04a' : '#2f4854');
        const color = this.getAttribute('color') || this.getAttribute('textcolor') || '#ffffff';

        const isRes = this.type === 'reservations';
        const label = isRes ? (this.getAttribute('label') || 'RESERVAR MESA') : (this.getAttribute('label') || 'See MENU & Order Now!');

        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; width: 100%; }
                .btn-glf {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    width: 100%;
                    padding: 16px;
                    border-radius: 16px;
                    border: none;
                    background: ${bg};
                    color: ${color};
                    font-family: 'Plus Jakarta Sans', sans-serif;
                    font-weight: 700;
                    font-size: 0.9rem;
                    text-transform: uppercase;
                    cursor: pointer;
                    transition: all 0.3s;
                    box-shadow: 0 8px 20px rgba(0,0,0,0.1);
                    text-decoration: none;
                }
                .btn-glf:hover { transform: translateY(-2px); filter: brightness(1.1); box-shadow: 0 12px 25px rgba(0,0,0,0.15); }
            </style>
            <button class="btn-glf"
                    data-glf-cuid="${cuid}"
                    data-glf-ruid="${ruid}"
                    ${isRes ? 'data-glf-reservation="true"' : ''}>
                ${label}
            </button>
        `;

        this.shadowRoot.querySelector('button').onclick = () => {
            if (window.glfBindButtons) {
                window.glfBindButtons();
            }
        };
    }
}

if (!customElements.get('menutech-orders')) {
    customElements.define('menutech-orders', class extends MenutechActionBase { constructor() { super('orders'); } });
}
if (!customElements.get('menutech-reservations')) {
    customElements.define('menutech-reservations', class extends MenutechActionBase { constructor() { super('reservations'); } });
}
