import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/order_model.dart';
import '../models/unified_item.dart';
import '../services/supabase_service.dart';
import '../services/print_service.dart';
import '../services/language_service.dart';

class OrderDetailScreen extends StatelessWidget {
  const OrderDetailScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final args = ModalRoute.of(context)!.settings.arguments;
    late final UnifiedItem item;
    if (args is UnifiedItem) {
      item = args;
    } else if (args is OrderModel) {
      item = UnifiedItem(
        id: args.id,
        userId: args.userId,
        entryType: EntryType.order,
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        status: args.status,
        totalAmount: args.totalAmount,
        createdAt: args.createdAt,
        address: args.address,
        reference: args.reference,
        orderType: args.orderType,
        items: args.items,
        customerNotes: args.customerNotes,
        paymentMethod: args.paymentMethod,
        deliveryDate: args.deliveryDate,
        deliveryTime: args.deliveryTime,
        deliveryTimeMode: args.deliveryTimeMode,
      );
    } else {
      return const Scaffold(body: Center(child: Text("Invalid argument")));
    }

    final displayId = item.id.length > 5 ? item.id.substring(0, 5) : item.id;
    final title = item.entryType == EntryType.order ? "Order #$displayId" : "Reservation #$displayId";

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: OrderDetailView(item: item),
    );
  }
}

class OrderDetailView extends StatefulWidget {
  final UnifiedItem item;
  final bool isTablet;
  final void Function(int targetTab)? onStatusChanged;

  const OrderDetailView({
    super.key,
    required this.item,
    this.isTablet = false,
    this.onStatusChanged,
  });

  @override
  State<OrderDetailView> createState() => _OrderDetailViewState();
}

class _OrderDetailViewState extends State<OrderDetailView> {
  final SupabaseService _supabase = SupabaseService();
  final PrintService _printService = PrintService();
  bool _isUpdating = false;

  int _getTargetTab(String status) {
    switch (status) {
      case 'accepted':
      case 'preparing':
      case 'confirmed':
        return 1;
      case 'finished':
      case 'ready':
        return 2;
      case 'attended':
      case 'delivered':
      case 'rejected':
      case 'cancelled':
        return 3;
      default:
        return 0;
    }
  }

  Future<void> _sendMailgunEmailIfNeeded(UnifiedItem item, String status) async {
    final isOrderReady = item.entryType == EntryType.order && (status == 'finished' || status == 'ready');
    final isResReady = item.entryType == EntryType.reservation && (status == 'attended' || status == 'finished' || status == 'confirmed');

    if (!isOrderReady && !isResReady) return;

    try {
      final userId = _supabase.currentUser?.id ?? item.userId;
      Map<String, dynamic>? restaurantData;
      if (userId.isNotEmpty) {
        final res = await _supabase.client
            .from('menutech_restaurants')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();
        restaurantData = res;
      }

      var itemMap = item.toJson();
      itemMap['status'] = status;

      String? targetEmail = item.customerEmail;
      if (targetEmail == null || targetEmail.trim().isEmpty) {
        final table = item.entryType == EntryType.order ? 'menutech_orders' : 'menutech_reservations';
        final dbRow = await _supabase.client
            .from(table)
            .select('*')
            .eq('id', item.id)
            .maybeSingle();
        if (dbRow != null) {
          final fetchedEmail = dbRow['customer_email'] ?? dbRow['email'] ?? dbRow['customerEmail'];
          if (fetchedEmail != null && fetchedEmail.toString().trim().isNotEmpty) {
            targetEmail = fetchedEmail.toString().trim();
          }
        }
      }

      if (targetEmail != null && targetEmail.trim().isNotEmpty) {
        itemMap['customer_email'] = targetEmail.trim();
        itemMap['email'] = targetEmail.trim();
      } else {
        debugPrint("Mailgun: No recipient email specified for ${item.entryType} #${item.id}");
        return;
      }

      final payload = {
        'type': item.entryType == EntryType.order ? 'order' : 'reservation',
        'item': itemMap,
        'restaurant': restaurantData,
      };

      debugPrint("Invoking mailgun-email Edge Function with payload: $payload");
      final response = await _supabase.client.functions.invoke(
        'mailgun-email',
        body: payload,
      );
      debugPrint("Mailgun edge function response status: ${response.status}, data: ${response.data}");
    } catch (e) {
      debugPrint("Error sending Mailgun notification email: $e");
    }
  }

