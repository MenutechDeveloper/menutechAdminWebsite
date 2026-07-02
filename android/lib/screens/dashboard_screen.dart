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
        title: Image.network('https://menutech.services/assets/img/logomt.png', height: 45),
        centerTitle: true,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8.0),
            child: IconButton(
              icon: const Icon(Icons.power_settings_new_rounded, color: Color(0xFFFF9533), size: 28),
              onPressed: () async {
                await SupabaseService().signOut();
                if (context.mounted) {
                  Navigator.of(context).pushReplacementNamed('/login');
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
                        if (isPrivileged)
                          _buildBentoCard(
                            context,
                            title: 'Menus',
                            description: 'Create and manage digital menus.',
                            icon: Icons.restaurant_menu_outlined,
                            route: '/placeholder',
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

  Widget _buildBentoCard(
    BuildContext context, {
    required String title,
    required String description,
    required IconData icon,
    required String route,
  }) {
    return InkWell(
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
    );
  }
}
