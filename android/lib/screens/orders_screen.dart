import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/unified_item.dart';
import '../services/supabase_service.dart';
import '../services/language_service.dart';
import 'order_detail_screen.dart';

class OrdersScreen extends StatefulWidget {
  static _OrdersScreenState? activeState;

  const OrdersScreen({super.key});

  static void selectPendingTab() {
    if (activeState != null && activeState!.mounted) {
      activeState!._tabController.animateTo(0);
    }
  }

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late TabController _tabController;
  final SupabaseService _supabase = SupabaseService();
  UnifiedItem? _selectedItem;

  StreamSubscription? _ordersSub;
  StreamSubscription? _resSub;
  Timer? _pollTimer;
  List<UnifiedItem> _ordersList = [];
  List<UnifiedItem> _resList = [];
  final StreamController<List<UnifiedItem>> _combinedController = StreamController<List<UnifiedItem>>.broadcast();

  @override
  void initState() {
    super.initState();
    OrdersScreen.activeState = this;
    WidgetsBinding.instance.addObserver(this);
    _tabController = TabController(length: 4, vsync: this);
    final userId = _supabase.currentUser?.id;
    if (userId != null) {
      _fetchLatestData(userId);
      _initStreams(userId);
      _pollTimer?.cancel();
      _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
        if (_supabase.currentUser?.id != null) {
          _fetchLatestData(_supabase.currentUser!.id);
        }
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      final userId = _supabase.currentUser?.id;
      if (userId != null) {
        _fetchLatestData(userId);
        _initStreams(userId);
      }
    }
  }

