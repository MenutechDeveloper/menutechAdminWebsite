/**
 * Menutech Gallery Web Component
 * Usage: <menutech-gallery domain="yoursite.com"></menutech-gallery>
 */
class MenutechGallery extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.config = {
            url: "https://eemqyrysdgasfjlitads.supabase.co",
            key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlbXF5cnlzZGdhc2ZqbGl0YWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MjA0NDUsImV4cCI6MjA4OTI5NjQ0NX0.UiyZLqhXSQ1Z_FoL006PDrDYKXbr_pxCOugYTulhdPY"
        };
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
                ghost.style.gridColumn = item.style.gridColumn;
                ghost.style.gridRow = item.style.gridRow;
            };

            item.ondragend = () => {
                item.classList.remove('is-dragging');
                if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
                dragItem = null;
            };

            item.ondragover = (e) => {
                e.preventDefault();
                const target = e.target.closest('.gallery-item');
                if (target && target !== dragItem && target !== ghost) {
                    const rect = target.getBoundingClientRect();
                    const next = (e.clientX - rect.left) > (rect.width / 2);
                    container.insertBefore(ghost, next ? target.nextSibling : target);
                }
            };

            item.ondrop = (e) => {
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
        });

        // --- Fluid Resizing logic ---
        let startX, startY, startW, startH, activeItem = null, activeHandle = null;
        let resizeGhost = document.createElement('div');
        resizeGhost.className = 'gallery-item ghost resize-ghost';
        resizeGhost.style.zIndex = '1000';
        resizeGhost.style.pointerEvents = 'none';

        const onMouseMove = (e) => {
            if (!activeItem) return;
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);
            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            const isMobile = window.innerWidth <= 768;
            const gridColWidth = container.offsetWidth / (isMobile ? 3 : 6);
            const gridRowHeight = isMobile ? 100 : 150;

            let newW = startW;
            let newH = startH;

            if (activeHandle.classList.contains('handle-br')) {
                newW = startW + Math.round(deltaX / gridColWidth);
                newH = startH + Math.round(deltaY / gridRowHeight);
            } else if (activeHandle.classList.contains('handle-bl')) {
                newW = startW - Math.round(deltaX / gridColWidth);
                newH = startH + Math.round(deltaY / gridRowHeight);
            } else if (activeHandle.classList.contains('handle-tr')) {
                newW = startW + Math.round(deltaX / gridColWidth);
                newH = startH - Math.round(deltaY / gridRowHeight);
            } else if (activeHandle.classList.contains('handle-tl')) {
                newW = startW - Math.round(deltaX / gridColWidth);
                newH = startH - Math.round(deltaY / gridRowHeight);
            }

            newW = Math.max(1, Math.min(isMobile ? 3 : 6, newW));
            newH = Math.max(1, Math.min(6, newH));

            const rect = activeItem.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const colStart = Math.round((rect.left - containerRect.left) / gridColWidth) + 1;
            const rowStart = Math.round((rect.top - containerRect.top) / gridRowHeight) + 1;

            resizeGhost.style.gridColumn = `${colStart} / span ${newW}`;
            resizeGhost.style.gridRow = `${rowStart} / span ${newH}`;
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
                const gridColWidth = container.offsetWidth / (isMobile ? 3 : 6);
                const gridRowHeight = isMobile ? 100 : 150;

                startX = e.clientX || (e.touches && e.touches[0].clientX);
                startY = e.clientY || (e.touches && e.touches[0].clientY);

                const colMatch = activeItem.style.gridColumn.match(/span (\d+)/);
                const rowMatch = activeItem.style.gridRow.match(/span (\d+)/);
                startW = colMatch ? parseInt(colMatch[1]) : 2;
                startH = rowMatch ? parseInt(rowMatch[1]) : 2;

                const rect = activeItem.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const colStart = Math.round((rect.left - containerRect.left) / gridColWidth) + 1;
                const rowStart = Math.round((rect.top - containerRect.top) / gridRowHeight) + 1;

                resizeGhost.style.gridColumn = `${colStart} / span ${startW}`;
                resizeGhost.style.gridRow = `${rowStart} / span ${startH}`;

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
        if (this._rendering) return;
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
                    }
                    .gallery-bento .gallery-item { aspect-ratio: auto; }
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
                        background: var(--orange, #ff9533);
                        z-index: 20;
                        display: none;
                        transition: transform 0.2s;
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

                    @media (max-width: 768px) {
                        :host { margin: 40px auto; padding: 0 16px; }
                        .gallery-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
                        .gallery-bento { grid-template-columns: repeat(3, 1fr); grid-auto-rows: 100px; gap: 10px; }
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
                    <div class="swiper-slide" style="position: relative;">
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
                            ` : ''}
                        </div>
                    `;
                }).join('');

                this.shadowRoot.innerHTML = `${styles}<div class="gallery-bento">${itemsHtml}</div>`;
                if (isAdmin) this.initBentoAdmin();

            } else {
                const itemsHtml = images.map((img, i) => `
                    <div class="gallery-item ${this.getPattern(i)}">
                        <div class="item-inner">
                            <img src="${img.image_url}" loading="lazy">
                            ${isAdmin ? `
                                <div class="admin-overlay">
                                    <button class="btn-delete" data-index="${i}">Remove</button>
                                </div>
                            ` : ''}
                        </div>
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
        this.config = {
            url: "https://eemqyrysdgasfjlitads.supabase.co",
            key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlbXF5cnlzZGdhc2ZqbGl0YWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MjA0NDUsImV4cCI6MjA4OTI5NjQ0NX0.UiyZLqhXSQ1Z_FoL006PDrDYKXbr_pxCOugYTulhdPY"
        };
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
