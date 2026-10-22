import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import '../models/unified_item.dart';
import 'supabase_service.dart';
import '../widgets/chatbot_widget.dart';

class OrderNotificationService {
  static final OrderNotificationService instance = OrderNotificationService._internal();

  OrderNotificationService._internal();

  StreamSubscription? _ordersSubscription;
  StreamSubscription? _reservationsSubscription;

  final Set<String> _knownPendingKeys = {};
  final Map<String, Timer> _periodicReminders = {};
  final AudioPlayer _chimePlayer = AudioPlayer();
  final AudioPlayer _speechPlayer = AudioPlayer();
  bool _isInitialized = false;

  final Map<String, UnifiedItem> _pendingItemsMap = {};

  void init() {
    final user = SupabaseService().currentUser;
    if (user == null) return;

    if (_isInitialized) return;
    _isInitialized = true;

    _stopSubscriptions();

    _ordersSubscription = SupabaseService()
        .client
        .from('menutech_orders')
        .stream(primaryKey: ['id'])
        .eq('user_id', user.id)
        .listen((dataList) {
      _processItems(dataList, isReservation: false);
    });

    _reservationsSubscription = SupabaseService()
        .client
        .from('menutech_reservations')
        .stream(primaryKey: ['id'])
        .eq('user_id', user.id)
        .listen((dataList) {
      _processItems(dataList, isReservation: true);
    });
  }

  void stop() {
    _stopSubscriptions();
    for (var timer in _periodicReminders.values) {
      timer.cancel();
    }
    _periodicReminders.clear();
    _knownPendingKeys.clear();
    _pendingItemsMap.clear();
    _isInitialized = false;
  }

  void _stopSubscriptions() {
    _ordersSubscription?.cancel();
    _ordersSubscription = null;
    _reservationsSubscription?.cancel();
    _reservationsSubscription = null;
  }

  void _processItems(List<Map<String, dynamic>> rawList, {required bool isReservation}) {
    final prefix = isReservation ? 'res_' : 'order_';
    final currentPendingKeysForType = <String>{};

    for (var map in rawList) {
      final item = isReservation
          ? UnifiedItem.fromReservationJson(map)
          : UnifiedItem.fromOrderJson(map);

      final key = '$prefix${item.id}';
      if (item.status.toLowerCase() == 'pending') {
        currentPendingKeysForType.add(key);
        _pendingItemsMap[key] = item;
      } else {
        _pendingItemsMap.remove(key);
      }
    }

    // Cancel reminders for keys of this type that are no longer pending
    final existingKeysForType = _knownPendingKeys.where((k) => k.startsWith(prefix)).toSet();
    final removedKeys = existingKeysForType.difference(currentPendingKeysForType);

    for (var removedKey in removedKeys) {
      _periodicReminders[removedKey]?.cancel();
      _periodicReminders.remove(removedKey);
      _knownPendingKeys.remove(removedKey);
      _pendingItemsMap.remove(removedKey);
    }

    // Handle new pending items
    for (var key in currentPendingKeysForType) {
      if (!_knownPendingKeys.contains(key)) {
        _knownPendingKeys.add(key);
        final item = _pendingItemsMap[key];
        if (item != null) {
          _handleNewPendingItem(key, item);
        }
      }
    }
  }

  void _handleNewPendingItem(String key, UnifiedItem item) {
    // Immediate notification in real time
    _notifyWithGemini(item, isReminder: false);

    // Schedule periodic reminders every 35 seconds if unanswered
    _periodicReminders[key]?.cancel();
    _periodicReminders[key] = Timer.periodic(
      const Duration(seconds: 35),
      (_) {
        if (_knownPendingKeys.contains(key)) {
          final currentItem = _pendingItemsMap[key] ?? item;
          _notifyWithGemini(currentItem, isReminder: true);
        } else {
          _periodicReminders[key]?.cancel();
          _periodicReminders.remove(key);
        }
      },
    );
  }

  Future<void> _notifyWithGemini(UnifiedItem item, {required bool isReminder}) async {
    final customerName = item.customerName.isEmpty || item.customerName == 'N/A'
        ? 'a customer'
        : item.customerName;

    String prompt;
    String fallbackPhrase;

    if (item.entryType == EntryType.order) {
      final totalAmount = item.totalAmount.toStringAsFixed(2);
      if (isReminder) {
        prompt = "Generate a very short, polite, and friendly sentence in English (maximum 12 words), as a helpful assistant reminding the user that the pending order from $customerName for \$$totalAmount is still waiting for a response. Do not include emojis, icons, symbols, quotes, or markdown, plain text only.";
        fallbackPhrase = "Reminder: You have a pending order from $customerName for \$$totalAmount";
      } else {
        prompt = "Generate a very short, polite, and friendly sentence in English (maximum 12 words), as a helpful assistant notifying the user that a new order from $customerName for \$$totalAmount has just arrived. Do not include emojis, icons, symbols, quotes, or markdown, plain text only.";
        fallbackPhrase = "You have a new order from $customerName for \$$totalAmount";
      }
    } else {
      final partySize = item.partySize;
      if (isReminder) {
        prompt = "Generate a very short, polite, and friendly sentence in English (maximum 12 words), as a helpful assistant reminding the user that the pending table reservation from $customerName for $partySize guests is still waiting for a response. Do not include emojis, icons, symbols, quotes, or markdown, plain text only.";
        fallbackPhrase = "Reminder: You have a pending reservation from $customerName";
      } else {
        prompt = "Generate a very short, polite, and friendly sentence in English (maximum 12 words), as a helpful assistant notifying the user that a new table reservation from $customerName for $partySize guests has just arrived. Do not include emojis, icons, symbols, quotes, or markdown, plain text only.";
        fallbackPhrase = "You have a new reservation from $customerName for $partySize guests";
      }
    }

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
      rawPhrase = fallbackPhrase;
    }

    final cleanPhrase = _sanitizeText(rawPhrase);

    // 1. Play alert chime sound so client hears audio notification
    await _playAlertChime();

    // 2. Speak Gemini AI announcement in English
    _speakText(cleanPhrase);

    // 3. Display plain text thought bubble on 3D character
    ChatbotWidget.showItemBubble(cleanPhrase, item);
  }

  String _sanitizeText(String input) {
    var text = input;
    text = text.replaceAll(RegExp(r'[*_~`]'), '');
    text = text.replaceAll(RegExp(r'<[^>]*>'), '');
    text = text.replaceAll(
      RegExp(
        r'[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1FA00}-\u{1FA6F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]',
        unicode: true,
      ),
      '',
    );
    text = text.replaceAll('"', '').replaceAll("'", '').trim();
    return text;
  }

  Future<void> _playAlertChime() async {
    try {
      await _chimePlayer.stop();
      await _chimePlayer.play(UrlSource('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'));
      await Future.delayed(const Duration(milliseconds: 600));
    } catch (_) {}
  }

  void _speakText(String phrase) async {
    try {
      final url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${Uri.encodeComponent(phrase)}';
      await _speechPlayer.stop();
      await _speechPlayer.play(UrlSource(url));
    } catch (_) {}
  }
}