  Future<void> _fetchLatestData(String userId) async {
    try {
      final ordersData = await _supabase.client
          .from('menutech_orders')
          .select()
          .eq('user_id', userId)
          .order('created_at', ascending: false);

      final resData = await _supabase.client
          .from('menutech_reservations')
          .select()
          .eq('user_id', userId)
          .order('created_at', ascending: false);

      _ordersList = (ordersData as List).map((json) => UnifiedItem.fromOrderJson(json)).toList();
      _resList = (resData as List).map((json) => UnifiedItem.fromReservationJson(json)).toList();
      _emitCombined();
    } catch (e) {
      debugPrint("Error fetching latest orders/reservations: $e");
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
    if (OrdersScreen.activeState == this) {
      OrdersScreen.activeState = null;
    }
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
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

    return ValueListenableBuilder<String>(
      valueListenable: LanguageService.instance.currentLanguage,
      builder: (context, lang, child) {
        final isEs = lang == 'es';
        final titleText = isEs ? "Pedidos y Reservaciones" : "Orders & Reservations";
        final tabPending = isEs ? "Pendientes" : "Pending";
        final tabInProcess = isEs ? "En Proceso" : "In Process";
        final tabReady = isEs ? "Listo" : "Ready";
        final tabHistory = isEs ? "Historial" : "History";

        return Scaffold(
          appBar: AppBar(
            title: Text(titleText, style: const TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Outfit')),
            bottom: TabBar(
              controller: _tabController,
              isScrollable: true,
              labelColor: const Color(0xFFFF9533),
              unselectedLabelColor: Colors.grey,
              indicatorColor: const Color(0xFFFF9533),
              tabs: [
                Tab(text: tabPending),
                Tab(text: tabInProcess),
                Tab(text: tabReady),
                Tab(text: tabHistory),
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
                          child: _buildTabViews(allItems, isEs),
                        ),
                        const VerticalDivider(width: 1, color: Color(0xFFF8E8D8)),
                        Expanded(
                          child: _selectedItem == null
                            ? Center(child: Text(isEs ? "Selecciona un elemento para ver detalles" : "Select an entry to view details"))
                            : OrderDetailView(
                                item: allItems.firstWhere(
                                  (i) => i.id == _selectedItem!.id && i.entryType == _selectedItem!.entryType,
                                  orElse: () => _selectedItem!
                                ),
                                isTablet: true,
                                onStatusChanged: (targetTab) {
                                  setState(() {});
                                  _tabController.animateTo(targetTab);
                                },
                              ),
                        ),
                      ],
                    );
                  } else {
                    return _buildTabViews(allItems, isEs);
                  }
                },
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildTabViews(List<UnifiedItem> allItems, bool isEs) {
    return TabBarView(
      controller: _tabController,
      children: [
        _buildItemList(allItems.where((i) => i.status == 'pending').toList(), isEs),
        _buildItemList(allItems.where((i) => i.status == 'accepted' || i.status == 'preparing' || i.status == 'confirmed').toList(), isEs),
        _buildItemList(allItems.where((i) => i.status == 'finished' || i.status == 'ready').toList(), isEs),
        _buildItemList(allItems.where((i) => i.status == 'delivered' || i.status == 'rejected' || i.status == 'cancelled' || i.status == 'attended').toList(), isEs),
      ],
    );
  }

  Widget _buildItemList(List<UnifiedItem> items, bool isEs) {
    if (items.isEmpty) {
      return Center(child: Text(isEs ? "No hay elementos en esta sección" : "No entries in this stage", style: const TextStyle(color: Colors.grey)));
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: items.length,
      separatorBuilder: (context, index) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final item = items[index];
        final isSelected = _selectedItem?.id == item.id && _selectedItem?.entryType == item.entryType;
        final isOrd = item.entryType == EntryType.order;
        final isPending = item.status == 'pending';

        final badgeColor = isOrd ? const Color(0xFFFF9533) : const Color(0xFF8B5CF6);
        final badgeText = isOrd ? (isEs ? 'Pedido' : 'Order') : (isEs ? 'Reserva' : 'Reservation');
        final badgeIcon = isOrd ? Icons.shopping_bag_outlined : Icons.calendar_month_outlined;

        final cardWidget = Card(
          elevation: 0,
          margin: EdgeInsets.zero,
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
            onTap: () async {
              setState(() => _selectedItem = item);
              if (MediaQuery.of(context).size.width <= 720) {
                final targetTab = await Navigator.of(context).pushNamed('/order-detail', arguments: item);
                if (targetTab is int && mounted) {
                  _tabController.animateTo(targetTab);
                }
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
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: badgeColor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(badgeIcon, size: 12, color: badgeColor),
                      const SizedBox(width: 4),
                      Text(
                        badgeText,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: badgeColor,
                        ),
                      ),
                    ],
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
                isOrd
                    ? Row(
                        children: [
                          Icon(Icons.restaurant_menu_outlined, size: 13, color: Colors.grey[600]),
                          const SizedBox(width: 4),
                          Text("${item.items.length} items • \$${item.totalAmount.toStringAsFixed(2)}", style: TextStyle(fontSize: 12, color: Colors.grey[700])),
                        ],
                      )
                    : Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.calendar_today_outlined, size: 12, color: badgeColor),
                              const SizedBox(width: 3),
                              Text(item.reservationDate ?? '', style: TextStyle(fontSize: 11, color: Colors.grey[800], fontWeight: FontWeight.w600)),
                            ],
                          ),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.access_time_outlined, size: 12, color: badgeColor),
                              const SizedBox(width: 3),
                              Text(item.reservationTime ?? '', style: TextStyle(fontSize: 11, color: Colors.grey[800], fontWeight: FontWeight.w600)),
                            ],
                          ),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.people_alt_outlined, size: 12, color: badgeColor),
                              const SizedBox(width: 3),
                              Text(isEs ? "${item.partySize} pers." : "${item.partySize} guests", style: TextStyle(fontSize: 11, color: Colors.grey[800], fontWeight: FontWeight.w600)),
                            ],
                          ),
                        ],
                      ),
                const SizedBox(height: 6),
                Text(
                  DateFormat('MMM d, h:mm a').format(item.createdAt),
                  style: TextStyle(color: badgeColor, fontWeight: FontWeight.w600, fontSize: 11),
                ),
              ],
            ),
          ),
        );

        return PulsingPendingCard(
          isPending: isPending,
          pulseColor: badgeColor,
          child: cardWidget,
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
      case 'ready':
      case 'attended': return const Color(0xFFF59E0B);
      case 'finished': return const Color(0xFFFF9533);
      case 'delivered': return const Color(0xFFFF9533).withOpacity(0.6);
      case 'rejected':
      case 'cancelled': return Colors.red;
      default: return Colors.grey;
    }
  }
}

class PulsingPendingCard extends StatefulWidget {
  final Widget child;
  final bool isPending;
  final Color pulseColor;

  const PulsingPendingCard({
    super.key,
    required this.child,
    required this.isPending,
    required this.pulseColor,
  });

  @override
  State<PulsingPendingCard> createState() => _PulsingPendingCardState();
}

class _PulsingPendingCardState extends State<PulsingPendingCard> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _animation = Tween<double>(begin: 1.0, end: 1.03).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );

    if (widget.isPending) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(covariant PulsingPendingCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isPending && !_controller.isAnimating) {
      _controller.repeat(reverse: true);
    } else if (!widget.isPending && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isPending) return widget.child;

    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Transform.scale(
          scale: _animation.value,
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(
                  color: widget.pulseColor.withOpacity(0.35 * ((_animation.value - 1.0) / 0.03)),
                  blurRadius: 10 * _animation.value,
                  spreadRadius: 2 * _animation.value,
                ),
              ],
            ),
            child: widget.child,
          ),
        );
      },
    );
  }
}
