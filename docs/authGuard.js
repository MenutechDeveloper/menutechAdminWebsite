(function () {
    const pathname = window.location.pathname;
    const isIndex = pathname.endsWith('index.html') || pathname === '/' || pathname.endsWith('/');
    const isAppMode = window.location.search.includes('app=true');
    const hasHashToken = window.location.hash.includes('access_token=') || window.location.search.includes('access_token=');

    if (isAppMode || hasHashToken) {
        return;
    }

    let hasValidSession = false;
    let sessionUser = null;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('sb-') || key.includes('supabase')) && (key.endsWith('-auth-token') || key.includes('auth'))) {
                const val = localStorage.getItem(key);
                if (val) {
                    const parsed = JSON.parse(val);
                    const session = parsed.currentSession || parsed.session || parsed;
                    if (session && (session.access_token || parsed.access_token)) {
                        hasValidSession = true;
                        sessionUser = session.user || parsed.user || null;
                        break;
                    }
                }
            }
        }
    } catch (e) {
        console.error("AuthGuard storage check error:", e);
    }

    if (!isIndex && !hasValidSession) {
        window.location.replace('index.html');
        return;
    }

    window.revealPage = function () {
        const style = document.getElementById('auth-guard-style');
        if (style && style.parentNode) {
            style.parentNode.removeChild(style);
        }
    };

    window.checkAccountSuspension = function (profile) {
        if (!profile || !profile.is_suspended) return false;

        const role = (profile.role || 'OWNER').toUpperCase();
        const privilegedRoles = ['ADMIN', 'DEVELOPER', 'CS', 'ADMINCS'];
        if (privilegedRoles.includes(role)) return false;

        const overlay = document.createElement('div');
        overlay.id = 'suspension-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; z-index:999999; background:#121418; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:30px; text-align:center; font-family:sans-serif;';
        overlay.innerHTML = `
            <div style="max-width:500px; background:#1c1f26; border:1px solid #dc2626; padding:40px; border-radius:24px; box-shadow:0 20px 50px rgba(0,0,0,0.5);">
                <div style="font-size:3rem; margin-bottom:15px;">⚠️</div>
                <h2 style="font-size:1.8rem; margin-bottom:12px; color:#ef4444;">Cuenta Suspendida</h2>
                <p style="color:#94a3b8; font-size:0.95rem; line-height:1.6; margin-bottom:24px;">
                    El acceso a tu panel de administración ha sido suspendido temporalmente por falta de pago o mantenimiento de cuenta. Tus datos y configuración se encuentran conservados intactos.
                </p>
                <p style="color:#f8fafc; font-size:0.85rem; font-weight:600; margin-bottom:30px;">
                    Por favor comunícate con el soporte de Menutech para reactivar tu servicio.
                </p>
                <button onclick="localStorage.clear(); window.location.href='index.html';" style="background:#ff9533; color:#000; border:none; padding:14px 28px; border-radius:16px; font-weight:800; cursor:pointer; text-transform:uppercase; font-size:0.85rem;">
                    Cerrar Sesión
                </button>
            </div>
        `;
        document.body.appendChild(overlay);
        return true;
    };

    if (!isIndex) {
        const style = document.createElement('style');
        style.id = 'auth-guard-style';
        style.textContent = 'html { visibility: hidden !important; opacity: 0 !important; }';
        if (document.documentElement) {
            document.documentElement.appendChild(style);
        }

        window.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                if (window.revealPage) window.revealPage();
            }, 1200);
        });
    }
})();
