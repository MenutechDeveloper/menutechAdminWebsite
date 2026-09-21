/**
 * Menutech AI Chatbot Widget (menutechbot.gltf & Gemini Edge Function)
 * Features:
 * - <model-viewer> 3D Floating Widget & Chat Header rendering strictly 'assets/menutechbot.gltf'
 * - Professional responsive chat interface (glassmorphism UI, light/dark mode compatible)
 * - Text-To-Speech (Bot Voice) with toggle button
 * - Speech-To-Text (Voice Input / Microphone) via Web Speech API
 * - Image Upload & Drag-and-Drop multimodal attachments
 * - Supabase Edge Function integration with Session Context & CRUD dispatch
 */

(function () {
    if (window.MenutechChatbotLoaded) return;
    window.MenutechChatbotLoaded = true;

    // --- CONFIGURATION ---
    const CONFIG = {
        EDGE_FUNCTION_URL: "https://eemqyrysdgasfjlitads.supabase.co/functions/v1/gemini-chat",
        SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlbXF5cnlzZGdhc2ZqbGl0YWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MjA0NDUsImV4cCI6MjA4OTI5NjQ0NX0.UiyZLqhXSQ1Z_FoL006PDrDYKXbr_pxCOugYTulhdPY",
        MODEL_URL: "assets/menutechbot.gltf"
    };

    // Dynamically inject FontAwesome if missing
    if (!document.querySelector('link[href*="font-awesome"]')) {
        const fa = document.createElement('link');
        fa.rel = 'stylesheet';
        fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
        document.head.appendChild(fa);
    }

    // Dynamically inject Google model-viewer library if missing
    if (!document.querySelector('script[src*="model-viewer"]')) {
        const mvScript = document.createElement('script');
        mvScript.type = 'module';
        mvScript.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js';
        document.head.appendChild(mvScript);
    }

    // --- INJECT CSS STYLES ---
    const style = document.createElement('style');
    style.id = 'menutech-chatbot-styles';
    style.textContent = `
        /* Chatbot Container Root - Extreme Z-Index to guarantee rendering on top of all GLTF/canvas layers */
        #mt-bot-root {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 2147483647 !important;
            font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
            pointer-events: none;
        }
        #mt-bot-root * {
            box-sizing: border-box;
            pointer-events: auto;
        }

        /* 3D Trigger Widget - Completely transparent container */
        #mt-bot-trigger {
            width: 170px;
            height: 170px;
            border-radius: 50%;
            background: transparent !important;
            box-shadow: none !important;
            cursor: pointer;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            user-select: none;
            z-index: 10 !important;
        }
        #mt-bot-trigger:hover {
            transform: scale(1.08) translateY(-4px);
        }
        .mt-trigger-mv {
            width: 170px;
            height: 170px;
            border-radius: 50%;
            pointer-events: auto;
            --poster-color: transparent;
            background-color: transparent !important;
        }

        /* Floating Chat Window - Rendered strictly on top of trigger when active */
        #mt-bot-window {
            position: absolute;
            bottom: 20px;
            right: 0;
            width: 380px;
            max-width: calc(100vw - 32px);
            height: 580px;
            max-height: calc(100vh - 120px);
            background: rgba(255, 255, 255, 0.98);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 28px;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 149, 51, 0.25);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            opacity: 0;
            transform: translateY(20px) scale(0.95);
            pointer-events: none !important;
            transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 200 !important;
        }
        #mt-bot-window * {
            pointer-events: none;
        }
        #mt-bot-window.active * {
            pointer-events: auto;
        }
        body.dark-mode #mt-bot-window {
            background: rgba(28, 31, 38, 0.98);
            border-color: rgba(255, 255, 255, 0.1);
            color: #f8fafc;
        }
        #mt-bot-window.active {
            opacity: 1;
            transform: translateY(0) scale(1);
            pointer-events: auto;
        }

        /* Header */
        .mt-bot-header {
            padding: 16px 20px;
            background: linear-gradient(135deg, #ff9533 0%, #f97316 100%);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 4px 15px rgba(249, 115, 22, 0.2);
            position: relative;
            z-index: 10;
        }
        .mt-bot-banner {
            height: 120px;
            background: linear-gradient(180deg, #fff7ed 0%, #ffedd5 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            z-index: 1;
            overflow: hidden;
            border-bottom: none;
            flex-shrink: 0;
        }
        body.dark-mode .mt-bot-banner {
            background: linear-gradient(180deg, #242832 0%, #181b22 100%);
            border-color: transparent;
        }
        .mt-window-mv {
            width: 120px;
            height: 120px;
            background-color: transparent !important;
            --poster-color: transparent;
        }
        .mt-bot-profile {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .mt-bot-avatar {
            width: 42px;
            height: 42px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
            border: 1.5px solid rgba(255, 255, 255, 0.4);
        }
        .mt-bot-title {
            font-weight: 800;
            font-size: 1.05rem;
            line-height: 1.2;
            letter-spacing: 0.2px;
        }
        .mt-bot-sub {
            font-size: 0.72rem;
            opacity: 0.9;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .mt-bot-sub-dot {
            width: 7px;
            height: 7px;
            background: #34d399;
            border-radius: 50%;
        }
        .mt-bot-controls {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .mt-bot-btn-icon {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            color: #ffffff;
            width: 34px;
            height: 34px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.9rem;
            transition: background 0.2s, transform 0.2s;
        }
        .mt-bot-btn-icon:hover {
            background: rgba(255, 255, 255, 0.35);
            transform: scale(1.08);
        }
        .mt-bot-btn-icon.active {
            background: #ffffff;
            color: #f97316;
        }

        /* Messages Body */
        .mt-bot-messages {
            flex: 1;
            padding: 18px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 14px;
            scroll-behavior: smooth;
            position: relative;
            z-index: 5;
        }
        .mt-bot-messages::-webkit-scrollbar {
            width: 5px;
        }
        .mt-bot-messages::-webkit-scrollbar-thumb {
            background: rgba(255, 149, 51, 0.3);
            border-radius: 10px;
        }

        /* Message Bubbles */
        .mt-msg {
            display: flex;
            flex-direction: column;
            max-width: 82%;
            animation: mtMsgIn 0.3s ease-out;
        }
        @keyframes mtMsgIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .mt-msg.user {
            align-self: flex-end;
            align-items: flex-end;
        }
        .mt-msg.bot {
            align-self: flex-start;
            align-items: flex-start;
        }
        .mt-msg-bubble {
            padding: 12px 16px;
            border-radius: 20px;
            font-size: 0.9rem;
            line-height: 1.5;
            word-break: break-word;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        .mt-msg.user .mt-msg-bubble {
            background: #ff9533;
            color: #ffffff;
            border-bottom-right-radius: 4px;
        }
        .mt-msg.bot .mt-msg-bubble {
            background: #f1f5f9;
            color: #1e293b;
            border-bottom-left-radius: 4px;
        }
        body.dark-mode .mt-msg.bot .mt-msg-bubble {
            background: #2a2e39;
            color: #f1f5f9;
        }
        .mt-msg-img {
            max-width: 200px;
            max-height: 180px;
            border-radius: 14px;
            margin-bottom: 6px;
            object-fit: cover;
            border: 2px solid rgba(255, 149, 51, 0.3);
        }
        .mt-msg-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            margin-top: 4px;
            padding: 0 4px;
            gap: 8px;
        }
        .mt-msg-time {
            font-size: 0.65rem;
            color: #94a3b8;
        }
        .mt-msg-copy-btn {
            background: none;
            border: none;
            color: #94a3b8;
            cursor: pointer;
            font-size: 0.75rem;
            padding: 2px 4px;
            border-radius: 4px;
            transition: color 0.2s, background 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .mt-msg-copy-btn:hover {
            color: #ff9533;
            background: rgba(255, 149, 51, 0.1);
        }

        /* Loading Indicator */
        .mt-typing {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 12px 18px;
            background: #f1f5f9;
            border-radius: 20px;
            border-bottom-left-radius: 4px;
            width: fit-content;
        }
        body.dark-mode .mt-typing {
            background: #2a2e39;
        }
        .mt-typing-dot {
            width: 7px;
            height: 7px;
            background: #ff9533;
            border-radius: 50%;
            animation: mtTyping 1.4s infinite ease-in-out;
        }
        .mt-typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .mt-typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes mtTyping {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-6px); }
        }

        /* Drag & Drop Overlay Zone */
        .mt-drop-zone {
            position: absolute;
            inset: 0;
            background: rgba(255, 149, 51, 0.95);
            color: #ffffff;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            z-index: 100;
            border: 3px dashed #ffffff;
            border-radius: 20px;
            margin: 12px;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
            box-shadow: 0 10px 30px rgba(249, 115, 22, 0.4);
        }
        .mt-drop-zone.active {
            opacity: 1;
            pointer-events: auto;
        }
        .mt-drop-zone i {
            font-size: 3rem;
            animation: mtBounce 1s infinite alternate;
        }
        @keyframes mtBounce {
            from { transform: translateY(0); }
            to { transform: translateY(-8px); }
        }

        .hidden {
            display: none !important;
        }

        /* Attachment Preview Bar */
        .mt-attach-preview {
            padding: 8px 16px;
            background: #f8fafc;
            border-top: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: relative;
            z-index: 15;
        }
        body.dark-mode .mt-attach-preview {
            background: #181b20;
            border-color: #2d333f;
        }
        .mt-attach-item {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .mt-attach-thumb {
            width: 36px;
            height: 36px;
            border-radius: 8px;
            object-fit: cover;
        }
        .mt-attach-name {
            font-size: 0.78rem;
            font-weight: 600;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .mt-attach-remove {
            background: none;
            border: none;
            color: #ef4444;
            cursor: pointer;
            font-size: 0.9rem;
        }

        /* Footer / Input Area - High Z-Index to guarantee write bar is always above canvas/GLTF models */
        .mt-bot-footer {
            padding: 12px 16px;
            background: #ffffff;
            border-top: 1px solid #f1f5f9;
            display: flex;
            align-items: center;
            gap: 8px;
            position: relative;
            z-index: 20;
        }
        body.dark-mode .mt-bot-footer {
            background: #1c1f26;
            border-color: #2d333f;
        }
        .mt-bot-input {
            flex: 1;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 20px;
            padding: 10px 16px;
            font-size: 0.9rem;
            color: #1e293b;
            outline: none;
            transition: border-color 0.2s;
        }
        body.dark-mode .mt-bot-input {
            background: #242933;
            border-color: #3b4252;
            color: #f8fafc;
        }
        .mt-bot-input:focus {
            border-color: #ff9533;
        }
        .mt-bot-btn-action {
            width: 38px;
            height: 38px;
            border-radius: 50%;
            border: none;
            background: #f1f5f9;
            color: #64748b;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 1rem;
            transition: all 0.2s ease;
            flex-shrink: 0;
        }
        body.dark-mode .mt-bot-btn-action {
            background: #2a2e39;
            color: #94a3b8;
        }
        .mt-bot-btn-action:hover {
            background: #ff9533;
            color: #ffffff;
        }
        .mt-bot-btn-action.listening {
            background: #ef4444 !important;
            color: #ffffff !important;
            animation: mtPulseMic 1s infinite;
        }
        @keyframes mtPulseMic {
            0% { transform: scale(1); }
            50% { transform: scale(1.15); }
            100% { transform: scale(1); }
        }
        .mt-bot-btn-send {
            background: #ff9533;
            color: #ffffff;
        }
        .mt-bot-btn-send:hover {
            background: #f97316;
            transform: scale(1.05);
        }

        /* Admin Thought Bubble above trigger */
        #mt-admin-thought-bubble {
            position: absolute;
            bottom: 175px;
            right: 15px;
            width: 230px;
            background: linear-gradient(135deg, #ff9533 0%, #f97316 100%);
            color: #ffffff;
            padding: 14px 16px;
            border-radius: 20px;
            box-shadow: 0 12px 30px rgba(249, 115, 22, 0.4);
            cursor: pointer;
            z-index: 15;
            transition: opacity 0.4s ease, transform 0.4s ease;
            pointer-events: auto;
            text-align: center;
            animation: mtFloatBubble 3s ease-in-out infinite;
        }
        #mt-admin-thought-bubble.hidden {
            opacity: 0;
            transform: translateY(10px) scale(0.9);
            pointer-events: none !important;
        }
        #mt-admin-thought-bubble:hover {
            transform: translateY(-4px) scale(1.03);
            box-shadow: 0 16px 35px rgba(249, 115, 22, 0.5);
        }
        .mt-bubble-text {
            font-size: 0.82rem;
            font-weight: 700;
            line-height: 1.35;
        }
        .mt-bubble-link {
            display: inline-block;
            margin-top: 6px;
            font-size: 0.75rem;
            font-weight: 800;
            background: rgba(255, 255, 255, 0.25);
            padding: 4px 10px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.4);
            transition: background 0.2s;
        }
        #mt-admin-thought-bubble:hover .mt-bubble-link {
            background: rgba(255, 255, 255, 0.4);
        }
        .mt-bubble-dots {
            position: absolute;
            bottom: -16px;
            right: 35px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
        }
        .mt-bubble-dot {
            background: #f97316;
            border-radius: 50%;
            box-shadow: 0 4px 8px rgba(249, 115, 22, 0.3);
        }
        .mt-bubble-dot.dot-1 { width: 10px; height: 10px; }
        .mt-bubble-dot.dot-2 { width: 7px; height: 7px; opacity: 0.8; }
        .mt-bubble-dot.dot-3 { width: 4px; height: 4px; opacity: 0.6; }

        @keyframes mtFloatBubble {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-6px); }
        }

        /* Mobile Responsive */
        @media (max-width: 480px) {
            #mt-bot-window {
                right: -10px;
                bottom: 80px;
                width: calc(100vw - 28px);
                height: calc(100vh - 110px);
                border-radius: 22px;
            }
        }
    `;
    document.head.appendChild(style);

    // --- HTML DOM CREATION ---
    const botRoot = document.createElement('div');
    botRoot.id = 'mt-bot-root';
    botRoot.innerHTML = `
        <div id="mt-admin-thought-bubble" class="hidden" title="Ir a Aprender IA">
            <div class="mt-bubble-text" id="mt-bubble-msg">
                Hola, ¿hay algo que deba aprender hoy?
            </div>
            <div class="mt-bubble-link">
                Haz click aqui
            </div>
            <div class="mt-bubble-dots">
                <div class="mt-bubble-dot dot-1"></div>
                <div class="mt-bubble-dot dot-2"></div>
                <div class="mt-bubble-dot dot-3"></div>
            </div>
        </div>

        <div id="mt-bot-window">
            <div class="mt-bot-header">
                <div class="mt-bot-profile">
                    <div class="mt-bot-avatar">
                        <i class="fa-solid fa-sparkles"></i>
                    </div>
                    <div>
                        <div class="mt-bot-title">Menutech AI</div>
                        <div class="mt-bot-sub">
                            <span class="mt-bot-sub-dot"></span> En línea
                        </div>
                    </div>
                </div>
                <div class="mt-bot-controls">
                    <button class="mt-bot-btn-icon" id="mt-tts-toggle" title="Voice Output (Speech)">
                        <i class="fa-solid fa-volume-high"></i>
                    </button>
                    <button class="mt-bot-btn-icon" id="mt-bot-close" title="Close">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <div class="mt-bot-banner">
                <model-viewer
                    class="mt-window-mv"
                    src="${CONFIG.MODEL_URL}"
                    alt="Menutech 3D Bot"
                    auto-rotate
                    camera-controls
                    disable-zoom
                    disable-pan
                    shadow-intensity="1"
                    interaction-prompt="none">
                </model-viewer>
            </div>

            <div class="mt-bot-messages" id="mt-bot-messages">
                <div class="mt-drop-zone" id="mt-drop-zone">
                    <i class="fa-solid fa-cloud-arrow-up"></i>
                    <span style="font-weight:700; font-size:1.1rem;">Suelta tu imagen aquí</span>
                </div>
            </div>

            <div class="mt-attach-preview hidden" id="mt-attach-preview">
                <div class="mt-attach-item">
                    <img class="mt-attach-thumb" id="mt-attach-img" src="" alt="preview">
                    <span class="mt-attach-name" id="mt-attach-name">image.png</span>
                </div>
                <button class="mt-attach-remove" id="mt-attach-remove"><i class="fa-solid fa-trash"></i></button>
            </div>

            <div class="mt-bot-footer">
                <input type="file" id="mt-file-input" accept="image/*" style="display:none;">
                <button class="mt-bot-btn-action" id="mt-btn-attach" title="Attach Image">
                    <i class="fa-solid fa-paperclip"></i>
                </button>
                <button class="mt-bot-btn-action" id="mt-btn-mic" title="Voice Input (Speech to Text)">
                    <i class="fa-solid fa-microphone"></i>
                </button>
                <input type="text" class="mt-bot-input" id="mt-bot-input" placeholder="Escribe un mensaje o habla..." autocomplete="off">
                <button class="mt-bot-btn-action mt-bot-btn-send" id="mt-btn-send" title="Send">
                    <i class="fa-solid fa-paper-plane"></i>
                </button>
            </div>
        </div>

        <div id="mt-bot-trigger" title="Menutech AI Assistant">
            <model-viewer
                class="mt-trigger-mv"
                src="${CONFIG.MODEL_URL}"
                alt="Menutech 3D Bot"
                auto-rotate
                camera-controls
                disable-zoom
                disable-pan
                shadow-intensity="0"
                interaction-prompt="none">
            </model-viewer>
        </div>
    `;
    document.body.appendChild(botRoot);

    // --- STATE VARIABLES ---
    let chatHistory = [];
    let currentImage = null; // { mimeType, data }
    let isTtsEnabled = true;
    let recognition = null;
    let isListening = false;
    let activeClientTarget = null; // { targetId, accountName, domain }

    async function processClientSideIntent(text, session) {
        if (!window.supabase) return null;
        const lower = text.toLowerCase().trim();
        const sb = window.supabase;
        const nonOwnerRoles = ['admin', 'developer', 'cs', 'admincs', 'admindesign', 'design', 'retention'];
        const userRole = (session?.role || 'owner').toLowerCase();
        const isOwner = !nonOwnerRoles.includes(userRole) && userRole !== 'admin';

        async function resolveTarget(term) {
            if (isOwner) {
                if (!session?.id) return null;
                return { targetId: session.id, accountName: session.username || 'tu cuenta', domain: session.domain || '' };
            }
            if (term) {
                const { data: profiles } = await sb.from('profiles').select('id, username, domain, email');
                if (profiles && profiles.length > 0) {
                    const cleanTerm = term.toLowerCase().replace(/^(la|el|los|las)\s+/i, '').trim();
                    const match = profiles.find(p =>
                        (p.username || '').toLowerCase().includes(cleanTerm) ||
                        cleanTerm.includes((p.username || '').toLowerCase()) ||
                        (p.domain || '').toLowerCase().includes(cleanTerm) ||
                        cleanTerm.includes((p.domain || '').toLowerCase())
                    );
                    if (match) {
                        return { targetId: match.id, accountName: match.username || match.domain || match.email, domain: match.domain || '' };
                    }
                }
            }
            if (activeClientTarget) return activeClientTarget;
            if (session?.id) return { targetId: session.id, accountName: session.username || 'tu cuenta', domain: session.domain || '' };
            return null;
        }

        async function getOrCreateMenu(targetId, domain) {
            const { data: existing } = await sb.from('menutech_menus').select('*').eq('user_id', targetId).maybeSingle();
            if (existing) return existing;

            const { data: prof } = await sb.from('profiles').select('domain, username').eq('id', targetId).maybeSingle();
            const d = prof?.domain || domain || 'undetermined';
            const slug = (prof?.domain || prof?.username || 'restaurant').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

            const newMenu = {
                user_id: targetId,
                domain: d,
                slug: slug,
                menu_style: 'mode2',
                cover_url: '',
                cover_type: 'image',
                config: { categories: [], toppings: [] }
            };
            const { data: inserted } = await sb.from('menutech_menus').insert(newMenu).select().single();
            return inserted || newMenu;
        }

        // Search Account command
        if (!isOwner && (lower.includes("cuenta de") || lower.includes("buscar cuenta") || lower.includes("ve a la cuenta"))) {
            const term = text.replace(/.*(cuenta de|buscar cuenta|ve a la cuenta)\s*/i, "").split(/[\n,]/)[0].trim();
            const resolved = await resolveTarget(term);
            if (resolved) {
                activeClientTarget = resolved;
                const menu = await getOrCreateMenu(resolved.targetId, resolved.domain);
                const catCount = menu.config?.categories?.length || 0;
                return {
                    reply: `He seleccionado la cuenta de **${resolved.accountName}**. Tiene ${catCount} categoría(s) activa(s). ¿Qué deseas agregar o modificar?`,
                    targetUserId: resolved.targetId,
                    menuUpdated: true
                };
            }
        }

        // Add Category and/or Dishes command
        if (lower.includes("categoria") || lower.includes("categoría") || lower.includes("platillo") || lower.includes("platillos") || lower.includes("agrega") || lower.includes("crea")) {
            let accTerm = "";
            const accMatch = text.match(/(?:cuenta de|en la cuenta de)\s+([a-zA-Z0-9\s-]+)/i);
            if (accMatch) accTerm = accMatch[1].trim();

            const resolved = await resolveTarget(accTerm);
            if (resolved) {
                activeClientTarget = resolved;
                const menu = await getOrCreateMenu(resolved.targetId, resolved.domain);
                const config = menu.config || { categories: [], toppings: [] };
                if (!config.categories) config.categories = [];

                let actionsDone = [];

                let catName = "";
                const catMatch = text.match(/(?:categoria|categoría)\s+(?:llamada\s+)?["']?([^"'\n\.$,]+)["']?/i);
                if (catMatch && catMatch[1]) {
                    catName = catMatch[1].trim();
                    const exists = config.categories.some(c => c.name.toLowerCase() === catName.toLowerCase());
                    if (!exists) {
                        config.categories.push({
                            name: catName,
                            description: '',
                            image: '',
                            visibility: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', startDate: '', endDate: '' },
                            dishes: []
                        });
                        actionsDone.push(`categoría **"${catName}"**`);
                    }
                }

                const numMatch = text.match(/(\d+)\s+platillos/i);
                let countToCreate = numMatch ? parseInt(numMatch[1]) : 0;

                let targetCat = catName
                    ? config.categories.find(c => c.name.toLowerCase() === catName.toLowerCase())
                    : config.categories[config.categories.length - 1];

                if (!targetCat && countToCreate > 0) {
                    targetCat = { name: 'General', description: '', image: '', visibility: { days: [0,1,2,3,4,5,6], start: '00:00', end: '23:59', startDate:'', endDate:'' }, dishes: [] };
                    config.categories.push(targetCat);
                }

                if (targetCat) {
                    if (!targetCat.dishes) targetCat.dishes = [];
                    if (countToCreate > 0) {
                        const baseDishes = [
                            { name: "Platillo Especial 1", price: 120, description: "Deliciosa opción recomendada" },
                            { name: "Platillo Especial 2", price: 150, description: "Opción gourmet preparada al momento" },
                            { name: "Platillo Especial 3", price: 180, description: "Especialidad de la casa" },
                            { name: "Platillo Especial 4", price: 210, description: "Selección del chef" }
                        ];
                        for (let i = 0; i < countToCreate; i++) {
                            const d = baseDishes[i % baseDishes.length];
                            targetCat.dishes.push({
                                name: d.name,
                                description: d.description,
                                price: d.price,
                                image: '',
                                sizes: [],
                                toppings: []
                            });
                        }
                        actionsDone.push(`${countToCreate} platillos en **"${targetCat.name}"**`);
                    }
                }

                if (actionsDone.length > 0) {
                    await sb.from('menutech_menus').upsert({
                        user_id: resolved.targetId,
                        domain: menu.domain || 'undetermined',
                        slug: menu.slug || 'restaurant',
                        menu_style: menu.menu_style || 'mode2',
                        cover_url: menu.cover_url || '',
                        cover_type: menu.cover_type || 'image',
                        config: config
                    }, { onConflict: 'user_id' });

                    return {
                        reply: `¡Listo! He agregado ${actionsDone.join(" y ")} en la cuenta de **${resolved.accountName}**.`,
                        targetUserId: resolved.targetId,
                        menuUpdated: true
                    };
                }
            }
        }

        return null;
    }

    // --- DOM ELEMENTS ---
    const triggerBtn = document.getElementById('mt-bot-trigger');
    const windowEl = document.getElementById('mt-bot-window');
    const closeBtn = document.getElementById('mt-bot-close');
    const ttsToggleBtn = document.getElementById('mt-tts-toggle');
    const messagesContainer = document.getElementById('mt-bot-messages');
    const inputEl = document.getElementById('mt-bot-input');
    const sendBtn = document.getElementById('mt-btn-send');
    const attachBtn = document.getElementById('mt-btn-attach');
    const fileInput = document.getElementById('mt-file-input');
    const micBtn = document.getElementById('mt-btn-mic');
    const attachPreview = document.getElementById('mt-attach-preview');
    const attachImg = document.getElementById('mt-attach-img');
    const attachName = document.getElementById('mt-attach-name');
    const attachRemove = document.getElementById('mt-attach-remove');
    const dropZone = document.getElementById('mt-drop-zone');

    // --- SESSION CONTEXT EXTRACTOR ---
    async function getUserSession() {
        try {
            let userId = null;
            let email = null;
            let metaRole = null;
            let username = null;
            let domain = null;

            if (window.supabase && window.supabase.auth) {
                const { data: { session } } = await window.supabase.auth.getSession();
                if (session && session.user) {
                    userId = session.user.id;
                    email = session.user.email;
                }
            }

            if (!userId) {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.includes('supabase.auth.token') || (key.startsWith('sb-') && key.endsWith('-auth-token')))) {
                        const item = localStorage.getItem(key);
                        if (item) {
                            const parsed = JSON.parse(item);
                            const user = parsed?.user || parsed?.currentSession?.user;
                            if (user) {
                                userId = user.id;
                                email = user.email;
                                metaRole = user.user_metadata?.role;
                                username = user.user_metadata?.username;
                                domain = user.user_metadata?.domain;
                            }
                        }
                    }
                }
            }

            if (!userId) return null;

            // Fetch actual user profile directly from Supabase 'profiles' table via REST API
            let dbProfile = null;
            try {
                const res = await fetch(`https://eemqyrysdgasfjlitads.supabase.co/rest/v1/profiles?id=eq.${userId}&select=*`, {
                    headers: {
                        "apikey": CONFIG.SUPABASE_ANON_KEY,
                        "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
                    }
                });
                if (res.ok) {
                    const profiles = await res.json();
                    if (profiles && profiles.length > 0) {
                        dbProfile = profiles[0];
                    }
                }
            } catch (e) {
                console.warn("Error fetching profile via REST:", e);
            }

            if (!dbProfile && window.supabase) {
                try {
                    const { data } = await window.supabase.from('profiles').select('*').eq('id', userId).single();
                    dbProfile = data;
                } catch (e) {}
            }

            const resolvedRole = (dbProfile?.role || metaRole || 'owner').trim();
            const resolvedUsername = dbProfile?.username || username || (email ? email.split('@')[0] : 'usuario');
            const resolvedDomain = dbProfile?.domain || domain || '';

            return {
                id: userId,
                email: email,
                role: resolvedRole,
                username: resolvedUsername,
                domain: resolvedDomain
            };
        } catch (err) {
            console.warn("Error resolving user session context:", err);
        }
        return null;
    }

    // --- VOICE RECOGNITION (Speech To Text) ---
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            micBtn.style.display = 'none';
            return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'es-ES';
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onstart = () => {
            isListening = true;
            micBtn.classList.add('listening');
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            inputEl.value = transcript;
            stopListening();
            sendMessage();
        };

        recognition.onerror = () => {
            stopListening();
        };

        recognition.onend = () => {
            stopListening();
        };

        micBtn.onclick = () => {
            if (isListening) {
                stopListening();
            } else {
                startListening();
            }
        };
    }

    function startListening() {
        if (recognition && !isListening) {
            try {
                recognition.start();
            } catch (e) {}
        }
    }

    function stopListening() {
        if (recognition && isListening) {
            isListening = false;
            micBtn.classList.remove('listening');
            try {
                recognition.stop();
            } catch (e) {}
        }
    }

    // --- TEXT TO SPEECH (Bot Voice Output) ---
    function speakText(text) {
        if (!isTtsEnabled || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();

        const cleanText = text.replace(/[*#_`]/g, '');
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'es-ES';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        window.speechSynthesis.speak(utterance);
    }

    // --- CHAT LOGIC & SEND MESSAGE ---
    async function sendMessage() {
        const text = inputEl.value.trim();
        if (!text && !currentImage) return;

        appendUserMessage(text, currentImage ? currentImage.data : null);

        const payloadPrompt = text;
        const payloadImage = currentImage ? { ...currentImage } : null;

        inputEl.value = '';
        clearImageAttachment();

        const typingEl = appendTypingIndicator();
        const session = await getUserSession();

        try {
            // Process direct client-side execution when available
            const clientIntentResult = await processClientSideIntent(payloadPrompt, session);
            if (clientIntentResult) {
                removeTypingIndicator(typingEl);
                const reply = clientIntentResult.reply;
                chatHistory.push({ role: "user", text: payloadPrompt });
                chatHistory.push({ role: "model", text: reply });
                if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);

                appendBotMessage(reply);
                speakText(reply);

                window.dispatchEvent(new CustomEvent('menutech-menu-updated', { detail: clientIntentResult }));
                return;
            }

            const res = await fetch(CONFIG.EDGE_FUNCTION_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "apikey": CONFIG.SUPABASE_ANON_KEY,
                    "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({
                    prompt: payloadPrompt,
                    message: payloadPrompt,
                    history: chatHistory,
                    image: payloadImage,
                    userSession: session
                })
            });

            removeTypingIndicator(typingEl);

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const errorMsg = data.error || data.message || `HTTP ${res.status}`;
                appendBotMessage(`Error de la Edge Function (${errorMsg}). Revisa los logs de Supabase.`);
                return;
            }

            let reply = data.reply || data.message || "Sin respuesta del servidor.";

            // Clean reply client-side as safety fallback
            reply = sanitizeReply(reply);

            chatHistory.push({ role: "user", text: payloadPrompt });
            chatHistory.push({ role: "model", text: reply });
            if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);

            appendBotMessage(reply);
            speakText(reply);

            // Dispatch global event if menu was modified
            if (data.menuUpdated || data.actionPerformed) {
                window.dispatchEvent(new CustomEvent('menutech-menu-updated', { detail: data }));
            }

        } catch (err) {
            removeTypingIndicator(typingEl);
            appendBotMessage("Error de red al conectar con Supabase: " + err.message);
        }
    }

    // --- UI HELPERS ---
    function appendUserMessage(text, imgSrc) {
        const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const msgDiv = document.createElement('div');
        msgDiv.className = 'mt-msg user';

        let imgHtml = imgSrc ? `<img src="${imgSrc}" class="mt-msg-img" alt="sent image">` : '';
        let textHtml = text ? `<div class="mt-msg-bubble">${escapeHtml(text)}</div>` : '';

        msgDiv.innerHTML = `
            ${imgHtml}
            ${textHtml}
            <div class="mt-msg-time">${time}</div>
        `;
        messagesContainer.appendChild(msgDiv);
        scrollToBottom();
    }

    function appendBotMessage(text) {
        const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const msgDiv = document.createElement('div');
        msgDiv.className = 'mt-msg bot';

        let formatted = escapeHtml(text)
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\n/g, '<br>');

        msgDiv.innerHTML = `
            <div class="mt-msg-bubble">${formatted}</div>
            <div class="mt-msg-footer">
                <span class="mt-msg-time">${time}</span>
                <button class="mt-msg-copy-btn" title="Copiar mensaje">
                    <i class="fa-regular fa-copy"></i>
                </button>
            </div>
        `;

        const copyBtn = msgDiv.querySelector('.mt-msg-copy-btn');
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span style="font-size:0.65rem;">¡Copiado!</span>';
                    setTimeout(() => {
                        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
                    }, 2000);
                }).catch(() => {
                    // Fallback using execCommand if clipboard API fails
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span style="font-size:0.65rem;">¡Copiado!</span>';
                    setTimeout(() => {
                        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
                    }, 2000);
                });
            };
        }

        messagesContainer.appendChild(msgDiv);
        scrollToBottom();
    }

    function appendTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'mt-typing';
        typingDiv.innerHTML = `
            <div class="mt-typing-dot"></div>
            <div class="mt-typing-dot"></div>
            <div class="mt-typing-dot"></div>
        `;
        messagesContainer.appendChild(typingDiv);
        scrollToBottom();
        return typingDiv;
    }

    function removeTypingIndicator(el) {
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function sanitizeReply(text) {
        if (!text) return "";
        let cleaned = text;

        // Remove bullet checklist reasoning
        cleaned = cleaned.replace(/^\s*\*.*?\?.*$/gm, "");
        cleaned = cleaned.replace(/^\s*\*.*?\b(Yes|No|Si|No)\b.*$/gm, "");

        const lines = cleaned.split("\n").map(l => l.trim()).filter(l => {
            if (!l) return false;
            if (l.startsWith("*") && (l.includes("?") || l.includes("Yes") || l.includes("No"))) return false;
            if (l.toLowerCase().includes("the user said") || l.toLowerCase().includes("plan:")) return false;
            return true;
        });

        if (lines.length > 0) {
            cleaned = lines.join(" ");
        }

        const doubleQuoteMatches = cleaned.match(/"([^"]+)"/g);
        if (doubleQuoteMatches && doubleQuoteMatches.length > 0) {
            const extracted = doubleQuoteMatches.map(m => m.replace(/^"|"$/g, "").trim());
            cleaned = extracted[extracted.length - 1] || cleaned;
        } else {
            cleaned = cleaned.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();
        }

        const sentences = cleaned.split(/(?<=[.!?])\s+/);
        if (sentences.length >= 2 && sentences[0] === sentences[1]) {
            cleaned = sentences[0];
        }

        return cleaned.trim();
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // --- ATTACHMENT & DRAG & DROP HANDLING ---
    function handleFile(file) {
        if (!file || !file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64Data = e.target.result;
            currentImage = {
                mimeType: file.type,
                data: base64Data
            };
            attachImg.src = base64Data;
            attachName.textContent = file.name;
            attachPreview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }

    function clearImageAttachment() {
        currentImage = null;
        attachImg.src = '';
        attachName.textContent = '';
        attachPreview.classList.add('hidden');
        fileInput.value = '';
    }

    // --- ADMIN THOUGHT BUBBLE TRIGGER ---
    async function initAdminThoughtBubble() {
        const session = await getUserSession();
        if (!session) return;
        const role = (session.role || '').toUpperCase();
        if (role === 'ADMIN') {
            const adminName = session.username || session.email.split('@')[0];
            const bubbleEl = document.getElementById('mt-admin-thought-bubble');
            const msgEl = document.getElementById('mt-bubble-msg');
            const triggerEl = document.getElementById('mt-bot-trigger');

            if (msgEl) {
                msgEl.textContent = `Hola ${adminName}, ¿hay algo que deba aprender hoy?`;
            }
            if (bubbleEl) {
                bubbleEl.onclick = (e) => {
                    e.stopPropagation();
                    window.location.href = 'https://menutech.io/learn';
                };

                let hideTimer = null;

                function showBubble() {
                    if (windowEl.classList.contains('active')) return;
                    bubbleEl.classList.remove('hidden');
                    if (hideTimer) clearTimeout(hideTimer);
                    hideTimer = setTimeout(() => {
                        bubbleEl.classList.add('hidden');
                    }, 6000);
                }

                function hideBubble() {
                    if (hideTimer) clearTimeout(hideTimer);
                    bubbleEl.classList.add('hidden');
                }

                // Show on page load, auto-hide after 6s if ignored
                setTimeout(showBubble, 1000);

                // Show on hover over GLTF or bubble, hide on leave
                if (triggerEl) {
                    triggerEl.addEventListener('mouseenter', showBubble);
                    triggerEl.addEventListener('mouseleave', hideBubble);
                }
                bubbleEl.addEventListener('mouseenter', () => {
                    if (hideTimer) clearTimeout(hideTimer);
                    bubbleEl.classList.remove('hidden');
                });
                bubbleEl.addEventListener('mouseleave', hideBubble);
            }
        }
    }

    // --- EVENT LISTENERS ---
    let startX = 0, startY = 0, isDraggingGLTF = false;

    triggerBtn.addEventListener('pointerdown', (e) => {
        startX = e.clientX;
        startY = e.clientY;
        isDraggingGLTF = false;
    });

    triggerBtn.addEventListener('pointermove', (e) => {
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if (dx > 5 || dy > 5) {
            isDraggingGLTF = true;
        }
    });

    triggerBtn.addEventListener('click', (e) => {
        if (isDraggingGLTF) {
            e.stopPropagation();
            e.preventDefault();
            isDraggingGLTF = false;
            return;
        }
        windowEl.classList.toggle('active');
        if (windowEl.classList.contains('active')) {
            const bubbleEl = document.getElementById('mt-admin-thought-bubble');
            if (bubbleEl) bubbleEl.classList.add('hidden');
            inputEl.focus();
        }
    });

    closeBtn.onclick = () => {
        windowEl.classList.remove('active');
        window.speechSynthesis.cancel();
    };

    ttsToggleBtn.onclick = () => {
        isTtsEnabled = !isTtsEnabled;
        if (isTtsEnabled) {
            ttsToggleBtn.classList.remove('active');
            ttsToggleBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        } else {
            ttsToggleBtn.classList.add('active');
            ttsToggleBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
            window.speechSynthesis.cancel();
        }
    };

    sendBtn.onclick = sendMessage;

    inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
        }
    };

    attachBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
        if (e.target.files.length > 0) handleFile(e.target.files[0]);
    };
    attachRemove.onclick = clearImageAttachment;

    let dragCounter = 0;

    windowEl.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
            dragCounter++;
            dropZone.classList.add('active');
        }
    });

    windowEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
            dropZone.classList.add('active');
        }
    });

    windowEl.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dropZone.classList.remove('active');
        }
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.remove('active');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    initSpeechRecognition();
    initAdminThoughtBubble();

})();
