import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/unified_item.dart';
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
  UnifiedItem? _selectedItem;

  StreamSubscription? _ordersSub;
  StreamSubscription? _resSub;
  List<UnifiedItem> _ordersList = [];
  List<UnifiedItem> _resList = [];
  final StreamController<List<UnifiedItem>> _combinedController = StreamController<List<UnifiedItem>>.broadcast();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    final userId = _supabase.currentUser?.id;
    if (userId != null) {
      _initStreams(userId);
    }
  }

  void _initStreams(String userId) {
    _ordersSub?.cancel();
    _resSub?.cancel();

    _ordersSub = _supabase.client
        .from('menutech_orders')
        .stream(primaryKey: ['id'])
        .eq('user_id', userId)
        .order('created_at', ascending: false)
        .listen((data) {
      _ordersList = data.map((json) => UnifiedItem.fromOrderJson(json)).toList();
      _emitCombined();
    }, onError: (err) {
      debugPrint("Orders stream error: $err");
    });

    _resSub = _supabase.client
        .from('menutech_reservations')
        .stream(primaryKey: ['id'])
        .eq('user_id', userId)
        .order('created_at', ascending: false)
        .listen((data) {
      _resList = data.map((json) => UnifiedItem.fromReservationJson(json)).toList();
      _emitCombined();
    }, onError: (err) {
      debugPrint("Reservations stream error: $err");
    });
  }

  void _emitCombined() {
    final combined = [..._ordersList, ..._resList];
    combined.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    if (!_combinedController.isClosed) {
      _combinedController.add(combined);
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    _ordersSub?.cancel();
    _resSub?.cancel();
    _combinedController.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final userId = _supabase.currentUser?.id;
    if (userId == null) return const Scaffold(body: Center(child: Text("Not logged in")));

    return Scaffold(
      appBar: AppBar(
        title: const Text("Orders & Reservations", style: TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Outfit')),
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
      body: StreamBuilder<List<UnifiedItem>>(
        stream: _combinedController.stream,
        builder: (context, snapshot) {
          if (snapshot.hasError) return Center(child: Text("Error: ${snapshot.error}"));
          if (!snapshot.hasData && _ordersList.isEmpty && _resList.isEmpty) {
            return const Center(child: CircularProgressIndicator(color: Color(0xFFFF9533)));
          }

          final allItems = snapshot.data ?? [..._ordersList, ..._resList];

          return LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth > 720) {
                return Row(
                  children: [
                    SizedBox(
                      width: 350,
                      child: _buildTabViews(allItems),
                    ),
                    const VerticalDivider(width: 1, color: Color(0xFFF8E8D8)),
                    Expanded(
                      child: _selectedItem == null
                        ? const Center(child: Text("Select an entry to view details"))
                        : OrderDetailView(
                            item: allItems.firstWhere(
                              (i) => i.id == _selectedItem!.id && i.entryType == _selectedItem!.entryType,
                              orElse: () => _selectedItem!
                            ),
                            isTablet: true,
                            onStatusChanged: () {
                              setState(() {});
                            },
                          ),
                    ),
                  ],
                );
              } else {
                return _buildTabViews(allItems);
              }
            },
          );
        },
      ),
    );
  }

  Widget _buildTabViews(List<UnifiedItem> allItems) {
    return TabBarView(
      controller: _tabController,
      children: [
        _buildItemList(allItems.where((i) => i.status == 'pending').toList()),
        _buildItemList(allItems.where((i) => i.status == 'accepted' || i.status == 'preparing' || i.status == 'confirmed').toList()),
        _buildItemList(allItems.where((i) => i.status == 'finished' || i.status == 'attended').toList()),
        _buildItemList(allItems.where((i) => i.status == 'delivered' || i.status == 'rejected' || i.status == 'cancelled').toList()),
      ],
    );
  }

  Widget _buildItemList(List<UnifiedItem> items) {
    if (items.isEmpty) {
      return const Center(child: Text("No entries in this stage", style: TextStyle(color: Colors.grey)));
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: items.length,
      separatorBuilder: (context, index) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final item = items[index];
        final isSelected = _selectedItem?.id == item.id && _selectedItem?.entryType == item.entryType;
        final isOrd = item.entryType == EntryType.order;

        final badgeColor = isOrd ? const Color(0xFFFF9533) : const Color(0xFF8B5CF6);
        final badgeLabel = isOrd ? '🛒 Order' : '📅 Reservation';

        final subDetails = isOrd
            ? "${item.items.length} items • \$${item.totalAmount.toStringAsFixed(2)}"
            : "📅 ${item.reservationDate ?? ''} • ⏰ ${item.reservationTime ?? ''} • 👥 ${item.partySize} guests";

        return Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: BorderSide(
              color: isSelected ? badgeColor : const Color(0xFFF8E8D8),
              width: isSelected ? 2 : 1,
            ),
          ),
          color: isSelected ? badgeColor.withOpacity(0.05) : Colors.white,
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            onTap: () {
              setState(() => _selectedItem = item);
              if (MediaQuery.of(context).size.width <= 720) {
                Navigator.of(context).pushNamed('/order-detail', arguments: item);
              }
            },
            leading: Container(
              width: 8,
              height: double.infinity,
              decoration: BoxDecoration(
                color: _getStatusColor(item.status),
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: badgeColor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    badgeLabel,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: badgeColor,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    item.customerName,
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 6),
                Text(subDetails, style: const TextStyle(fontSize: 12, color: Colors.grey)),
                const SizedBox(height: 4),
                Text(
                  DateFormat('MMM d, h:mm a').format(item.createdAt),
                  style: TextStyle(color: badgeColor, fontWeight: FontWeight.w600, fontSize: 11),
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
      case 'confirmed': return Colors.green;
      case 'preparing':
      case 'attended': return const Color(0xFFF59E0B);
      case 'finished': return const Color(0xFFFF9533);
      case 'delivered': return const Color(0xFFFF9533).withOpacity(0.6);
      case 'rejected':
      case 'cancelled': return Colors.red;
      default: return Colors.grey;
    }
  }
}
