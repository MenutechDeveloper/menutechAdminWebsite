import 'package:flutter/material.dart';
import '../services/supabase_service.dart';
import '../services/language_service.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Map<String, dynamic>? _profile;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    final user = SupabaseService().currentUser;
    if (user != null) {
      final profile = await SupabaseService().getUserProfile(user.id);
      if (mounted) {
        setState(() {
          _profile = profile;
          _isLoading = false;
        });
      }
    } else {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final String role = (_profile?['role'] ?? 'OWNER').toString().toUpperCase();
    final bool isPrivileged = ['ADMIN', 'DEVELOPER', 'CS', 'ADMINCS'].contains(role);
    final String restaurantName = _profile?['username'] ?? 'Restaurant';

    return ValueListenableBuilder<String>(
      valueListenable: LanguageService.instance.currentLanguage,
      builder: (context, lang, child) {
        final isEs = lang == 'es';

        return Scaffold(
          appBar: AppBar(
            title: Image.network('https://menutech.io/assets/menutech.png', height: 45, errorBuilder: (c, e, s) => const Text('Menutech', style: TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Outfit'))),
            centerTitle: true,
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 8.0),
                child: IconButton(
                  icon: const Icon(Icons.power_settings_new_rounded, color: Color(0xFFFF9533), size: 28),
                  onPressed: () async {
                    final confirmed = await _showLogoutDialog(context, isEs);
                    if (confirmed == true) {
                      await SupabaseService().signOut();
                      if (context.mounted) {
                        Navigator.of(context).pushNamedAndRemoveUntil('/login', (route) => false);
                      }
                    }
                  },
                ),
              )
            ],
          ),
          body: _isLoading
              ? const Center(child: CircularProgressIndicator(color: Color(0xFFFF9533)))
              : Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        restaurantName,
                        style: const TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.bold,
                          fontFamily: 'Outfit',
                        ),
                      ),
                      Text(
                        isEs ? 'Bienvenido a tu panel' : 'Welcome to your dashboard',
                        style: const TextStyle(color: Colors.grey, fontSize: 16),
                      ),
                      const SizedBox(height: 30),
                      Expanded(
                        child: GridView.count(
                          crossAxisCount: MediaQuery.of(context).size.width > 600 ? 2 : 1,
                          mainAxisSpacing: 20,
                          crossAxisSpacing: 20,
                          childAspectRatio: 2.5,
                          padding: const EdgeInsets.only(bottom: 90),
                          children: [
                            if (isPrivileged)
                              _buildBentoCard(
                                context,
                                title: isEs ? 'Sitio Web Deluxe' : 'Deluxe Website',
                                description: isEs ? 'Personaliza tu galería y administra el contenido del dominio.' : 'Customize your gallery and manage domain content.',
                                icon: Icons.web_outlined,
                                route: '/placeholder',
                              ),
                            if (isPrivileged)
                              _buildBentoCard(
                                context,
                                title: isEs ? 'Plantilla Web' : 'Template Web',
                                description: isEs ? 'Personaliza y exporta tu sitio web profesional.' : 'Customize and export your professional website.',
                                icon: Icons.language_outlined,
                                route: '/placeholder',
                              ),
                            _buildBentoCard(
                              context,
                              title: isEs ? 'Mi Menú' : 'My Menu',
                              description: isEs ? 'Crea y administra tus menús digitales.' : 'Create and manage digital menus.',
                              icon: Icons.restaurant_menu_outlined,
                              route: '/menus',
                            ),
                            _buildBentoCard(
                              context,
                              title: isEs ? 'Pedidos' : 'Orders',
                              description: isEs ? 'Administra los pedidos entrantes del restaurante en tiempo real.' : 'Manage incoming restaurant orders in real-time.',
                              icon: Icons.shopping_bag_outlined,
                              route: '/orders',
                            ),
                            _buildBentoCard(
                              context,
                              title: isEs ? 'Ajustes de Impresora' : 'Printer Settings',
                              description: isEs ? 'Configura y administra tus impresoras Epson.' : 'Configure and manage your Epson printers.',
                              icon: Icons.print_outlined,
                              route: '/printer-settings',
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
        );
      },
    );
  }

  Future<bool?> _showLogoutDialog(BuildContext context, bool isEs) {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        backgroundColor: Colors.white,
        title: Text(
          isEs ? 'Cerrar Sesión' : 'Sign Out',
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            fontFamily: 'Outfit',
            color: Color(0xFF2D2D2D),
          ),
        ),
        content: Text(
          isEs ? '¿Estás seguro de que deseas cerrar sesión?' : 'Are you sure you want to sign out?',
          style: const TextStyle(
            fontSize: 14,
            color: Color(0xFF4A5568),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(
              isEs ? 'Cancelar' : 'Cancel',
              style: TextStyle(
                color: Colors.grey.shade700,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              isEs ? 'Cerrar Sesión' : 'Sign Out',
              style: const TextStyle(
                color: Color(0xFFFF9533),
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBentoCard(
    BuildContext context, {
    required String title,
    required String description,
    required IconData icon,
    required String route,
  }) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(40),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        borderRadius: BorderRadius.circular(40),
        onTap: () {
          if (route == '/placeholder') {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Module coming soon to native app. Use web version for now.'))
            );
          } else {
            Navigator.of(context).pushNamed(route);
          }
        },
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(40),
            border: Border.all(color: const Color(0xFFF8E8D8)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.05),
                blurRadius: 20,
                offset: const Offset(0, 10),
              )
            ],
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFFF9533).withOpacity(0.1),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Icon(icon, color: const Color(0xFFFF9533), size: 32),
              ),
              const SizedBox(width: 20),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      description,
                      style: const TextStyle(color: Colors.grey, fontSize: 12),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
