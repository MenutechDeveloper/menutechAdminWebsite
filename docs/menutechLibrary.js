/* Menutech: Ordering & Reservation Buttons Library */
let stylesInjected = false;

function injectMenuTechStyles() {
    if (stylesInjected) return;
    if (typeof document === 'undefined') return;

    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&display=swap');

    menutech-orders, menutech-reservations {
      display: inline-block !important;
      font-family: 'Poppins', sans-serif !important;
      margin: 8px !important;
      vertical-align: middle !important;
      text-align: center !important;
    }
    .menutech-btn {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 12px !important;
      white-space: nowrap !important;
      text-decoration: none !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      overflow: hidden !important;
      border-radius: 10px !important;
      transition: all .36s cubic-bezier(.2,.9,.2,1) !important;
      box-shadow: 0 6px 20px rgba(0,0,0,0.4) !important;
      padding: 12px 24px !important;
      min-height: 48px !important;
      border: none !important;
      min-width: 210px !important;
      color: #fff !important;
    }
    .menutech-btn:hover {
      transform: translateY(-3px) !important;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5) !important;
    }
    .menutech-icon {
      width: 22px !important;
      height: 22px !important;
      flex-shrink: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .menutech-icon svg {
      width: 100% !important;
      height: 100% !important;
      display: block !important;
    }
    .btn-text {
      display: inline-block !important;
      font-family: 'Poppins', sans-serif !important;
      font-size: 15px !important;
      letter-spacing: 0.3px !important;
      text-transform: uppercase !important;
    }
  `;
    document.head.appendChild(style);
}

class MenuTechButton extends HTMLElement {
    static get observedAttributes() {
        return ['cuid', 'ruid', 'color', 'background', 'textcolor', 'textColor', 'custom-label', 'reservation'];
    }

    constructor() {
        super();
        injectMenuTechStyles();
    }

    connectedCallback() {
        this.updateProps();
        this.render();
        this.loadIcon();
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal !== newVal) {
            this.updateProps();
            this.render();
            if (name === 'color' || !this.querySelector('.menutech-icon svg')) {
                this.loadIcon();
            }
        }
    }

    updateProps() {
        this.cuid = this.getAttribute('cuid') || '';
        this.ruid = this.getAttribute('ruid') || '';
        this.color = this.getAttribute('color') || '#ffffff';
        this.isReservation = this.hasAttribute('reservation') || this.getAttribute('reservation') === 'true' || this.isReservation === true;
        this.background = this.getAttribute('background') || (this.isReservation ? '#2f4854' : '#743d02');
        this.textColor = this.getAttribute('textColor') || this.getAttribute('textcolor') || '#ffffff';
        this.customLabel = this.getAttribute('custom-label');
    }

    render() {
        const text = this.customLabel || (this.isReservation ? 'Table Reservation' : 'See MENU & Order Now!');
        const reservationAttr = this.isReservation ? 'data-glf-reservation="true"' : '';

        this.innerHTML = `
      <span class="glf-button menutech-btn"
            data-glf-cuid="${this.cuid}"
            data-glf-ruid="${this.ruid}"
            ${reservationAttr}
            style="background: ${this.background} !important; color: ${this.textColor} !important;">
        <span class="menutech-icon" style="color: ${this.color} !important;"></span>
        <span class="btn-text" style="color: ${this.textColor} !important;">${text}</span>
      </span>
    `;
    }

    loadIcon() {
        const iconContainer = this.querySelector('.menutech-icon');
        if (!iconContainer) return;

        fetch("https://menutechdeveloper.github.io/libreria/icons/mago.svg")
            .then(r => r.text())
            .then(svg => {
                svg = svg.replace(/fill="[^"]*"/g, 'fill="currentColor"');
                svg = svg.replace(/<svg([^>]*)>/i, '<svg$1 width="22" height="22">');
                iconContainer.innerHTML = svg;
                iconContainer.style.color = this.color;
            })
            .catch(err => {
                console.error("Error loading Menutech icon:", err);
                iconContainer.innerHTML = '';
            });
    }
}

class MenuTechOrders extends MenuTechButton {
    constructor() {
        super();
    }
}

class MenuTechReservations extends MenuTechButton {
    constructor() {
        super();
        this.isReservation = true;
    }
}

if (!customElements.get('menutech-orders')) {
    customElements.define('menutech-orders', MenuTechOrders);
}
if (!customElements.get('menutech-reservations')) {
    customElements.define('menutech-reservations', MenuTechReservations);
}
