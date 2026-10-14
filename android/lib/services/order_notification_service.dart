import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import '../models/order_model.dart';
import 'supabase_service.dart';
import '../widgets/chatbot_widget.dart';

class OrderNotificationService {
  static final OrderNotificationService instance = OrderNotificationService._internal();

  OrderNotificationService._internal();

  StreamSubscription? _ordersSubscription;
  final Set<String> _knownPendingOrderIds = {};
  final Map<String, Timer> _periodicReminders = {};
  final AudioPlayer _audioPlayer = AudioPlayer();
  bool _isInitialized = false;

  void init() {
    final user = SupabaseService().currentUser;
    if (user == null) return;

    if (_isInitialized) return;
    _isInitialized = true;

    _ordersSubscription?.cancel();
    _ordersSubscription = SupabaseService()
        .client
        .from('menutech_orders')
        .stream(primaryKey: ['id'])
        .eq('user_id', user.id)
        .listen((dataList) {
      _processOrders(dataList);
    });
  }

  void stop() {
    _ordersSubscription?.cancel();
    _ordersSubscription = null;
    for (var timer in _periodicReminders.values) {
      timer.cancel();
    }
    _periodicReminders.clear();
    _knownPendingOrderIds.clear();
    _isInitialized = false;
  }

  void _processOrders(List<Map<String, dynamic>> rawOrders) {
    final currentPendingOrders = <OrderModel>[];
    final currentPendingIds = <String>{};

    for (var map in rawOrders) {
      final order = OrderModel.fromJson(map);
      if (order.status.toLowerCase() == 'pending') {
        currentPendingOrders.add(order);
        currentPendingIds.add(order.id);
      }
    }

    // Cancel reminders for orders that are no longer pending
    final removedIds = _knownPendingOrderIds.difference(currentPendingIds);
    for (var removedId in removedIds) {
      _periodicReminders[removedId]?.cancel();
      _periodicReminders.remove(removedId);
      _knownPendingOrderIds.remove(removedId);
    }

    // Handle new pending orders
    for (var order in currentPendingOrders) {
      if (!_knownPendingOrderIds.contains(order.id)) {
        _knownPendingOrderIds.add(order.id);
        _handleNewPendingOrder(order);
      }
    }
  }

  void _handleNewPendingOrder(OrderModel order) {
    // Immediate notification
    _notifyOrderWithGemini(order, isReminder: false);

    // Schedule periodic reminders every 35 seconds if unanswered
    _periodicReminders[order.id]?.cancel();
    _periodicReminders[order.id] = Timer.periodic(
      const Duration(seconds: 35),
      (_) {
        if (_knownPendingOrderIds.contains(order.id)) {
          _notifyOrderWithGemini(order, isReminder: true);
        } else {
          _periodicReminders[order.id]?.cancel();
          _periodicReminders.remove(order.id);
        }
      },
    );
  }

  Future<void> _notifyOrderWithGemini(OrderModel order, {required bool isReminder}) async {
    final customerName = order.customerName.isEmpty ? 'un cliente' : order.customerName;
    final totalAmount = order.totalAmount.toStringAsFixed(2);

    final prompt = isReminder
        ? "Genera una frase muy corta, cercana y atenta en español (máximo 12 palabras), como un amigo recordando amablemente al usuario que la orden de $customerName por \$$totalAmount sigue pendiente y necesita respuesta. No incluyas emojis, ni iconos, ni símbolos, ni comillas, solo texto plano."
        : "Genera una frase muy corta, amable y amigable en español (máximo 12 palabras), como un amigo cercano al usuario notificándole que acaba de llegar una nueva orden de $customerName por \$$totalAmount. No incluyas emojis, ni iconos, ni símbolos, ni comillas, solo texto plano.";

    String rawPhrase = '';
    try {
      final res = await SupabaseService().client.functions.invoke(
        'gemini-chat',
        body: {'prompt': prompt},
      );
      if (res.data != null && res.data['reply'] != null) {
        rawPhrase = res.data['reply'].toString();
      }
    } catch (_) {
      // Fallback
    }

    if (rawPhrase.trim().isEmpty) {
      rawPhrase = isReminder
          ? "Recuerda que tienes la orden pendiente de $customerName por \$$totalAmount"
          : "Tienes una nueva orden de $customerName por \$$totalAmount";
    }

    final cleanPhrase = _sanitizeText(rawPhrase);

    // Speak voice announcement
    _speakText(cleanPhrase);

    // Display plain text thought bubble
    ChatbotWidget.showOrderBubble(cleanPhrase, order);
  }

  String _sanitizeText(String input) {
    var text = input;
    text = text.replaceAll(RegExp(r'[*_~`]'), '');
    text = text.replaceAll(RegExp(r'<[^>]*>'), '');
    text = text.replaceAll(
      RegExp(
        r'[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]',
        unicode: true,
      ),
      '',
    );
    text = text.replaceAll('"', '').replaceAll("'", '').trim();
    return text;
  }

  void _speakText(String phrase) async {
    try {
      final url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es&q=${Uri.encodeComponent(phrase)}';
      await _audioPlayer.stop();
      await _audioPlayer.play(UrlSource(url));
    } catch (_) {}
  }
}
