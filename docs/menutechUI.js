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
                    :host([admin-mode]) { margin: 20px auto; }
                    .gallery-grid {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        gap: 30px;
                        padding: 0;
                        margin: 0 auto;
                    }

                    .gallery-bento {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        grid-auto-rows: minmax(200px, auto);
                        grid-auto-flow: dense;
                        gap: 20px;
                        padding: 0;
                        margin: 0 auto;
                    }

                    .gallery-item {
                        position: relative;
                        border-radius: 28px;
                        overflow: hidden;
                        background: #14161d;
                        box-shadow: 0 12px 30px -10px rgba(0,0,0,0.3);
                        transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
                        aspect-ratio: 1/1;
                    }

                    .gallery-bento .gallery-item { aspect-ratio: auto; min-height: 200px; }
                    .gallery-item:hover { transform: translateY(-8px); box-shadow: 0 20px 40px -10px rgba(0,0,0,0.4); }
                    .gallery-item img {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        transition: transform 1.2s cubic-bezier(0.16, 1, 0.3, 1);
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
                    }
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

                    /* Bento Controls */
                    .bento-controls {
                        position: absolute;
                        bottom: 15px;
                        left: 15px;
                        right: 15px;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        opacity: 0;
                        transition: 0.3s;
                        z-index: 20;
                    }
                    .gallery-item:hover .bento-controls { opacity: 1; }
                    .bento-row { display: flex; gap: 8px; justify-content: center; }
                    .btn-bento {
                        background: rgba(255, 255, 255, 0.2);
                        backdrop-filter: blur(10px);
                        border: 1px solid rgba(255, 255, 255, 0.3);
                        color: white;
                        padding: 6px 12px;
                        border-radius: 10px;
                        font-size: 0.7rem;
                        font-weight: 700;
                        cursor: pointer;
                        transition: 0.2s;
                    }
                    .btn-bento:hover { background: #ff9533; border-color: transparent; }

                    .slant-handle {
                        position: absolute;
                        top: 0;
                        width: 12px;
                        height: 30px;
                        background: #ff9533;
                        cursor: ns-resize;
                        z-index: 30;
                        border-radius: 6px;
                        opacity: 0;
                        transition: 0.3s;
                        border: 2px solid white;
                    }
                    .gallery-item:hover .slant-handle { opacity: 1; }
                    .handle-left { left: 15px; }
                    .handle-right { right: 15px; }

                    .loader { text-align: center; padding: 60px; color: #ff9533; font-weight: 600; letter-spacing: 1px; }

                    @media (max-width: 768px) {
                        :host { margin: 40px auto; padding: 0 16px; }
                        .gallery-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
                        .gallery-bento { grid-template-columns: repeat(2, 1fr); gap: 16px; }
                        .gallery-bento .gallery-item { min-height: 150px; }
                    }

                    /* Slider specific styles */
                    .swiper { width: 100%; max-width: 800px; margin: 0 auto; padding: 50px 0; overflow: hidden; position: relative; }
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
            } else {
                const isBento = type === 'bento';
                const itemsHtml = images.map((img, i) => {
                    let style = '';
                    let bentoData = { s: '1x1', l: 0, r: 0 };

                    if (isBento) {
                        try {
                            const hash = img.image_url.split('#')[1];
                            if (hash) {
                                const params = new URLSearchParams(hash);
                                bentoData.s = params.get('s') || '1x1';
                                bentoData.l = parseInt(params.get('l')) || 0;
                                bentoData.r = parseInt(params.get('r')) || 0;
                            }
                        } catch(e) {}

                        const [w, h] = bentoData.s.split('x').map(Number);
                        style = `grid-column: span ${w}; grid-row: span ${h};`;
                        if (bentoData.l !== 0 || bentoData.r !== 0) {
                            style += ` clip-path: polygon(0 ${bentoData.l}%, 100% ${bentoData.r}%, 100% 100%, 0% 100%);`;
                        }
                    }

                    return `
                    <div class="gallery-item ${this.getPattern(i)}" style="${style}" data-index="${i}" data-s="${bentoData.s}" data-l="${bentoData.l}" data-r="${bentoData.r}">
                        <img src="${img.image_url.split('#')[0]}" loading="lazy">
                        ${isAdmin ? `
                            <div class="admin-overlay">
                                <button class="btn-delete" data-index="${i}">Remove</button>
                            </div>
                            ${isBento ? `
                                <div class="slant-handle handle-left" data-side="l"></div>
                                <div class="slant-handle handle-right" data-side="r"></div>
                                <div class="bento-controls">
                                    <div class="bento-row">
                                        <button class="btn-bento btn-size" data-index="${i}">Size: ${bentoData.s}</button>
                                        <button class="btn-bento btn-reset" data-index="${i}">Reset</button>
                                    </div>
                                </div>
                            ` : ''}
                        ` : ''}
                    </div>
                `}).join('');

                this.shadowRoot.innerHTML = `${styles}<div class="${isBento ? 'gallery-bento' : 'gallery-grid'}">${itemsHtml}</div>`;
            }

            if (isAdmin) {
                if (type === 'bento') {
                    const sizes = ['1x1', '2x1', '1x2', '2x2'];
                    this.shadowRoot.querySelectorAll('.btn-size').forEach(btn => {
                        btn.onclick = (e) => {
                            e.stopPropagation();
                            const idx = btn.getAttribute('data-index');
                            const item = this.shadowRoot.querySelector(`.gallery-item[data-index="${idx}"]`);
                            let current = item.getAttribute('data-s');
                            let next = sizes[(sizes.indexOf(current) + 1) % sizes.length];
                            this.updateBentoItem(idx, { s: next });
                        };
                    });
                    this.shadowRoot.querySelectorAll('.btn-reset').forEach(btn => {
                        btn.onclick = (e) => {
                            e.stopPropagation();
                            this.updateBentoItem(btn.getAttribute('data-index'), { l: 0, r: 0, s: '1x1' });
                        };
                    });

                    let dragging = null;
                    const onMove = (e) => {
                        if (!dragging) return;
                        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                        const deltaY = clientY - dragging.initialY;
                        const rect = dragging.item.getBoundingClientRect();
                        const deltaPercent = Math.round((deltaY / rect.height) * 100);
                        let newVal = Math.max(0, Math.min(50, dragging.initialVal + deltaPercent));
                        this.updateBentoItem(dragging.item.getAttribute('data-index'), { [dragging.side]: newVal }, false);
                    };
                    const onEnd = () => {
                        if (dragging) {
                            const idx = dragging.item.getAttribute('data-index');
                            dragging = null;
                            this.updateBentoItem(idx, {}, true);
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onEnd);
                        }
                    };
                    this.shadowRoot.querySelectorAll('.slant-handle').forEach(handle => {
                        handle.onmousedown = (e) => {
                            e.preventDefault(); e.stopPropagation();
                            const item = handle.closest('.gallery-item');
                            dragging = {
                                item,
                                side: handle.getAttribute('data-side'),
                                initialY: e.clientY,
                                initialVal: parseInt(item.getAttribute(`data-${handle.getAttribute('data-side')}`))
                            };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onEnd);
                        };
                    });
                }
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

    updateBentoItem(idx, updates, shouldDispatch = true) {
        const item = this.shadowRoot.querySelector(`.gallery-item[data-index="${idx}"]`);
        if (!item) return;

        if (updates.s) item.setAttribute('data-s', updates.s);
        if (updates.l !== undefined) item.setAttribute('data-l', updates.l);
        if (updates.r !== undefined) item.setAttribute('data-r', updates.r);

        const s = item.getAttribute('data-s');
        const l = item.getAttribute('data-l');
        const r = item.getAttribute('data-r');

        const [w, h] = s.split('x').map(Number);
        item.style.gridColumn = `span ${w}`;
        item.style.gridRow = `span ${h}`;
        item.style.clipPath = `polygon(0 ${l}%, 100% ${r}%, 100% 100%, 0% 100%)`;

        const btnSize = item.querySelector('.btn-size');
        if (btnSize) btnSize.textContent = `Size: ${s}`;

        if (shouldDispatch) {
            this.dispatchEvent(new CustomEvent('update-layout', {
                detail: { index: parseInt(idx), layout: { s, l, r } },
                bubbles: true,
                composed: true
            }));
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
