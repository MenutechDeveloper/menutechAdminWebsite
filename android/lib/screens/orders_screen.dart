import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:audioplayers/audioplayers.dart';
import '../models/order_model.dart';
import '../services/supabase_service.dart';
import 'order_detail_screen.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final SupabaseService _supabase = SupabaseService();
  final AudioPlayer _audioPlayer = AudioPlayer();

  OrderModel? _selectedOrder;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _audioPlayer.setReleaseMode(ReleaseMode.loop);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _audioPlayer.dispose();
    super.dispose();
  }

  void _updateAlertSound(bool shouldPlay) async {
    if (shouldPlay) {
      if (_audioPlayer.state != PlayerState.playing) {
        await _audioPlayer.play(UrlSource('https://menutech.services/assets/audio/notification.mp3'));
      }
    } else {
      if (_audioPlayer.state == PlayerState.playing) {
        await _audioPlayer.stop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final userId = _supabase.currentUser?.id;
    if (userId == null) return const Scaffold(body: Center(child: Text("Not logged in")));

    return Scaffold(
      appBar: AppBar(
        title: const Text("Orders", style: TextStyle(fontWeight: FontWeight.bold)),
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          labelColor: const Color(0xFFFF9533),
          unselectedLabelColor: Colors.grey,
          indicatorColor: const Color(0xFFFF9533),
          tabs: const [
            Tab(text: "Pending"),
            Tab(text: "In Process"),
            Tab(text: "Ready"),
            Tab(text: "History"),
          ],
        ),
      ),
      body: StreamBuilder<List<Map<String, dynamic>>>(
        stream: _supabase.client
            .from('menutech_orders')
            .stream(primaryKey: ['id'])
            .eq('user_id', userId)
            .order('created_at', ascending: false),
        builder: (context, snapshot) {
          if (snapshot.hasError) return Center(child: Text("Error: ${snapshot.error}"));
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());

          final allOrders = snapshot.data!.map((json) => OrderModel.fromJson(json)).toList();

          final pendingCount = allOrders.where((o) => o.status == 'pending').length;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _updateAlertSound(pendingCount > 0);
          });

          return LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth > 720) {
                return Row(
                  children: [
                    SizedBox(
                      width: 350,
                      child: _buildTabViews(allOrders),
                    ),
                    const VerticalDivider(width: 1, color: Color(0xFFF8E8D8)),
                    Expanded(
                      child: _selectedOrder == null
                        ? const Center(child: Text("Select an order to view details"))
                        : OrderDetailView(
                            order: allOrders.firstWhere(
                              (o) => o.id == _selectedOrder!.id,
                              orElse: () => _selectedOrder!
                            ),
                            isTablet: true,
                            onStatusChanged: () {
                              // Optional: handle something after status change
                            },
                          ),
                    ),
                  ],
                );
              } else {
                return _buildTabViews(allOrders);
              }
            },
          );
        },
      ),
    );
  }

  Widget _buildTabViews(List<OrderModel> allOrders) {
    return TabBarView(
      controller: _tabController,
      children: [
        _buildOrderList(allOrders.where((o) => o.status == 'pending').toList()),
        _buildOrderList(allOrders.where((o) => o.status == 'accepted' || o.status == 'preparing').toList()),
        _buildOrderList(allOrders.where((o) => o.status == 'finished').toList()),
        _buildOrderList(allOrders.where((o) => o.status == 'delivered' || o.status == 'rejected').toList()),
      ],
    );
  }

  Widget _buildOrderList(List<OrderModel> orders) {
    if (orders.isEmpty) {
      return const Center(child: Text("No orders in this stage", style: TextStyle(color: Colors.grey)));
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: orders.length,
      separatorBuilder: (context, index) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final order = orders[index];
        final isSelected = _selectedOrder?.id == order.id;

        return Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: BorderSide(
              color: isSelected ? const Color(0xFFFF9533) : const Color(0xFFF8E8D8),
              width: isSelected ? 2 : 1,
            ),
          ),
          color: isSelected ? const Color(0xFFFF9533).withOpacity(0.05) : Colors.white,
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            onTap: () {
              setState(() => _selectedOrder = order);
              if (MediaQuery.of(context).size.width <= 720) {
                Navigator.of(context).pushNamed('/order-detail', arguments: order);
              }
            },
            leading: Container(
              width: 8,
              height: double.infinity,
              decoration: BoxDecoration(
                color: _getStatusColor(order.status),
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            title: Text(
              order.customerName,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 4),
                Text("${order.items.length} items • \$${order.totalAmount.toStringAsFixed(2)}", style: const TextStyle(fontSize: 12)),
                const SizedBox(height: 4),
                Text(
                  DateFormat('MMM d, h:mm a').format(order.createdAt),
                  style: const TextStyle(color: Color(0xFFFF9533), fontWeight: FontWeight.w600, fontSize: 11),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'pending': return const Color(0xFFFF9533);
      case 'accepted':
      case 'preparing':
      case 'finished': return const Color(0xFFFF9533);
      case 'delivered': return const Color(0xFFFF9533).withOpacity(0.6);
      case 'rejected': return Colors.red;
      default: return Colors.grey;
    }
  }
}
