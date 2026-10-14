import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import '../models/order_model.dart';
import '../services/supabase_service.dart';
import '../widgets/chatbot_widget.dart';

class OrderNotificationService {
  static final OrderNotificationService _instance = OrderNotificationService._internal();
  factory OrderNotificationService() => _instance;
  OrderNotificationService._internal();

  final SupabaseService _supabase = SupabaseService();
  final AudioPlayer _audioPlayer = AudioPlayer();

  StreamSubscription? _ordersSubscription;
  Timer? _reminderTimer;
  final Map<String, OrderModel> _pendingOrders = {};
  final Set<String> _announcedOrderIds = {};

  bool _isInitialized = false;

  void initialize() {
    if (_isInitialized) return;
    _isInitialized = true;
    _listenToOrders();
  }

  void _listenToOrders() {
    final user = _supabase.currentUser;
    if (user == null) return;

    _ordersSubscription?.cancel();
    _ordersSubscription = _supabase.client
        .from('menutech_orders')
        .stream(primaryKey: ['id'])
        .eq('user_id', user.id)
        .listen((ordersData) async {
      final currentPendingIds = <String>{};

      for (var json in ordersData) {
        final order = OrderModel.fromJson(json);
        final status = order.status.toLowerCase();

        if (status == 'pending') {
          currentPendingIds.add(order.id);
          _pendingOrders[order.id] = order;

          if (!_announcedOrderIds.contains(order.id)) {
            _announcedOrderIds.add(order.id);
            await _announceOrder(order, isReminder: false);
          }
        } else {
          _pendingOrders.remove(order.id);
        }
      }

      // Remove any order that is no longer pending
      _pendingOrders.removeWhere((id, order) => !currentPendingIds.contains(id));

      if (_pendingOrders.isNotEmpty) {
        _startReminderTimer();
      } else {
        _stopReminderTimer();
        ChatbotWidget.clearThoughtBubble();
      }
    });
  }

  void _startReminderTimer() {
    _reminderTimer ??= Timer.periodic(const Duration(seconds: 35), (timer) async {
      if (_pendingOrders.isEmpty) {
        _stopReminderTimer();
        return;
      }
      final latestOrder = _pendingOrders.values.last;
      await _announceOrder(latestOrder, isReminder: true);
    });
  }

  void _stopReminderTimer() {
    _reminderTimer?.cancel();
    _reminderTimer = null;
  }

  Future<void> _announceOrder(OrderModel order, {required bool isReminder}) async {
    final phrase = await _generateGeminiPhrase(order, isReminder: isReminder);
    await _speakPhrase(phrase);
    ChatbotWidget.notifyNewOrderCustom(
      phrase: phrase,
      order: order,
    );
  }

  Future<String> _generateGeminiPhrase(OrderModel order, {required bool isReminder}) async {
    try {
      final user = _supabase.currentUser;
      final response = await _supabase.client.functions.invoke(
        'gemini-chat',
        body: {
          'message': '''
Eres un amigo cercano y casual del dueño de este restaurante. Notifícale en español de forma amigable y humana sobre esta orden.
Cliente: ${order.customerName}
Monto: \$${order.totalAmount.toStringAsFixed(2)}
Contexto: ${isReminder ? "RECORDATORIO: La orden lleva tiempo esperando respuesta" : "NUEVA ORDEN: Acaba de llegar"}

REGLAS OBLIGATORIAS:
1. Máximo 15 palabras.
2. Habla como un amigo cercano en español ("Oye bro", "Hola amigo", "Te llegó un pedido", etc).
3. PROHIBIDO USAR EMOJIS, PROHIBIDO USAR ÍCONOS, PROHIBIDO USAR SÍMBOLOS O MARKDOWN.
4. ÚNICAMENTE TEXTO PLANO EN ESPAÑOL.
''',
          'role': 'owner',
          'domain': user?.userMetadata?['domain'] ?? '',
        },
      );

      if (response.data != null && response.data['reply'] != null) {
        final rawReply = response.data['reply'].toString();
        final clean = _sanitizeToPlainText(rawReply);
        if (clean.trim().isNotEmpty) {
          return clean;
        }
      }
    } catch (_) {
      // Fallback below
    }

    if (isReminder) {
      return _sanitizeToPlainText("Oye bro, el pedido de ${order.customerName} por \$${order.totalAmount.toStringAsFixed(2)} sigue esperando tu respuesta.");
    } else {
      return _sanitizeToPlainText("Hola amigo, te acaba de llegar un nuevo pedido de ${order.customerName} por \$${order.totalAmount.toStringAsFixed(2)}.");
    }
  }

  String _sanitizeToPlainText(String input) {
    var text = input;
    // Remove markdown symbols
    text = text.replaceAll(RegExp(r'[\*\#\_~\`\[\]\(\)]'), ' ');
    // Remove emojis and common non-ASCII icons
    text = text.replaceAll(RegExp(r'[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}]', unicode: true), '');
    // Replace multiple spaces
    text = text.replaceAll(RegExp(r'\s+'), ' ').trim();
    return text;
  }

  Future<void> _speakPhrase(String phrase) async {
    try {
      final encodedUri = Uri.parse('https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${Uri.encodeComponent(phrase)}');
      await _audioPlayer.stop();
      await _audioPlayer.play(UrlSource(encodedUri.toString()));
    } catch (_) {
      // Audio fallback or error handling
    }
  }

  void stop() {
    _ordersSubscription?.cancel();
    _ordersSubscription = null;
    _stopReminderTimer();
    _audioPlayer.stop();
    _isInitialized = false;
  }
}
