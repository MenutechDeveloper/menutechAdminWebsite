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
    }

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
          },
          onPageFinished: (String url) {
            if (mounted) setState(() => _isLoading = false);
            if (injectedSessionJs.isNotEmpty) {
              _controller.runJavaScript(injectedSessionJs);
            }
          },
        ),
      )
      ..loadRequest(Uri.parse('https://menutech.services/adminMenus.html'));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Menús',
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