  Future<void> _updateOrderStatus(String id, String status) async {
    setState(() => _isUpdating = true);
    final now = DateTime.now().toIso8601String();
    final Map<String, dynamic> updates = {'status': status};

    if (status == 'accepted') {
      updates['accepted_at'] = now;
    } else if (status == 'preparing') {
      updates['preparing_at'] = now;
    } else if (status == 'finished') {
      updates['ready_at'] = now;
    } else if (status == 'delivered') {
      updates['delivered_at'] = now;
    } else if (status == 'rejected') {
      updates['rejected_at'] = now;
    }

    try {
      await _supabase.client.from('menutech_orders').update(updates).eq('id', id);

      await _sendMailgunEmailIfNeeded(widget.item, status);

      final targetTab = _getTargetTab(status);
      if (widget.onStatusChanged != null) widget.onStatusChanged!(targetTab);

      if (status == 'accepted') {
        Future.delayed(const Duration(milliseconds: 1500), () async {
          final autoUpdates = {
            'status': 'preparing',
            'preparing_at': DateTime.now().toIso8601String(),
          };
          try {
            await _supabase.client.from('menutech_orders').update(autoUpdates).eq('id', id);
            if (widget.onStatusChanged != null) widget.onStatusChanged!(1);
          } catch (_) {}
        });
      }

      if (!widget.isTablet && mounted) {
        Navigator.of(context).pop(targetTab);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
      }
    } finally {
      if (mounted) setState(() => _isUpdating = false);
    }
  }

  Future<void> _updateResStatus(String id, String status) async {
    setState(() => _isUpdating = true);
    final now = DateTime.now().toIso8601String();
    final Map<String, dynamic> updates = {'status': status, 'updated_at': now};

    try {
      await _supabase.client.from('menutech_reservations').update(updates).eq('id', id);

      await _sendMailgunEmailIfNeeded(widget.item, status);

      final targetTab = _getTargetTab(status);
      if (widget.onStatusChanged != null) widget.onStatusChanged!(targetTab);

      if (!widget.isTablet && mounted) {
        Navigator.of(context).pop(targetTab);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
      }
    } finally {
      if (mounted) setState(() => _isUpdating = false);
    }
  }

