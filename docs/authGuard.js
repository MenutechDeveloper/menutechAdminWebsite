(function () {
    const pathname = window.location.pathname;
    const isIndex = pathname.endsWith('index.html') || pathname === '/' || pathname.endsWith('/');
    const isAppMode = window.location.search.includes('app=true');
    const hasHashToken = window.location.hash.includes('access_token=') || window.location.search.includes('access_token=');

    if (isAppMode || hasHashToken) {
        return;
    }

    let hasValidSession = false;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('sb-') || key.includes('supabase')) && (key.endsWith('-auth-token') || key.includes('auth'))) {
                const val = localStorage.getItem(key);
                if (val) {
                    const parsed = JSON.parse(val);
                    if (parsed && (parsed.access_token || parsed.currentSession || (parsed.session && parsed.session.access_token))) {
                        hasValidSession = true;
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
