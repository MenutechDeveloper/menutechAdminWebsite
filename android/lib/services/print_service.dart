import 'dart:async';
import 'dart:convert';
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

  Future<Map<String, String>> getPrinterNames() async {
    final prefs = await SharedPreferences.getInstance();
    final jsonStr = prefs.getString('printer_names');
    if (jsonStr == null) return {};
    try {
      final Map<String, dynamic> decoded = jsonDecode(jsonStr);
      return decoded.map((key, value) => MapEntry(key, value.toString()));
    } catch (e) {
      return {};
    }
  }

  Future<void> savePrinterName(String ip, String name) async {
    final prefs = await SharedPreferences.getInstance();
    final names = await getPrinterNames();
    names[ip] = name;
    await prefs.setString('printer_names', jsonEncode(names));
  }

  Future<void> removePrinterName(String ip) async {
    final prefs = await SharedPreferences.getInstance();
    final names = await getPrinterNames();
    if (names.containsKey(ip)) {
      names.remove(ip);
      await prefs.setString('printer_names', jsonEncode(names));
    }
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

  Future<bool> testConnection(String ip) async {
    try {
      final socket = await Socket.connect(ip, 9100, timeout: const Duration(seconds: 2));
      socket.destroy();
      return true;
    } catch (e) {
      return false;
    }
  }

  Future<List<String>> discoverPrinters() async {
    List<String> discoveredIps = [];

    // Request permissions but do not block execution if they are not fully granted
    try {
      await [
        Permission.locationWhenInUse,
        Permission.nearbyWifiDevices,
      ].request();
    } catch (e) {
      print("Permission request failed: $e");
    }

    final info = NetworkInfo();
    String? wifiIP;
    try {
      wifiIP = await info.getWifiIP();
    } catch (e) {
      print("Failed to get wifi IP: $e");
    }

    // Robust fallback: use network interfaces if getWifiIP is null or empty
    if (wifiIP == null || wifiIP.isEmpty) {
      try {
        final interfaces = await NetworkInterface.list(
          includeLoopback: false,
          type: InternetAddressType.IPv4,
        );
        for (var interface in interfaces) {
          for (var addr in interface.addresses) {
            if (!addr.isLoopback && addr.address.startsWith('192.168.')) {
              wifiIP = addr.address;
              break;
            }
          }
          if (wifiIP != null) break;
        }
        if (wifiIP == null && interfaces.isNotEmpty) {
          for (var interface in interfaces) {
            for (var addr in interface.addresses) {
              if (!addr.isLoopback && !addr.address.startsWith('127.')) {
                wifiIP = addr.address;
                break;
              }
            }
            if (wifiIP != null) break;
          }
        }
      } catch (e) {
        print("Failed to get network interfaces: $e");
      }
    }

    if (wifiIP == null || !wifiIP.contains('.')) {
      print("No valid local IP/subnet detected.");
      return [];
    }

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
      final socket = await Socket.connect(host, 9100, timeout: const Duration(milliseconds: 1500));
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
    await removePrinterName(ip);

    // Also update Supabase remote IP so it doesn't resurrect deleted IP
    final user = _supabase.currentUser;
    if (user != null) {
      try {
        final String? newRemoteIp = ips.isNotEmpty ? ips.first : null;
        await _supabase.client.from('menutech_tickets').upsert({
          'user_id': user.id,
          'printer_ip': newRemoteIp,
          'updated_at': DateTime.now().toIso8601String(),
        }, onConflict: 'user_id');
      } catch (e) {
        print("Error updating Supabase after printer deletion: $e");
      }
    }
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

      print("Attempting printTcp to IP: $ip, payload length: ${payload.length}");
      await FlutterThermalPrinterPos.printTcp(
        ip: ip,
        port: 9100,
        payload: payload,
        autoCut: true,
        openCashbox: false,
        mmFeedPaper: 20,
      );

      print("printTcp call completed successfully for IP: $ip");
      return true;
    } catch (e, stack) {
      print("Error printing ticket to $ip: $e");
      print(stack);
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
        sb.writeln("[C]<img>$logoUrl</img>");
      } else {
        sb.writeln("[C]<img>https://menutech.services/assets/img/logomt.png</img>");
      }
    }

    // Header
    sb.writeln("[C]<b>$header</b>");
    sb.writeln("[C]ORDER TICKET");
    sb.writeln("[C]================================");

    // Order Info
    final displayId = order.id.length > 8 ? order.id.substring(0, 8) : order.id;
    sb.writeln("[L]Order ID: $displayId");
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
      final itemTotal = (item.total ?? (item.price * item.quantity)).toStringAsFixed(2);
      sb.writeln("[L]${item.quantity}x ${item.name}[R]\$ $itemTotal");

      if (item.size != null) sb.writeln("[L]  Size: ${item.size}");
      if (item.toppings != null && item.toppings!.isNotEmpty) {
        sb.writeln("[L]  Toppings: ${item.toppings!.join(', ')}");
      }
      if (item.instructions != null) {
        sb.writeln("[L]  Note: ${item.instructions}");
      }
    }

    sb.writeln("[C]--------------------------------");

    // Footer
    sb.writeln("[L]<b>TOTAL</b>[R]<b>\$${order.totalAmount.toStringAsFixed(2)}</b>");

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