  Future<void> _showPrintDialog(UnifiedItem item) async {
    final ips = await _printService.getSavedPrinterIps();
    if (ips.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No printers configured. Go to Settings.'))
        );
      }
      return;
    }

    final orderModel = item.toOrderModel();

    if (ips.length == 1) {
      final ip = ips.first;
      final success = await _printService.printTicket(orderModel, ip);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(success ? 'Ticket printed!' : 'Printing failed.'),
            backgroundColor: success ? Colors.green : Colors.red,
          )
        );
      }
      return;
    }

    final printerNames = await _printService.getPrinterNames();

    if (mounted) {
      showDialog(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text("Select Printer"),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: ips.length,
              itemBuilder: (context, index) {
                final ip = ips[index];
                final displayName = printerNames[ip] ?? "Printer $ip";
                return ListTile(
                  leading: const Icon(Icons.print, color: Color(0xFFFF9533)),
                  title: Text(displayName),
                  subtitle: Text(ip),
                  onTap: () async {
                    Navigator.pop(context);
                    final success = await _printService.printTicket(orderModel, ip);
                    if (mounted) {
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(success ? 'Ticket printed!' : 'Printing failed.'),
                          backgroundColor: success ? Colors.green : Colors.red,
                        )
                      );
                    }
                  },
                );
              },
            ),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;

    return ValueListenableBuilder<String>(
      valueListenable: LanguageService.instance.currentLanguage,
      builder: (context, lang, child) {
        final isEs = lang == 'es';
        if (item.entryType == EntryType.order) {
          return _buildOrderView(item, isEs);
        } else {
          return _buildReservationView(item, isEs);
        }
      },
    );
  }

  bool _hasOrderActions(UnifiedItem item) {
    final s = item.status.toLowerCase();
    return s == 'pending' || s == 'accepted' || s == 'preparing' || s == 'finished';
  }

  bool _hasReservationActions(UnifiedItem item) {
    final s = item.status.toLowerCase();
    return s == 'pending' || s == 'confirmed' || s == 'ready' || s == 'finished';
  }

  Widget _buildOrderView(UnifiedItem item, bool isEs) {
    final actionButtons = _buildOrderActionButtons(item, isEs);
    final hasActions = _hasOrderActions(item);

    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.customerName, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                        Text(DateFormat('MMM d, yyyy - h:mm a').format(item.createdAt), style: const TextStyle(color: Colors.grey)),
                      ],
                    ),
                    _buildStatusTag(item.status, isReservation: false),
                  ],
                ),
                const SizedBox(height: 20),
                ElevatedButton.icon(
                  onPressed: () => _showPrintDialog(item),
                  icon: const Icon(Icons.print),
                  label: Text(isEs ? "IMPRIMIR TICKET" : "PRINT TICKET"),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFFF9533),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  ),
                ),
                const Divider(height: 40),
                _buildInfoRow(isEs ? "Teléfono" : "Phone", item.customerPhone),
                if (item.customerEmail != null) _buildInfoRow(isEs ? "Correo" : "Email", item.customerEmail!),
                _buildInfoRow(isEs ? "Tipo" : "Type", item.orderType.toUpperCase()),
                _buildInfoRow(isEs ? "Pago" : "Payment", item.paymentMethod ?? 'N/A'),
                if (item.address != null) _buildInfoRow(isEs ? "Dirección" : "Address", item.address!),
                if (item.reference != null) _buildInfoRow(isEs ? "Referencia" : "Reference", item.reference!),
                if (item.customerNotes != null) ...[
                  const SizedBox(height: 10),
                  Text(isEs ? "Notas del Cliente:" : "Customer Notes:", style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFFF9533))),
                  Text("\"${item.customerNotes}\"", style: const TextStyle(fontStyle: FontStyle.italic)),
                ],
                const SizedBox(height: 30),
                Text(isEs ? "Artículos del Pedido" : "Order Items", style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(height: 10),
                Container(
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEFEF5),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFF8E8D8)),
                  ),
                  child: Column(
                    children: item.items.map((it) => _buildItemRow(it)).toList(),
                  ),
                ),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text("Total", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                    Text("\$${item.totalAmount.toStringAsFixed(2)}",
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Color(0xFFFF9533))),
                  ],
                ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        ),
        if (hasActions)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.08),
                  blurRadius: 10,
                  offset: const Offset(0, -4),
                ),
              ],
            ),
            child: SafeArea(
              top: false,
              child: actionButtons,
            ),
          ),
      ],
    );
  }

  Widget _buildReservationView(UnifiedItem item, bool isEs) {
    final actionButtons = _buildReservationActionButtons(item, isEs);
    final hasActions = _hasReservationActions(item);

    final guestsVal = isEs ? "${item.partySize} Personas" : "${item.partySize} People";

    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.customerName, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                        Text(DateFormat('MMM d, yyyy - h:mm a').format(item.createdAt), style: const TextStyle(color: Colors.grey)),
                      ],
                    ),
                    _buildStatusTag(item.status, isReservation: true),
                  ],
                ),
                const Divider(height: 40),
                _buildInfoRow(isEs ? "Huéspedes" : "Guests", guestsVal, color: const Color(0xFF8B5CF6)),
                _buildInfoRow(isEs ? "Fecha" : "Date", item.reservationDate ?? 'N/A'),
                _buildInfoRow(isEs ? "Horario" : "Time Slot", item.reservationTime ?? 'N/A'),
                _buildInfoRow(isEs ? "Teléfono" : "Phone", item.customerPhone),
                if (item.customerEmail != null) _buildInfoRow(isEs ? "Correo" : "Email", item.customerEmail!),
                if (item.comments != null) ...[
                  const SizedBox(height: 10),
                  Text(isEs ? "Solicitudes Especiales / Comentarios:" : "Special Requests / Comments:", style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF8B5CF6))),
                  Text("\"${item.comments}\"", style: const TextStyle(fontStyle: FontStyle.italic)),
                ],
                if (item.preorderItems.isNotEmpty) ...[
                  const SizedBox(height: 30),
                  Text(isEs ? "Comida y Bebidas Pre-ordenadas" : "Pre-ordered Food & Drinks", style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 10),
                  Container(
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEFEF5),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFF8E8D8)),
                    ),
                    child: Column(
                      children: item.preorderItems.map((it) => _buildItemRow(it)).toList(),
                    ),
                  ),
                ],
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text("Total", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                    Text(item.totalAmount > 0 ? "\$${item.totalAmount.toStringAsFixed(2)}" : (isEs ? "Reserva Estándar" : "Standard Booking"),
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Color(0xFF8B5CF6))),
                  ],
                ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        ),
        if (hasActions)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.08),
                  blurRadius: 10,
                  offset: const Offset(0, -4),
                ),
              ],
            ),
            child: SafeArea(
              top: false,
              child: actionButtons,
            ),
          ),
      ],
    );
  }

  Widget _buildStatusTag(String status, {required bool isReservation}) {
    final color = isReservation ? const Color(0xFF8B5CF6) : const Color(0xFFFF9533);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Text(
        status.toUpperCase(),
        style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: TextStyle(
                color: color ?? const Color(0xFFFF9533),
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            ),
          ),
          Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }

  Widget _buildItemRow(OrderItem item) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0xFFF8E8D8))),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text("${item.quantity}x ${item.name}", style: const TextStyle(fontWeight: FontWeight.bold)),
                if (item.size != null) Text("Size: ${item.size}", style: const TextStyle(fontSize: 12, color: Colors.grey)),
                if (item.instructions != null) Text("Note: ${item.instructions}", style: const TextStyle(fontSize: 12, color: Color(0xFFFF9533))),
              ],
            ),
          ),
          Text("\$${(item.total ?? (item.price * item.quantity)).toStringAsFixed(2)}", style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildOrderActionButtons(UnifiedItem item, bool isEs) {
    if (_isUpdating) return const Center(child: CircularProgressIndicator());

    if (item.status == 'pending') {
      return Row(
        children: [
          Expanded(
            child: ElevatedButton(
              onPressed: () => _updateOrderStatus(item.id, 'rejected'),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
              child: Text(isEs ? "RECHAZAR" : "REJECT"),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: ElevatedButton(
              onPressed: () => _updateOrderStatus(item.id, 'accepted'),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF9533), foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
              child: Text(isEs ? "ACEPTAR" : "ACCEPT"),
            ),
          ),
        ],
      );
    }

    if (item.status == 'accepted' || item.status == 'preparing') {
      return SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: () => _updateOrderStatus(item.id, 'finished'),
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF9533), foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
          child: Text(isEs ? "LISTO" : "READY"),
        ),
      );
    }

    if (item.status == 'finished') {
      return SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: () => _updateOrderStatus(item.id, 'delivered'),
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF9533), foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
          child: Text(isEs ? "MARCAR ENTREGADO" : "MARK AS DELIVERED"),
        ),
      );
    }

    return Container();
  }

  Widget _buildReservationActionButtons(UnifiedItem item, bool isEs) {
    if (_isUpdating) return const Center(child: CircularProgressIndicator());

    final s = item.status.toLowerCase();

    if (s == 'pending') {
      return Row(
        children: [
          Expanded(
            child: ElevatedButton(
              onPressed: () => _updateResStatus(item.id, 'rejected'),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
              child: Text(isEs ? "RECHAZAR" : "REJECT"),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: ElevatedButton(
              onPressed: () => _updateResStatus(item.id, 'ready'),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF8B5CF6), foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
              child: Text(isEs ? "ACEPTAR" : "ACCEPT"),
            ),
          ),
        ],
      );
    }

    if (s == 'confirmed' || s == 'ready' || s == 'finished') {
      return Row(
        children: [
          Expanded(
            child: ElevatedButton(
              onPressed: () => _updateResStatus(item.id, 'cancelled'),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
              child: Text(isEs ? "CANCELÓ" : "CANCELLED"),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: ElevatedButton(
              onPressed: () => _updateResStatus(item.id, 'attended'),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
              child: Text(isEs ? "ASISTIÓ" : "ATTENDED"),
            ),
          ),
        ],
      );
    }

    return Container();
  }
}
