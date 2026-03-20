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
        return ['domain'];
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (name === 'domain' && oldVal !== newVal) {
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

    async fetchImages(domain) {
        if (!this.supabase) await this.initSupabase();
        try {
            const { data, error } = await this.supabase
                .from('galeria')
                .select('image_url')
                .eq('domain', domain)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error("MenutechGallery Fetch Error:", err);
            return [];
        }
    }

    getPattern(i) {
        return '';
    }

    async render() {
        let domain = this.getAttribute('domain');

        // Fallback: Use current hostname if domain attribute is missing
        if (!domain) {
            domain = window.location.hostname.replace(/^www\./, '');
        }

        if (!domain) {
            this.shadowRoot.innerHTML = `<p style="color:#ef4444; font-weight:500;">Error: Could not determine domain.</p>`;
            return;
        }

        const styles = `
            <style>
                :host { display: block; width: 100%; max-width: 1200px; margin: 60px auto; padding: 0 24px; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; box-sizing: border-box; }
                .gallery-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 30px;
                    padding: 0;
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
            </style>
        `;

        this.shadowRoot.innerHTML = `${styles}<div class="loader">Loading Gallery...</div>`;

        const images = await this.fetchImages(domain);

        if (images.length === 0) {
            this.shadowRoot.innerHTML = `${styles}<div style="text-align:center; padding: 80px 20px; color: #64748b; font-weight: 400;">No images found in the gallery for this domain.</div>`;
            return;
        }

        const itemsHtml = images.map((img, i) => `
            <div class="gallery-item ${this.getPattern(i)}">
                <img src="${img.image_url}" loading="lazy">
            </div>
        `).join('');

        this.shadowRoot.innerHTML = `${styles}<div class="gallery-grid">${itemsHtml}</div>`;
    }
}

customElements.define('menutech-gallery', MenutechGallery);
