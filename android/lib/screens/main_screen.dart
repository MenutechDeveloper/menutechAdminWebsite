import 'dart:async';
import 'package:flutter/material.dart';
import 'dashboard_screen.dart';
import 'settings_menu_screen.dart';
import '../services/supabase_service.dart';
import '../widgets/chatbot_widget.dart';

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  int _selectedIndex = 0;
  StreamSubscription? _ordersSubscription;
  final Set<String> _notifiedOrderIds = {};

  final List<Widget> _screens = [
    const DashboardScreen(),
    const SettingsMenuScreen(),
  ];

  @override
  void initState() {
    super.initState();
    _initGlobalOrderStream();
  }

  void _initGlobalOrderStream() {
    final user = SupabaseService().currentUser;
    if (user == null) return;

    _ordersSubscription = SupabaseService()
        .client
        .from('menutech_orders')
        .stream(primaryKey: ['id'])
        .eq('user_id', user.id)
        .listen((orders) {
      for (var orderMap in orders) {
        final status = (orderMap['status'] ?? '').toString().toLowerCase();
        final id = (orderMap['id'] ?? '').toString();

        if (status == 'pending' && id.isNotEmpty && !_notifiedOrderIds.contains(id)) {
          _notifiedOrderIds.add(id);
          final customerName = orderMap['customer_name'] ?? orderMap['customerName'] ?? 'a customer';
          final totalAmount = orderMap['total_amount'] ?? orderMap['totalAmount'] ?? 0;

          ChatbotWidget.notifyNewOrder({
            'id': id,
            'customerName': customerName,
            'totalAmount': totalAmount,
            'status': status,
          });
        } else if (status != 'pending' && id.isNotEmpty && _notifiedOrderIds.contains(id)) {
          ChatbotWidget.notifyOrderUpdated(id, status);
        }
      }
    });
  }

  @override
  void dispose() {
    _ordersSubscription?.cancel();
    super.dispose();
  }

  void _onItemTapped(int index) {
    setState(() {
      _selectedIndex = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          IndexedStack(
            index: _selectedIndex,
            children: _screens,
          ),
          const Positioned(
            right: 0,
            bottom: 0,
            child: ChatbotWidget(),
          ),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, -5),
            ),
          ],
        ),
        child: BottomNavigationBar(
          items: const <BottomNavigationBarItem>[
            BottomNavigationBarItem(
              icon: Icon(Icons.restaurant_menu),
              label: '',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.settings),
              label: '',
            ),
          ],
          currentIndex: _selectedIndex,
          selectedItemColor: const Color(0xFFFF9533),
          unselectedItemColor: Colors.grey,
          showSelectedLabels: false,
          showUnselectedLabels: false,
          onTap: _onItemTapped,
          type: BottomNavigationBarType.fixed,
          backgroundColor: Colors.white,
          elevation: 0,
        ),
      ),
    );
  }
}
