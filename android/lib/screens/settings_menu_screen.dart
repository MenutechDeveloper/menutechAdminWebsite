import 'package:flutter/material.dart';
import '../services/supabase_service.dart';
import '../services/language_service.dart';
import 'language_screen.dart';

class SettingsMenuScreen extends StatelessWidget {
  const SettingsMenuScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String>(
      valueListenable: LanguageService.instance.currentLanguage,
      builder: (context, currentLang, child) {
        final isEs = currentLang == 'es';
        final titleText = isEs ? 'Configuración' : 'Settings';
        final myMenuText = isEs ? 'Mi Menú' : 'My Menu';
        final printerText = isEs ? 'Configuración de Impresora' : 'Printer Settings';
        final languageText = isEs ? 'Idioma' : 'Language';
        final currentLangValue = isEs
            ? (currentLang == 'es' ? 'Español' : 'Inglés')
            : (currentLang == 'es' ? 'Spanish' : 'English');
        final termsText = isEs ? 'Términos y Condiciones' : 'Terms & Conditions';
        final logoutText = isEs ? 'Cerrar Sesión' : 'Logout';

        return Scaffold(
          appBar: AppBar(
            title: Text(titleText, style: const TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Outfit')),
            centerTitle: true,
          ),
          body: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              _buildMenuOption(
                context,
                icon: Icons.restaurant_menu_outlined,
                title: myMenuText,
                onTap: () => Navigator.pushNamed(context, '/menus'),
              ),
              const SizedBox(height: 16),
              _buildMenuOption(
                context,
                icon: Icons.print_outlined,
                title: printerText,
                onTap: () => Navigator.pushNamed(context, '/printer-settings'),
              ),
              const SizedBox(height: 16),
              _buildMenuOption(
                context,
                icon: Icons.language_rounded,
                title: languageText,
                subtitle: currentLangValue,
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (context) => const LanguageScreen()),
                  );
                },
              ),
              const SizedBox(height: 16),
              _buildMenuOption(
                context,
                icon: Icons.description_outlined,
                title: termsText,
                onTap: () => _showTermsDialog(context, isEs),
              ),
              const SizedBox(height: 16),
              _buildMenuOption(
                context,
                icon: Icons.logout_rounded,
                title: logoutText,
                onTap: () async {
                  final confirmed = await _showLogoutDialog(context, isEs);

                  if (confirmed == true) {
                    await SupabaseService().signOut();
                    if (context.mounted) {
                      Navigator.of(context).pushNamedAndRemoveUntil('/login', (route) => false);
                    }
                  }
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildMenuOption(
    BuildContext context, {
    required IconData icon,
    required String title,
    String? subtitle,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFF8E8D8)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.03),
              blurRadius: 15,
              offset: const Offset(0, 5),
            )
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFF9533).withOpacity(0.1),
                borderRadius: BorderRadius.circular(15),
              ),
              child: Icon(icon, color: const Color(0xFFFF9533), size: 24),
            ),
            const SizedBox(width: 20),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Color(0xFF2D2D2D)),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(fontSize: 13, color: Color(0xFFFF9533), fontWeight: FontWeight.w600),
                    ),
                  ],
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios_rounded, color: Color(0xFFD1D1D1), size: 18),
          ],
        ),
      ),
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

  void _showTermsDialog(BuildContext context, bool isEs) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(25)),
        title: Text(isEs ? 'Términos y Condiciones' : 'Terms & Conditions', style: const TextStyle(fontWeight: FontWeight.bold)),
        content: SingleChildScrollView(
          child: Text(
            isEs
                ? 'El contenido de los términos y condiciones se agregará aquí muy pronto.\n\nAl usar esta aplicación, aceptas cumplir con nuestros estándares de servicio y políticas de procesamiento de datos.'
                : 'Terms and conditions content will be added here soon.\n\nBy using this application, you agree to comply with our service standards and data processing policies.',
            style: const TextStyle(height: 1.5),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(isEs ? 'CERRAR' : 'CLOSE', style: const TextStyle(color: Color(0xFFFF9533), fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }
}
