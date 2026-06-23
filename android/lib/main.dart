import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'core/config.dart';
import 'screens/login_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/orders_screen.dart';
import 'screens/order_detail_screen.dart';
import 'screens/settings_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    anonKey: AppConfig.supabaseAnonKey,
  );

  runApp(const MenutechAdminApp());
}

class MenutechAdminApp extends StatelessWidget {
  const MenutechAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Menutech Admin',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFF9533),
          primary: const Color(0xFFFF9533),
        ),
        useMaterial3: true,
        fontFamily: 'Plus Jakarta Sans',
        scaffoldBackgroundColor: const Color(0xFFFFFCF0),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFFFFFCF0),
          elevation: 0,
          scrolledUnderElevation: 0,
        ),
      ),
      initialRoute: Supabase.instance.client.auth.currentSession == null ? '/login' : '/dashboard',
      routes: {
        '/login': (context) => const LoginScreen(),
        '/dashboard': (context) => const DashboardScreen(),
        '/orders': (context) => const OrdersScreen(),
        '/order-detail': (context) => const OrderDetailScreen(),
        '/settings': (context) => const SettingsScreen(),
      },
    );
  }
}
