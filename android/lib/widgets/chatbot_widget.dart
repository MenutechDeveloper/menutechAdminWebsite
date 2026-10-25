import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../models/order_model.dart';
import '../models/unified_item.dart';
import '../services/supabase_service.dart';

class ChatbotWidget extends StatefulWidget {
  const ChatbotWidget({super.key});

  static _ChatbotWidgetState? _activeState;

  static void showItemBubble(String text, UnifiedItem item) {
    final state = _activeState;
    if (state != null && state.mounted) {
      final jsonItem = jsonEncode(item.toJson());
      final jsonText = jsonEncode(text);
      state._controller.runJavaScript('''
        if (window.showOrderBubbleInWebView) {
          window.showOrderBubbleInWebView($jsonText, $jsonItem);
        }
      ''');
    }
  }

  static void hideBubble() {
    final state = _activeState;
    if (state != null && state.mounted) {
      state._controller.runJavaScript('''
        if (window.hideBubbleInWebView) {
          window.hideBubbleInWebView();
        } else {
          var b = document.getElementById('mt-admin-thought-bubble');
          if (b) b.classList.add('hidden');
        }
      ''');
    }
  }

  static void showOrderBubble(String text, OrderModel order) {
    final item = UnifiedItem(
      id: order.id,
      userId: order.userId,
      entryType: EntryType.order,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      status: order.status,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      address: order.address,
      reference: order.reference,
      orderType: order.orderType,
      items: order.items,
      customerNotes: order.customerNotes,
      paymentMethod: order.paymentMethod,
      deliveryDate: order.deliveryDate,
      deliveryTime: order.deliveryTime,
      deliveryTimeMode: order.deliveryTimeMode,
    );
    showItemBubble(text, item);
  }

  static void notifyNewOrder(Map<String, dynamic> orderJson) {
    final state = _activeState;
    if (state != null && state.mounted) {
      final jsonStr = jsonEncode(orderJson);
      state._controller.runJavaScript('if(window.MenutechBot) window.MenutechBot.handleNewOrder($jsonStr);');
    }
  }

  static void notifyOrderUpdated(String id, String status) {
    final state = _activeState;
    if (state != null && state.mounted) {
      state._controller.runJavaScript('if(window.MenutechBot) window.MenutechBot.handleOrderUpdated("$id", "$status");');
    }
  }

  static void notifyPrinterConnected(String ip, String? name) {
    final state = _activeState;
    if (state != null && state.mounted) {
      final payload = jsonEncode({'ip': ip, 'name': name ?? 'Printer $ip'});
      state._controller.runJavaScript('if(window.MenutechBot) window.MenutechBot.handlePrinterConnected($payload);');
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
    ChatbotWidget._activeState = this;
    _initWebView();
  }

  @override
  void dispose() {
    if (ChatbotWidget._activeState == this) {
      ChatbotWidget._activeState = null;
    }
    super.dispose();
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
            ChatbotWidget._activeState = this;
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
      transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.25s !important;
    }

    /* Expanded active chat window sits elegantly as a modal card with comfortable top margin */
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
      border-radius: 28px 28px 0 0 !important;
      border: 1px solid rgba(255, 149, 51, 0.2) !important;
      box-shadow: 0 -12px 36px rgba(0,0,0,0.22) !important;
      transform: translateY(0) scale(1) !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      visibility: visible !important;
      transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }

    .mt-drag-handle {
      width: 36px;
      height: 4px;
      background: rgba(255, 255, 255, 0.45);
      border-radius: 2px;
      margin: 6px auto 2px auto;
      flex-shrink: 0;
    }

    .mt-bot-header {
      padding: 10px 18px 14px 18px !important;
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
      height: 80px !important;
      flex-shrink: 0 !important;
    }
    .mt-window-mv {
      width: 80px !important;
      height: 80px !important;
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

    #mt-admin-thought-bubble {
      position: absolute !important;
      bottom: 85px !important;
      right: 10px !important;
      width: 230px !important;
      z-index: 9999 !important;
    }
    .mt-bubble-link {
      display: none !important;
    }
  </style>
  <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
  <script>
    window.MENUTECH_BOT_MODEL_URL = 'https://menutech.io/assets/menutechbot.gltf';

    window.showOrderBubbleInWebView = function(text, orderData) {
      var bubbleEl = document.getElementById('mt-admin-thought-bubble');
      var msgEl = document.getElementById('mt-bubble-msg');
      var win = document.getElementById('mt-bot-window');
      if (!bubbleEl || !msgEl) return;
      if (win && win.classList.contains('active')) return;

      var linkEl = bubbleEl.querySelector('.mt-bubble-link');
      if (linkEl) linkEl.style.display = 'none';

      msgEl.innerText = text;
      bubbleEl.classList.remove('hidden');

      bubbleEl.onclick = function(e) {
        e.stopPropagation();
        bubbleEl.classList.add('hidden');
      };
    };

    window.hideBubbleInWebView = function() {
      var bubbleEl = document.getElementById('mt-admin-thought-bubble');
      if (bubbleEl) {
        bubbleEl.classList.add('hidden');
      }
    };
  </script>
  <script src="https://menutech.io/chatbot.js"></script>
  <script>
    function syncChatState() {
      var root = document.getElementById('mt-bot-root');
      var win = document.getElementById('mt-bot-window');
      var triggerMv = document.querySelector('.mt-trigger-mv');
      var windowMv = document.querySelector('.mt-window-mv');
      if (root && win) {
        var isActive = win.classList.contains('active');
        if (isActive) {
          root.classList.add('chat-open');
          if (triggerMv && typeof triggerMv.pause === 'function') triggerMv.pause();
          if (windowMv && typeof windowMv.play === 'function') windowMv.play();
        } else {
          root.classList.remove('chat-open');
          if (windowMv && typeof windowMv.pause === 'function') windowMv.pause();
          if (triggerMv && typeof triggerMv.play === 'function') triggerMv.play();
        }

        if (window.lastChatState !== isActive) {
          window.lastChatState = isActive;
          if (window.FlutterChatbotChannel && window.FlutterChatbotChannel.postMessage) {
            window.FlutterChatbotChannel.postMessage(JSON.stringify({
              event: isActive ? 'chat_opened' : 'chat_closed'
            }));
          }
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
    setInterval(syncChatState, 200);
  </script>
</body>
</html>
''';

    _controller.loadHtmlString(htmlContent, baseUrl: 'https://menutech.io/');
  }

  @override
  Widget build(BuildContext context) {
    final screenSize = MediaQuery.of(context).size;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final topPadding = MediaQuery.of(context).padding.top;

    final double width = _isExpanded ? screenSize.width : 260.0;

    double height = 220.0;
    if (_isExpanded) {
      final topMargin = topPadding > 0 ? topPadding + 65.0 : 80.0;
      final availableHeight = screenSize.height - bottomInset - topMargin;
      height = availableHeight > 220 ? availableHeight : 220;
    }

    final double topOffset = _isExpanded ? (topPadding > 0 ? topPadding + 65.0 : 80.0) : 0.0;

    return Padding(
      padding: EdgeInsets.only(
        top: topOffset,
        bottom: _isExpanded ? bottomInset : 0.0,
      ),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOutCubic,
        width: width,
        height: height,
        color: Colors.transparent,
        child: WebViewWidget(controller: _controller),
      ),
    );
  }
}
