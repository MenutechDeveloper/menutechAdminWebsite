import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:audioplayers/audioplayers.dart';
import '../main.dart';
import '../models/unified_item.dart';
import '../screens/main_screen.dart';
import '../screens/orders_screen.dart';
import 'supabase_service.dart';
import '../widgets/chatbot_widget.dart';

// ====================================================================
// STRICT RULE: NEVER include or display AI thinking process (<think>, <thought>, reasoning, drafting, etc.).
// All notifications must be clean, direct, instant, and strictly in English.
// ====================================================================

class OrderNotificationService {
  static final OrderNotificationService instance = OrderNotificationService._internal();

  OrderNotificationService._internal();

  StreamSubscription? _ordersSubscription;
  StreamSubscription? _reservationsSubscription;
  Timer? _syncTimer;

  final Set<String> _knownPendingKeys = {};
  final Map<String, Timer> _periodicReminders = {};
  final AudioPlayer _chimePlayer = AudioPlayer();
  bool _isInitialized = false;
  bool _isInitialSyncCompleted = false;

  final Map<String, UnifiedItem> _pendingItemsMap = {};

  void init() async {
    final user = SupabaseService().currentUser;
    if (user == null) return;

    if (_isInitialized) return;
    _isInitialized = true;

    _stopSubscriptions();

    try {
      await _chimePlayer.setAudioContext(const AudioContext(
        android: AudioContextAndroid(
          usageType: AndroidUsageType.notification,
          contentType: AndroidContentType.sonification,
        ),
      ));
    } catch (_) {}

    await _pollInitialPending(user.id);
    _isInitialSyncCompleted = true;

    _syncTimer?.cancel();
    _syncTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      final u = SupabaseService().currentUser;
      if (u != null) {
        _pollLatestPending(u.id);
      }
    });

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

  Future<void> _pollInitialPending(String userId) async {
    try {
      final ordersData = await SupabaseService()
          .client
          .from('menutech_orders')
          .select()
          .eq('user_id', userId);

      final resData = await SupabaseService()
          .client
          .from('menutech_reservations')
          .select()
          .eq('user_id', userId);

      _seedPendingKeys(List<Map<String, dynamic>>.from(ordersData as List), isReservation: false);
      _seedPendingKeys(List<Map<String, dynamic>>.from(resData as List), isReservation: true);
    } catch (e) {
      debugPrint("Error polling initial pending items: $e");
    }
  }

  void _seedPendingKeys(List<Map<String, dynamic>> rawList, {required bool isReservation}) {
    final prefix = isReservation ? 'res_' : 'order_';
    for (var map in rawList) {
      final item = isReservation
          ? UnifiedItem.fromReservationJson(map)
          : UnifiedItem.fromOrderJson(map);

      final key = '$prefix${item.id}';
      if (item.status.toLowerCase() == 'pending') {
        _knownPendingKeys.add(key);
        _pendingItemsMap[key] = item;
      }
    }
  }

  Future<void> _pollLatestPending(String userId) async {
    try {
      final ordersData = await SupabaseService()
          .client
          .from('menutech_orders')
          .select()
          .eq('user_id', userId);

      final resData = await SupabaseService()
          .client
          .from('menutech_reservations')
          .select()
          .eq('user_id', userId);

      _processItems(List<Map<String, dynamic>>.from(ordersData as List), isReservation: false);
      _processItems(List<Map<String, dynamic>>.from(resData as List), isReservation: true);
    } catch (_) {}
  }

  void stop() {
    _stopSubscriptions();
    _syncTimer?.cancel();
    _syncTimer = null;
    for (var timer in _periodicReminders.values) {
      timer.cancel();
    }
    _periodicReminders.clear();
    _knownPendingKeys.clear();
    _pendingItemsMap.clear();
    _isInitialized = false;
    _isInitialSyncCompleted = false;
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

    final existingKeysForType = _knownPendingKeys.where((k) => k.startsWith(prefix)).toSet();
    final removedKeys = existingKeysForType.difference(currentPendingKeysForType);

    for (var removedKey in removedKeys) {
      _periodicReminders[removedKey]?.cancel();
      _periodicReminders.remove(removedKey);
      _knownPendingKeys.remove(removedKey);
      _pendingItemsMap.remove(removedKey);
    }

    if (removedKeys.isNotEmpty) {
      ChatbotWidget.hideBubble();
    }

    for (var key in currentPendingKeysForType) {
      if (!_knownPendingKeys.contains(key)) {
        _knownPendingKeys.add(key);
        final item = _pendingItemsMap[key];
        if (item != null && _isInitialSyncCompleted) {
          _handleNewPendingItem(key, item);
        }
      }
    }
  }

  void _handleNewPendingItem(String key, UnifiedItem item) {
    try {
      navigatorKey.currentState?.popUntil((route) => route.isFirst);
      MainScreen.selectOrdersTab();
      OrdersScreen.selectPendingTab();
    } catch (e) {
      debugPrint("Auto-navigation to Pending tab failed: $e");
    }

    _notifyItem(item, isReminder: false);

    _periodicReminders[key]?.cancel();
    _periodicReminders[key] = Timer.periodic(
      const Duration(seconds: 3),
      (_) {
        if (_knownPendingKeys.contains(key)) {
          final currentItem = _pendingItemsMap[key] ?? item;
          _notifyItem(currentItem, isReminder: true);
        } else {
          _periodicReminders[key]?.cancel();
          _periodicReminders.remove(key);
        }
      },
    );
  }

  // STRICT RULE: NEVER include or display AI thinking process (<think>, <thought>, reasoning, drafting, etc.).
  // All notifications must be clean, direct, instant, and strictly in English.
  Future<void> _notifyItem(UnifiedItem item, {required bool isReminder}) async {
    final customerName = item.customerName.isEmpty || item.customerName == 'N/A'
        ? 'a customer'
        : item.customerName;

    String cleanPhrase;

    if (item.entryType == EntryType.order) {
      final totalAmount = item.totalAmount.toStringAsFixed(2);
      if (isReminder) {
        cleanPhrase = "Reminder: Pending order from $customerName for \$$totalAmount is waiting!";
      } else {
        cleanPhrase = "You have a new order from $customerName for \$$totalAmount!";
      }
    } else {
      final partySize = item.partySize;
      if (isReminder) {
        cleanPhrase = "Reminder: Pending reservation from $customerName for $partySize guests is waiting!";
      } else {
        cleanPhrase = "You have a new reservation from $customerName for $partySize guests!";
      }
    }

    cleanPhrase = _sanitizeText(cleanPhrase);

    // 1. Play alert chime sound
    await _playAlertChime();

    // 2. Display thought bubble and trigger US English TTS voice in WebView
    ChatbotWidget.showItemBubble(cleanPhrase, item);
  }

  // STRICT RULE: Remove any reasoning artifacts, thought tags, or internal markdown
  String _sanitizeText(String input) {
    var text = input;
    text = text.replaceAll(RegExp(r'<(thought|think)[\s\S]*?<\/\1>', caseSensitive: false), '');
    text = text.replaceAll(RegExp(r'(thought|reasoning|proceso de pensamiento):[\s\S]*', caseSensitive: false), '');
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
      await Future.delayed(const Duration(milliseconds: 500));
    } catch (e) {
      debugPrint("Chime playback error: $e");
    }
  }
}
