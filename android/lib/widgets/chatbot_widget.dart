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
            // Inject Supabase session context into chatbot script
            _controller.runJavaScript('''
              (function() {
                window.MenutechUserSession = $userSessionJson;
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
    }

    /* Closed chat window is hidden completely */
    #mt-bot-root:not(.chat-open) #mt-bot-window {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
      opacity: 0 !important;
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
      border-radius: 20px 20px 0 0 !important;
      border: none !important;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.15) !important;
      transform: none !important;
      opacity: 1 !important;
      pointer-events: auto !important;
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
      final availableHeight = screenSize.height - bottomInset - topPadding - 10;
      height = availableHeight > 200 ? availableHeight : 200;
    }

    return Padding(
      padding: EdgeInsets.only(bottom: _isExpanded ? bottomInset : 0.0),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOutCubic,
        width: width,
        height: height,
        color: Colors.transparent,
        child: WebViewWidget(controller: _controller),
      ),
    );
  }
}
