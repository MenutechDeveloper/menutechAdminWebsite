import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../services/supabase_service.dart';

class ChatbotWidget extends StatefulWidget {
  const ChatbotWidget({super.key});

  static WebViewController? _controller;
  static bool _isReady = false;

  static void notifyNewOrder(Map<String, dynamic> orderJson) {
    if (_controller != null && _isReady) {
      final jsonStr = jsonEncode(orderJson);
      _controller!.runJavaScript('if(window.MenutechBot) window.MenutechBot.handleNewOrder($jsonStr);');
    }
  }

  static void notifyOrderUpdated(String id, String status) {
    if (_controller != null && _isReady) {
      _controller!.runJavaScript('if(window.MenutechBot) window.MenutechBot.handleOrderUpdated("$id", "$status");');
    }
  }

  static void notifyPrinterConnected(String ip, String? name) {
    if (_controller != null && _isReady) {
      final payload = jsonEncode({'ip': ip, 'name': name ?? 'Printer $ip'});
      _controller!.runJavaScript('if(window.MenutechBot) window.MenutechBot.handlePrinterConnected($payload);');
    }
  }

  @override
  State<ChatbotWidget> createState() => _ChatbotWidgetState();
}

class _ChatbotWidgetState extends State<ChatbotWidget> {
  late final WebViewController _controller;
  bool _isExpanded = false;

  @override
  void initState() {
    super.initState();
    _initWebView();
  }

