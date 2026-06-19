import 'package:intl/intl.dart';
import '../models/order_model.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_thermal_printer_pos/flutter_thermal_printer_pos.dart';

class PrintService {
  static final PrintService _instance = PrintService._internal();
  factory PrintService() => _instance;
  PrintService._internal();

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
  }

  Future<void> removePrinterIp(String ip) async {
    final prefs = await SharedPreferences.getInstance();
    final ips = prefs.getStringList('printer_ips') ?? [];
    ips.remove(ip);
    await prefs.setStringList('printer_ips', ips);
  }

  Future<bool> printTicket(OrderModel order, String ip) async {
    try {
      final payload = _buildPayload(order);

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
      // Production code should use proper logging
      return false;
    }
  }

  String _buildPayload(OrderModel order) {
    StringBuffer sb = StringBuffer();

    // Header
    sb.writeln("[C]<b>MENUTECH</b>");
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
    sb.writeln("[C]Thank you for your order!");
    sb.writeln("[C]Powered by Menutech");

    return sb.toString();
  }
}
