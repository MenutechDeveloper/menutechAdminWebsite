import 'dart:async';
import 'dart:io';
import 'package:intl/intl.dart';
import '../models/order_model.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_thermal_printer_pos/flutter_thermal_printer_pos.dart';
import 'package:network_info_plus/network_info_plus.dart';
import 'package:permission_handler/permission_handler.dart';
import 'supabase_service.dart';

class PrintService {
  static final PrintService _instance = PrintService._internal();
  factory PrintService() => _instance;
  PrintService._internal();

  final SupabaseService _supabase = SupabaseService();

  Future<List<String>> getSavedPrinterIps() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList('printer_ips') ?? [];
  }

  Future<void> savePrinterIp(String ip) async {
    final prefs = await SharedPreferences.getInstance();
    final ips = prefs.getStringList('printer_ips') ?? [];
    if (!ips.contains(ip)) {
      ips.add(ip);
      await prefs.setStringList('printer_ips', ips);
    }

    // Also save to Supabase
    final user = _supabase.currentUser;
    if (user != null) {
      try {
        await _supabase.client.from('menutech_tickets').upsert({
          'user_id': user.id,
          'printer_ip': ip,
          'updated_at': DateTime.now().toIso8601String(),
        }, onConflict: 'user_id');
      } catch (e) {
        // Error saving IP to Supabase
      }
    }
  }

  Future<String?> getRemotePrinterIp() async {
    final user = _supabase.currentUser;
    if (user == null) return null;

    try {
      final response = await _supabase.client
          .from('menutech_tickets')
          .select('printer_ip')
          .eq('user_id', user.id)
          .maybeSingle();
      return response?['printer_ip'] as String?;
    } catch (e) {
      return null;
    }
  }

  Future<List<String>> discoverPrinters() async {
    List<String> discoveredIps = [];

    // Request permissions
    final status = await Permission.locationWhenInUse.request();
    if (!status.isGranted) return [];

    final info = NetworkInfo();
    String? wifiIP = await info.getWifiIP();

    if (wifiIP == null) return [];

    final String subnet = wifiIP.substring(0, wifiIP.lastIndexOf('.'));

    // Scan in chunks to avoid socket exhaustion
    const int chunkSize = 30;
    for (int i = 1; i < 255; i += chunkSize) {
      final List<Future<String?>> tasks = [];
      for (int j = i; j < i + chunkSize && j < 255; j++) {
        tasks.add(_checkPrinter('$subnet.$j'));
      }
      final results = await Future.wait(tasks);
      for (var result in results) {
        if (result != null) discoveredIps.add(result);
      }
      // If we found at least one, we can stop early if we want "auto-connect"
      // but let's find all and let the UI handle it.
    }

    return discoveredIps;
  }

  Future<String?> _checkPrinter(String host) async {
    try {
      final socket = await Socket.connect(host, 9100, timeout: const Duration(milliseconds: 700));
      socket.destroy();
      return host;
    } catch (e) {
      return null;
    }
  }

  Future<void> removePrinterIp(String ip) async {
    final prefs = await SharedPreferences.getInstance();
    final ips = prefs.getStringList('printer_ips') ?? [];
    ips.remove(ip);
    await prefs.setStringList('printer_ips', ips);
  }

  Future<Map<String, dynamic>?> getTicketConfig(String userId) async {
    try {
      final response = await _supabase.client
          .from('menutech_tickets')
          .select()
          .eq('user_id', userId)
          .maybeSingle();
      return response;
    } catch (e) {
      return null;
    }
  }

  Future<bool> printTicket(OrderModel order, String ip) async {
    try {
      final config = await getTicketConfig(order.userId);
      final payload = _buildPayload(order, config);

      await FlutterThermalPrinterPos.printTcp(
        ip: ip,
        port: 9100,
        payload: payload,
        autoCut: true,
        openCashbox: false,
        mmFeedPaper: 20,
      );

      return true;
    } catch (e) {
      return false;
    }
  }

  String _buildPayload(OrderModel order, Map<String, dynamic>? configData) {
    StringBuffer sb = StringBuffer();

    final config = configData?['config'] as Map<String, dynamic>?;
    final header = config?['header_text'] ?? "MENUTECH";
    final footer = config?['footer_text'] ?? "Thank you for your order!\nPowered by Menutech";
    final logoUrl = config?['logo_url'] as String?;
    final showLogo = config?['show_logo'] ?? true;

    // Logo
    if (showLogo) {
      if (logoUrl != null && logoUrl.isNotEmpty) {
        sb.writeln("[I]$logoUrl");
      } else {
        sb.writeln("[I]https://menutech.services/assets/img/logomt.png");
      }
    }

    // Header
    sb.writeln("[C]<b>$header</b>");
    sb.writeln("[C]ORDER TICKET");
    sb.writeln("[C]================================");

    // Order Info
    sb.writeln("[L]Order ID: ${order.id.substring(0, 8)}");
    sb.writeln("[L]Date: ${DateFormat('yyyy-MM-dd HH:mm').format(order.createdAt)}");
    sb.writeln("[L]Type: ${order.orderType.toUpperCase()}");
    sb.writeln("[C]--------------------------------");

    // Customer Info
    sb.writeln("[L]Customer: ${order.customerName}");
    sb.writeln("[L]Phone: ${order.customerPhone}");
    if (order.address != null) {
      sb.writeln("[L]Address: ${order.address}");
    }
    if (order.reference != null) {
      sb.writeln("[L]Ref: ${order.reference}");
    }
    sb.writeln("[C]--------------------------------");

    // Items
    sb.writeln("[L]ITEMS:");
    for (var item in order.items) {
      sb.writeln("[L]${item.quantity}x ${item.name}");
      if (item.size != null) sb.writeln("[L]  Size: ${item.size}");
      if (item.toppings != null && item.toppings!.isNotEmpty) {
        sb.writeln("[L]  Toppings: ${item.toppings!.join(', ')}");
      }
      if (item.instructions != null) {
        sb.writeln("[L]  Note: ${item.instructions}");
      }
      final itemTotal = (item.total ?? (item.price * item.quantity)).toStringAsFixed(2);
      sb.writeln("[R]\$ $itemTotal");
    }

    sb.writeln("[C]--------------------------------");

    // Footer
    sb.writeln("[R]<b>TOTAL: \$${order.totalAmount.toStringAsFixed(2)}</b>");

    if (order.customerNotes != null) {
      sb.writeln("[C]--------------------------------");
      sb.writeln("[L]NOTES:");
      sb.writeln("[L]${order.customerNotes}");
    }

    sb.writeln("[C]================================");
    sb.writeln("[C]$footer");

    return sb.toString();
  }
}
