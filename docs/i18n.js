/**
 * Menutech Global i18n Translation System
 * Automatically translates platform UI text elements based on menutech_restaurant_language preference
 */
(function () {
    const DICTIONARY = {
        es: {
            "Home": "Inicio",
            "Logout": "Cerrar Sesión",
            "Find Project": "Buscar Proyecto",
            "Domain or Name...": "Dominio o Nombre...",
            "Active Project": "Proyecto Activo",
            "None Selected": "Ninguno Seleccionado",
            "My Restaurant": "Mi Restaurante",
            "My Menu": "Mi Menú",
            "My Reservations": "Mis Reservaciones",
            "Orders & Reservations": "Pedidos y Reservaciones",
            "Delivery": "Delivery",
            "Configure delivery zones, polygon coverage, and shipping fees.": "Configura zonas de entrega, polígonos de cobertura y tarifas de envío.",
            "Delivery & Coverage Zones": "Delivery y Zonas de Cobertura",
            "Delivery Fee": "Tarifa de Entrega",
            "Subtotal": "Subtotal",
            "Admin Billing": "Facturación Admin",
            "Tickets": "Tickets",
            "Users": "Usuarios",
            "Deluxe Website": "Sitio Web Deluxe",
            "Template Web": "Plantilla Web",
            "Menutech Widget": "Widget Menutech",
            "Laboratorio": "Laboratorio",
            "QR Generator": "Generador QR",
            "QR Manager": "Administrador QR",
            "Scanner Google Maps": "Escáner Google Maps",
            "Scanner menus": "Escáner de Menús",
            "Restaurant Logo": "Logo del Restaurante",
            "Restaurant Name": "Nombre del Restaurante",
            "Owner Name": "Nombre del Propietario",
            "Phone Number": "Número de Teléfono",
            "Address": "Dirección",
            "Social Media": "Redes Sociales",
            "Opening Hours": "Horario de Atención",
            "Opening Days": "Días de Apertura",
            "Opening Schedule": "Horario de Apertura",
            "Hours (Opening & Closing)": "Horas (Apertura y Cierre)",
            "GALLERY": "GALERÍA",
            "Save": "Guardar",
            "Saving...": "Guardando...",
            "+ Add Social Network": "+ Agregar Red Social",
            "+ Add Schedule Entry": "+ Agregar Horario",
            "Mon - Fri": "Lun - Vie",
            "Sat - Sun": "Sáb - Dom",
            "All Days": "Todos los Días",
            "Select Hour": "Seleccionar Hora",
            "Select Minutes": "Seleccionar Minutos",
            "Set": "Establecer",
            "Cancel": "Cancelar",
            "CLOSE": "CERRAR",
            "Close": "Cerrar",
            "REJECT": "RECHAZAR",
            "ACCEPT": "ACEPTAR",
            "READY": "LISTO",
            "MARK AS DELIVERED": "MARCAR ENTREGADO",
            "CANCELLED": "CANCELÓ",
            "ATTENDED": "ASISTIÓ",
            "PRINT TICKET": "IMPRIMIR TICKET",
            "Order Items": "Artículos del Pedido",
            "Pre-ordered Food & Drinks": "Comida y Bebidas Pre-ordenadas",
            "Special Requests / Comments:": "Solicitudes Especiales / Comentarios:",
            "Customer Notes:": "Notas del Cliente:",
            "Total": "Total",
            "Guests": "Huéspedes",
            "Date": "Fecha",
            "Time Slot": "Horario",
            "Phone": "Teléfono",
            "Email": "Correo",
            "Type": "Tipo",
            "Payment": "Pago",
            "Reference": "Referencia",
            "Language": "Idioma",
            "Terms & Conditions": "Términos y Condiciones",
            "Sign Out": "Cerrar Sesión",
            "Welcome to your dashboard": "Bienvenido a tu panel",
            "Search": "Buscar",
            "Filter": "Filtrar",
            "Delete": "Eliminar",
            "Edit": "Editar",
            "Add": "Agregar",
            "Create": "Crear",
            "Update": "Actualizar",
            "Back": "Volver"
        }
    };

    function getLanguage() {
        return localStorage.getItem('menutech_restaurant_language') || 'en';
    }

    function translateText(text, lang) {
        if (!text || typeof text !== 'string') return text;
        const trimmed = text.trim();
        if (lang === 'es' && DICTIONARY.es[trimmed]) {
            return text.replace(trimmed, DICTIONARY.es[trimmed]);
        }
        return text;
    }

    function translateElement(node, lang) {
        if (lang !== 'es') return;

        if (node.nodeType === Node.TEXT_NODE) {
            const val = node.nodeValue;
            if (val && val.trim().length > 0) {
                const translated = translateText(val, lang);
                if (translated !== val) {
                    node.nodeValue = translated;
                }
            }
            return;
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            if (tagName === 'script' || tagName === 'style' || tagName === 'textarea' || tagName === 'code') {
                return;
            }

            if (node.placeholder) {
                const transPh = translateText(node.placeholder, lang);
                if (transPh !== node.placeholder) {
                    node.placeholder = transPh;
                }
            }

            if (node.title) {
                const transTitle = translateText(node.title, lang);
                if (transTitle !== node.title) {
                    node.title = transTitle;
                }
            }

            for (let child of node.childNodes) {
                translateElement(child, lang);
            }
        }
    }

    function translatePage() {
        const lang = getLanguage();
        if (lang === 'es') {
            document.documentElement.lang = 'es';
            translateElement(document.body || document.documentElement, 'es');
        }
    }

    window.MenutechI18n = {
        getLanguage: getLanguage,
        setLanguage: function (lang) {
            localStorage.setItem('menutech_restaurant_language', lang);
            translatePage();
        },
        translatePage: translatePage
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', translatePage);
    } else {
        translatePage();
    }
})();
