import 'package:flutter/material.dart';
import 'orders_screen.dart';
import 'settings_menu_screen.dart';
import '../services/order_notification_service.dart';
import '../widgets/chatbot_widget.dart';

class MainScreen extends StatefulWidget {
  static _MainScreenState? activeState;

  const MainScreen({super.key});

  static void selectOrdersTab() {
    activeState?.switchTab(0);
  }

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  int _selectedIndex = 0;

  final List<Widget> _screens = [
    const OrdersScreen(),
    const SettingsMenuScreen(),
  ];

  @override
  void initState() {
    super.initState();
    MainScreen.activeState = this;
    OrderNotificationService.instance.init();
  }

  @override
  void dispose() {
    if (MainScreen.activeState == this) {
      MainScreen.activeState = null;
    }
    super.dispose();
  }

  void switchTab(int index) {
    if (mounted) {
      setState(() {
        _selectedIndex = index;
      });
    }
  }

  void _onItemTapped(int index) {
    switchTab(index);
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
              icon: Icon(Icons.receipt_long_rounded),
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
