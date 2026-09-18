/**
 * Menutech AI Chatbot Widget (menutechbot.gltf & Gemini Edge Function)
 * Features:
 * - <model-viewer> 3D Floating Widget & Chat Header rendering strictly 'assets/menutechbot.gltf'
 * - Professional responsive chat interface (glassmorphism UI, light/dark mode compatible)
 * - Text-To-Speech (Bot Voice) with toggle button
 * - Speech-To-Text (Voice Input / Microphone) via Web Speech API
 * - Image Upload & Drag-and-Drop multimodal attachments
 * - Supabase Edge Function integration
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
        /* Chatbot Container Root */
        #mt-bot-root {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 999999;
            font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
            pointer-events: none;
        }
        #mt-bot-root * {
            box-sizing: border-box;
            pointer-events: auto;
        }

        /* 3D Trigger Widget - Completely transparent container */
        #mt-bot-trigger {
            width: 85px;
            height: 85px;
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
        }
        #mt-bot-trigger:hover {
            transform: scale(1.08) translateY(-4px);
        }
        .mt-trigger-mv {
            width: 85px;
            height: 85px;
            border-radius: 50%;
            pointer-events: auto;
            --poster-color: transparent;
            background-color: transparent !important;
        }

        /* Floating Chat Window */
        #mt-bot-window {
            position: absolute;
            bottom: 96px;
            right: 0;
            width: 380px;
            max-width: calc(100vw - 32px);
            height: 580px;
            max-height: calc(100vh - 120px);
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 28px;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 149, 51, 0.15);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            opacity: 0;
            transform: translateY(20px) scale(0.95);
            pointer-events: none;
            transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        body.dark-mode #mt-bot-window {
            background: rgba(28, 31, 38, 0.95);
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
        }
        .mt-bot-banner {
            height: 120px;
            background: linear-gradient(180deg, #fff7ed 0%, #ffedd5 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            border-bottom: 1px solid rgba(255, 149, 51, 0.15);
            flex-shrink: 0;
        }
        body.dark-mode .mt-bot-banner {
            background: linear-gradient(180deg, #242832 0%, #181b22 100%);
            border-color: rgba(255, 255, 255, 0.05);
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
        .mt-msg-time {
            font-size: 0.65rem;
            color: #94a3b8;
            margin-top: 4px;
            padding: 0 4px;
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
            background: rgba(255, 149, 51, 0.92);
            color: #ffffff;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            z-index: 10;
            border: 3px dashed #ffffff;
            border-radius: 20px;
            margin: 12px;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }
        .mt-drop-zone.active {
            opacity: 1;
            pointer-events: auto;
        }
        .mt-drop-zone i {
            font-size: 2.5rem;
        }

        /* Attachment Preview Bar */
        .mt-attach-preview {
            padding: 8px 16px;
            background: #f8fafc;
            border-top: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: space-between;
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

        /* Footer / Input Area */
        .mt-bot-footer {
            padding: 12px 16px;
            background: #ffffff;
            border-top: 1px solid #f1f5f9;
            display: flex;
            align-items: center;
            gap: 8px;
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
        <div id="mt-bot-window">
            <div class="mt-bot-header">
                <div class="mt-bot-profile">
                    <div class="mt-bot-avatar">
                        <i class="fa-solid fa-sparkles"></i>
                    </div>
                    <div>
                        <div class="mt-bot-title">Asistente IA</div>
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
                    <span style="font-weight:700;">Drop Image Here</span>
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

        try {
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
                    image: payloadImage
                })
            });

            removeTypingIndicator(typingEl);

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const errorMsg = data.error || data.message || `HTTP ${res.status}`;
                appendBotMessage(`Error de la Edge Function (${errorMsg}). Revisa los logs de Supabase.`);
                return;
            }

            const reply = data.reply || data.message || "Sin respuesta del servidor.";

            chatHistory.push({ role: "user", text: payloadPrompt });
            chatHistory.push({ role: "model", text: reply });
            if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);

            appendBotMessage(reply);
            speakText(reply);

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
            <div class="mt-msg-time">${time}</div>
        `;
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

    // --- EVENT LISTENERS ---
    triggerBtn.onclick = () => {
        windowEl.classList.toggle('active');
        if (windowEl.classList.contains('active')) {
            inputEl.focus();
        }
    };

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

    windowEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('active');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('active');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('active');
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    initSpeechRecognition();

})();
