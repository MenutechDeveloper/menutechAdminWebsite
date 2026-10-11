import 'package:flutter/material.dart';
import '../services/supabase_service.dart';

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
                final confirmed = await _showLogoutDialog(context);
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
                  const Text(
                    'Welcome to your dashboard',
                    style: TextStyle(color: Colors.grey, fontSize: 16),
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
                            title: 'Deluxe Website',
                            description: 'Customize your gallery and manage domain content.',
                            icon: Icons.web_outlined,
                            route: '/placeholder',
                          ),
                        if (isPrivileged)
                          _buildBentoCard(
                            context,
                            title: 'Template Web',
                            description: 'Customize and export your professional website.',
                            icon: Icons.language_outlined,
                            route: '/placeholder',
                          ),
                        _buildBentoCard(
                          context,
                          title: 'My Menu',
                          description: 'Create and manage digital menus.',
                          icon: Icons.restaurant_menu_outlined,
                          route: '/menus',
                        ),
                        _buildBentoCard(
                          context,
                          title: 'Orders',
                          description: 'Manage incoming restaurant orders in real-time.',
                          icon: Icons.shopping_bag_outlined,
                          route: '/orders',
                        ),
                        _buildBentoCard(
                          context,
                          title: 'Printer Settings',
                          description: 'Configure and manage your Epson printers.',
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
  }

  Future<bool?> _showLogoutDialog(BuildContext context) {
    return showDialog<bool>(
      context: context,
      builder: (context) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        elevation: 10,
        backgroundColor: Colors.white,
        child: Padding(
          padding: const EdgeInsets.all(28.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 70,
                height: 70,
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF3E0),
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFFFFE0B2), width: 1.5),
                ),
                child: const Icon(
                  Icons.logout_rounded,
                  color: Color(0xFFFF9533),
                  size: 34,
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'Sign Out',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  fontFamily: 'Outfit',
                  color: Color(0xFF2D2D2D),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Are you sure you want to log out of your Menutech account?',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey.shade700,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 28),
              Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 52,
                      child: OutlinedButton(
                        onPressed: () => Navigator.pop(context, false),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.grey.shade800,
                          side: BorderSide(color: Colors.grey.shade300),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(18),
                          ),
                        ),
                        child: const Text(
                          'Cancel',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                            fontFamily: 'Outfit',
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: SizedBox(
                      height: 52,
                      child: ElevatedButton(
                        onPressed: () => Navigator.pop(context, true),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFFF9533),
                          foregroundColor: Colors.black,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(18),
                          ),
                        ),
                        child: const Text(
                          'Sign Out',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                            fontFamily: 'Outfit',
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
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