  void _initWebView() {
    final user = SupabaseService().currentUser;
    final userSessionJson = jsonEncode({
      'id': user?.id,
      'email': user?.email,
      'role': user?.userMetadata?['role'] ?? 'owner',
      'username': user?.userMetadata?['username'] ?? user?.email?.split('@').first,
      'domain': user?.userMetadata?['domain'] ?? '',
    });

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0x00000000))
      ..addJavaScriptChannel(
        'FlutterChatbotChannel',
        onMessageReceived: (JavaScriptMessage message) {
          try {
            final data = jsonDecode(message.message);
            final event = data['event'];
            if (event == 'chat_opened') {
              if (mounted) setState(() => _isExpanded = true);
            } else if (event == 'chat_closed') {
              if (mounted) setState(() => _isExpanded = false);
            }
          } catch (e) {
            // Error parsing message from JS
          }
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (String url) {
            ChatbotWidget._isReady = true;
            // Inject Supabase session context & WebGL optimization into chatbot script
            _controller.runJavaScript('''
              (function() {
                window.MenutechUserSession = $userSessionJson;

                // Apply low-power & low render scale performance optimizations to 3D model-viewers
                function applyPerformanceSettings() {
                  var mvs = document.querySelectorAll('model-viewer');
                  mvs.forEach(function(mv) {
                    mv.setAttribute('power-preference', 'low-power');
                    mv.setAttribute('render-scale', '0.4');
                    mv.setAttribute('shadow-intensity', '0');
                    mv.setAttribute('interaction-prompt', 'none');
                  });
                }
                applyPerformanceSettings();
                setTimeout(applyPerformanceSettings, 1000);

                // Custom handleNewOrder override for Spanish order voice notification
                if (window.MenutechBot) {
                  window.MenutechBot.handleNewOrder = function(orderData) {
                    if (!orderData) return;
                    var customerName = orderData.customerName || orderData.customer_name || 'un cliente';
                    var msgHtml = '🛍️ <b>¡Tienes una nueva orden!</b><br><small>De ' + customerName + '</small>';
                    window.MenutechBot.showThoughtBubble(msgHtml, 8000, 'es-ES');
                    if (typeof window.MenutechBot.speakText === 'function') {
                      window.MenutechBot.speakText('¡Tienes una nueva orden!', 'es-ES');
                    }
                  };
                }
              })();
            ''');
          },
        ),
      );

    const htmlContent = '''
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; width: 100%; height: 100%;
      background: transparent !important;
      overflow: hidden;
      user-select: none;
      -webkit-user-select: none;
    }

    #mt-bot-root {
      position: fixed !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
    }

    /* When chat window is open, completely hide trigger button to save GPU/CPU memory */
    #mt-bot-root.chat-open #mt-bot-trigger {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
      opacity: 0 !important;
    }

    /* Closed chat window is hidden with smooth opacity transition */
    #mt-bot-root:not(.chat-open) #mt-bot-window {
      opacity: 0 !important;
      transform: translateY(30px) scale(0.95) !important;
      pointer-events: none !important;
      visibility: hidden !important;
      transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.3s !important;
    }

    /* Expanded active chat window fills the WebView viewport responsively */
    #mt-bot-root.chat-open #mt-bot-window {
      display: flex !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100% !important;
      height: 100% !important;
      max-width: 100% !important;
      max-height: 100% !important;
      border-radius: 24px 24px 0 0 !important;
      border: none !important;
      box-shadow: 0 -8px 30px rgba(0,0,0,0.2) !important;
      transform: translateY(0) scale(1) !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      visibility: visible !important;
      transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }

    .mt-bot-header {
      padding: 12px 18px !important;
      background: linear-gradient(135deg, #ff9533 0%, #f97316 100%) !important;
      color: #ffffff !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      box-shadow: 0 4px 15px rgba(249, 115, 22, 0.2) !important;
      flex-shrink: 0 !important;
      z-index: 10 !important;
    }

    #mt-bot-close {
      width: 38px !important;
      height: 38px !important;
      border-radius: 50% !important;
      background: rgba(255, 255, 255, 0.25) !important;
      color: #ffffff !important;
      font-size: 1.1rem !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      border: 1px solid rgba(255, 255, 255, 0.4) !important;
      transition: all 0.2s ease !important;
    }
    #mt-bot-close:active {
      transform: scale(0.9) !important;
      background: rgba(255, 255, 255, 0.4) !important;
    }

    .mt-bot-banner {
      height: 85px !important;
      flex-shrink: 0 !important;
    }
    .mt-window-mv {
      width: 85px !important;
      height: 85px !important;
    }

    #mt-bot-trigger {
      position: absolute !important;
      bottom: 5px !important;
      right: 5px !important;
      width: 80px !important;
      height: 80px !important;
      z-index: 10 !important;
      pointer-events: auto !important;
    }
  </style>
  <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
  <script>
    window.MENUTECH_BOT_MODEL_URL = 'https://menutech.io/assets/menutechbot.gltf';
  </script>
  <script src="https://menutech.io/chatbot.js"></script>
  <script>
    function syncChatState() {
      var root = document.getElementById('mt-bot-root');
      var win = document.getElementById('mt-bot-window');
      var triggerMv = document.querySelector('.mt-trigger-mv');
      var windowMv = document.querySelector('.mt-window-mv');
      if (root && win) {
        if (win.classList.contains('active')) {
          root.classList.add('chat-open');
          if (triggerMv && typeof triggerMv.pause === 'function') triggerMv.pause();
          if (windowMv && typeof windowMv.play === 'function') windowMv.play();
        } else {
          root.classList.remove('chat-open');
          if (windowMv && typeof windowMv.pause === 'function') windowMv.pause();
          if (triggerMv && typeof triggerMv.play === 'function') triggerMv.play();
        }
      }
    }

    var observer = new MutationObserver(syncChatState);
    window.addEventListener('load', function() {
      var win = document.getElementById('mt-bot-window');
      if (win) {
        observer.observe(win, { attributes: true, attributeFilter: ['class'] });
      }
      syncChatState();
    });
    setInterval(syncChatState, 250);
  </script>
</body>
</html>
''';

    _controller.loadHtmlString(htmlContent, baseUrl: 'https://menutech.io/');
    ChatbotWidget._controller = _controller;
  }

  @override
  Widget build(BuildContext context) {
    final screenSize = MediaQuery.of(context).size;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final topPadding = MediaQuery.of(context).padding.top;

    final double width = _isExpanded ? screenSize.width : 90.0;

    double height = 90.0;
    if (_isExpanded) {
      final availableHeight = screenSize.height - bottomInset - topPadding - 16;
      height = availableHeight > 200 ? availableHeight : 200;
    }

    return Padding(
      padding: EdgeInsets.only(
        top: _isExpanded ? (topPadding > 0 ? topPadding + 10 : 20.0) : 0.0,
        bottom: _isExpanded ? bottomInset : 0.0,
      ),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
        width: width,
        height: height,
        color: Colors.transparent,
        child: WebViewWidget(controller: _controller),
      ),
    );
  }
}
