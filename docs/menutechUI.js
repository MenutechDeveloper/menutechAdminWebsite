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
        return ['domain', 'type', 'images-list'];
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

        if (attrType && attrImages) {
            return {
                images: attrImages.split(',').map(url => ({ image_url: url.trim() })),
                type: attrType
            };
        }

        if (!this.supabase) await this.initSupabase();
        try {
            const imagesPromise = this.supabase
                .from('galeria')
                .select('image_url')
                .eq('domain', domain)
                .order('created_at', { ascending: false });

            const typePromise = this.supabase
                .from('profiles')
                .select('gallery_type')
                .eq('domain', domain)
                .maybeSingle();

            const [imagesRes, typeRes] = await Promise.all([imagesPromise, typePromise]);

            if (imagesRes.error) throw imagesRes.error;

            return {
                images: imagesRes.data || [],
                type: (typeRes.data && typeRes.data.gallery_type) ? typeRes.data.gallery_type : 'grid'
            };
        } catch (err) {
            console.error("MenutechGallery Fetch Error:", err);
            return { images: [], type: 'grid' };
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

            const styles = `
                <style>
                    :host { display: block; width: 100%; max-width: 1200px; margin: 80px auto; padding: 0 24px; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; box-sizing: border-box; clear: both; text-align: center; }
                    .gallery-grid {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        gap: 30px;
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
                    .gallery-item:hover { transform: translateY(-8px); box-shadow: 0 20px 40px -10px rgba(0,0,0,0.4); }
                    .gallery-item img {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        transition: transform 1.2s cubic-bezier(0.16, 1, 0.3, 1);
                    }
                    .gallery-item:hover img { transform: scale(1.06); }

                    .loader { text-align: center; padding: 60px; color: #ff9533; font-weight: 600; letter-spacing: 1px; }

                    @media (max-width: 768px) {
                        :host { margin: 40px auto; padding: 0 16px; }
                        .gallery-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
                    }

                    /* Slider specific styles */
                    .swiper { width: 100%; padding: 50px 0; overflow: hidden; position: relative; }
                    .swiper-wrapper { display: flex; align-items: center; }
                    .swiper-slide {
                        width: 300px;
                        height: 300px;
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
                        .swiper-slide { width: 260px; height: 260px; }
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
                const slidesHtml = images.map(img => `
                    <div class="swiper-slide">
                        <img src="${img.image_url}" />
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
                        loop: images.length > 3,
                        coverflowEffect: {
                            rotate: 50,
                            stretch: 0,
                            depth: 100,
                            modifier: 1,
                            slideShadows: true,
                        },
                        pagination: {
                            el: this.shadowRoot.querySelector('.swiper-pagination'),
                            clickable: true
                        },
                        autoplay: {
                            delay: 2500,
                            disableOnInteraction: false,
                        },
                    });
                }
            } else {
                const itemsHtml = images.map((img, i) => `
                    <div class="gallery-item ${this.getPattern(i)}">
                        <img src="${img.image_url}" loading="lazy">
                    </div>
                `).join('');

                this.shadowRoot.innerHTML = `${styles}<div class="gallery-grid">${itemsHtml}</div>`;
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
