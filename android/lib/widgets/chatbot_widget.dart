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
              setState(() => _isExpanded = true);
            } else if (event == 'chat_closed') {
              setState(() => _isExpanded = false);
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
    }
    #mt-bot-root {
      bottom: 10px !important;
      right: 10px !important;
    }
  </style>
  <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
  <script src="https://menutech.services/chatbot.js"></script>
</body>
</html>
''';

    _controller.loadHtmlString(htmlContent, baseUrl: 'https://menutech.services/');
    ChatbotWidget._controller = _controller;
  }

  @override
  Widget build(BuildContext context) {
    final screenSize = MediaQuery.of(context).size;

    final double width = _isExpanded ? screenSize.width : 220.0;
    final double height = _isExpanded ? (screenSize.height * 0.85) : 260.0;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
      width: width,
      height: height,
      color: Colors.transparent,
      child: WebViewWidget(controller: _controller),
    );
  }
}
