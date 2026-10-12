import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../core/config.dart';
import '../services/supabase_service.dart';
import '../widgets/chatbot_widget.dart';

class MenuEditorScreen extends StatefulWidget {
  const MenuEditorScreen({super.key});

  @override
  State<MenuEditorScreen> createState() => _MenuEditorScreenState();
}

class _MenuEditorScreenState extends State<MenuEditorScreen> {
  late final WebViewController _controller;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _initWebView();
  }

  void _initWebView() {
    final session = SupabaseService().currentSession;
    final user = SupabaseService().currentUser;

    String injectedSessionJs = '';
    String urlWithTokens = 'https://menutech.io/adminMenus.html?app=true';

    if (session != null) {
      final projectRef = Uri.parse(AppConfig.supabaseUrl).host.split('.').first;
      final sessionMap = {
        'access_token': session.accessToken,
        'refresh_token': session.refreshToken,
        'user': {
          'id': user?.id,
          'email': user?.email,
          'user_metadata': user?.userMetadata,
          'app_metadata': user?.appMetadata,
          'role': user?.role,
        }
      };
      final sessionJson = jsonEncode(sessionMap);
      injectedSessionJs = '''
        try {
          localStorage.setItem('sb-$projectRef-auth-token', JSON.stringify($sessionJson));
        } catch(e) {}
      ''';

      urlWithTokens = 'https://menutech.io/adminMenus.html?app=true#access_token=${session.accessToken}&refresh_token=${session.refreshToken}';
    }

    const hideWebChatbotJs = '''
      (function() {
        var styleId = 'mt-hide-web-bot-style';
        if (!document.getElementById(styleId)) {
          var style = document.createElement('style');
          style.id = styleId;
          style.innerHTML = '#mt-bot-root, #mt-bot-trigger, #mt-bot-window, #mt-admin-thought-bubble { display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }';
          if (document.head) document.head.appendChild(style);
        }
        var bot = document.getElementById('mt-bot-root');
        if (bot) bot.remove();
      })();
    ''';

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFFFFCF0))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (String url) {
            if (mounted) setState(() => _isLoading = true);
            if (injectedSessionJs.isNotEmpty) {
              _controller.runJavaScript(injectedSessionJs);
            }
            _controller.runJavaScript(hideWebChatbotJs);
          },
          onPageFinished: (String url) {
            if (mounted) setState(() => _isLoading = false);
            if (injectedSessionJs.isNotEmpty) {
              _controller.runJavaScript(injectedSessionJs);
            }
            _controller.runJavaScript(hideWebChatbotJs);
          },
        ),
      )
      ..loadRequest(Uri.parse(urlWithTokens));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'My Menu',
          style: TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Outfit'),
        ),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Color(0xFFFF9533)),
            onPressed: () => _controller.reload(),
          ),
        ],
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_isLoading)
            const Center(
              child: CircularProgressIndicator(color: Color(0xFFFF9533)),
            ),
          const Positioned(
            right: 0,
            bottom: 0,
            child: ChatbotWidget(),
          ),
        ],
      ),
    );
  }
}
