import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/order_model.dart';
import '../services/supabase_service.dart';
import '../services/print_service.dart';

class OrderDetailScreen extends StatelessWidget {
  const OrderDetailScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final order = ModalRoute.of(context)!.settings.arguments as OrderModel;
    return Scaffold(
      appBar: AppBar(title: Text("Order #${order.id.substring(0, 5)}")),
      body: OrderDetailView(order: order),
    );
  }
}

class OrderDetailView extends StatefulWidget {
  final OrderModel order;
  final bool isTablet;
  final VoidCallback? onStatusChanged;

  const OrderDetailView({
    super.key,
    required this.order,
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

  Future<void> _updateStatus(String id, String status) async {
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
      if (widget.onStatusChanged != null) widget.onStatusChanged!();
      if (!widget.isTablet && mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
      }
    } finally {
      if (mounted) setState(() => _isUpdating = false);
    }
  }

  Future<void> _showPrintDialog(OrderModel order) async {
    final ips = await _printService.getSavedPrinterIps();
    if (ips.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No printers configured. Go to Settings.'))
        );
      }
      return;
    }

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
              itemBuilder: (context, index) => ListTile(
                title: Text(ips[index]),
                onTap: () async {
                  Navigator.pop(context);
                  final success = await _printService.printTicket(order, ips[index]);
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
              ),
            ),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = widget.order;

    return SingleChildScrollView(
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
                  Text(order.customerName, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                  Text(DateFormat('MMM d, yyyy - h:mm a').format(order.createdAt), style: const TextStyle(color: Colors.grey)),
                ],
              ),
              _buildStatusTag(order.status),
            ],
          ),
          const SizedBox(height: 20),
          ElevatedButton.icon(
            onPressed: () => _showPrintDialog(order),
            icon: const Icon(Icons.print),
            label: const Text("PRINT TICKET"),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF9533),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            ),
          ),
          const Divider(height: 40),
          _buildInfoRow("Phone", order.customerPhone),
          _buildInfoRow("Type", order.orderType.toUpperCase()),
          _buildInfoRow("Payment", order.paymentMethod ?? 'N/A'),
          if (order.address != null) _buildInfoRow("Address", order.address!),
          if (order.reference != null) _buildInfoRow("Reference", order.reference!),
          if (order.customerNotes != null) ...[
            const SizedBox(height: 10),
            const Text("Customer Notes:", style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFFF9533))),
            Text("\"${order.customerNotes}\"", style: const TextStyle(fontStyle: FontStyle.italic)),
          ],
          const SizedBox(height: 30),
          const Text("Order Items", style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 10),
          Container(
            decoration: BoxDecoration(
              color: const Color(0xFFFEFEF5),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFF8E8D8)),
            ),
            child: Column(
              children: order.items.map((item) => _buildItemRow(item)).toList(),
            ),
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text("Total", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
              Text("\$${order.totalAmount.toStringAsFixed(2)}",
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Color(0xFFFF9533))),
            ],
          ),
          const SizedBox(height: 40),
          _buildActionButtons(order),
        ],
      ),
    );
  }

  Widget _buildStatusTag(String status) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFFF9533).withOpacity(0.1),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Text(
        status.toUpperCase(),
        style: const TextStyle(color: Color(0xFFFF9533), fontWeight: FontWeight.bold, fontSize: 12),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 100, child: Text(label, style: const TextStyle(color: Color(0xFFFF9533), fontWeight: FontWeight.bold, fontSize: 12))),
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

  Widget _buildActionButtons(OrderModel order) {
    if (_isUpdating) return const Center(child: CircularProgressIndicator());

    if (order.status == 'pending') {
      return Row(
        children: [
          Expanded(
            child: ElevatedButton(
              onPressed: () => _updateStatus(order.id, 'rejected'),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
              child: const Text("REJECT"),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: ElevatedButton(
              onPressed: () => _updateStatus(order.id, 'accepted'),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF9533), foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
              child: const Text("ACCEPT"),
            ),
          ),
        ],
      );
    }

    if (order.status == 'accepted') {
      return SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: () => _updateStatus(order.id, 'preparing'),
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF9533), foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
          child: const Text("PREPARE"),
        ),
      );
    }

    if (order.status == 'preparing') {
      return SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: () => _updateStatus(order.id, 'finished'),
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF9533), foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
          child: const Text("READY"),
        ),
      );
    }

    if (order.status == 'finished') {
      return SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: () => _updateStatus(order.id, 'delivered'),
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF9533), foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
          child: const Text("MARK AS DELIVERED"),
        ),
      );
    }

    return Container();
  }
}
