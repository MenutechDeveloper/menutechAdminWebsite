/* Menutech: Ordering & Reservation Buttons Library */
let stylesInjected = false;

function injectMenuTechStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
    menutech-orders, menutech-reservations {
      display: inline-block;
      font-family: 'Poppins', sans-serif;
    }
    .menutech-btn {
      display: inline-flex;
      flex-direction: row !important;
      flex-wrap: nowrap;
      align-items: center;
      gap: 12px;
      white-space: nowrap;
      text-decoration: none;
      font-weight: 600;
      cursor: pointer;
      overflow: hidden;
      border-radius: 10px;
      transition: all .36s cubic-bezier(.2,.9,.2,1);
      box-shadow: 0 6px 18px rgba(0,0,0,0.45);
      padding: 12px 16px;
      min-height: 44px;
    }
    .menutech-btn.menutech-outline {
      box-shadow: none;
      padding: 10px 14px;
      background: transparent;
      border-width: 2px;
      border-style: solid;
    }
    .menutech-icon {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform .32s ease;
    }
    .menutech-icon svg {
      width: 100%;
      height: 100%;
    }
    .menutech-icon, .btn-text {
      display: inline-block !important;
      vertical-align: middle !important;
    }
  `;
    document.head.appendChild(style);
}

class MenuTechButton extends HTMLElement {
    static get observedAttributes() {
        return ['cuid', 'ruid', 'color', 'background', 'textcolor', 'border-color', 'custom-label', 'reservation'];
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
            // Icons don't usually change, but if they did we'd call loadIcon
            if (!this.querySelector('.menutech-icon svg')) this.loadIcon();
        }
    }

    updateProps() {
        this.cuid = this.getAttribute('cuid');
        this.ruid = this.getAttribute('ruid');
        this.color = this.getAttribute('color');
        this.background = this.getAttribute('background');
        this.textColor = this.getAttribute('textColor') || this.getAttribute('textcolor');
        this.borderColor = this.getAttribute('border-color');
        this.customLabel = this.getAttribute('custom-label');
        this.isReservation = this.hasAttribute('reservation') || this.getAttribute('reservation') === 'true' || this.isReservation === true;
    }

    render() {
        const text = this.customLabel || (this.isReservation ? 'Table Reservation' : 'See MENU & Order Now!');
        const reservationAttr = this.isReservation ? 'data-glf-reservation="true"' : '';
        const isOutline = this.borderColor;

        this.innerHTML = `
      <span class="glf-button menutech-btn ${isOutline ? 'menutech-outline' : ''}"
            data-glf-cuid="${this.cuid}"
            data-glf-ruid="${this.ruid}"
            ${reservationAttr}
            style="
              background: ${isOutline ? 'transparent' : (this.background || 'linear-gradient(135deg, #e63946, #ff6b6b)')};
              color: ${this.textColor || '#fff'};
              border-color: ${isOutline ? this.borderColor : 'none'};
            ">
        <span class="menutech-icon" style="color: ${this.color || '#fff'}"></span>
        <span class="btn-text">${text}</span>
      </span>
    `;

        if (this.textColor) {
            const btnText = this.querySelector('.btn-text');
            if (btnText) {
                btnText.style.color = this.textColor;
            }
        }
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
            })
            .catch(err => console.error("Error loading Menutech icon:", err));
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
