import 'package:flutter/material.dart';
import '../services/language_service.dart';

class LanguageScreen extends StatelessWidget {
  const LanguageScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String>(
      valueListenable: LanguageService.instance.currentLanguage,
      builder: (context, currentLang, child) {
        final isEs = currentLang == 'es';
        final title = isEs ? 'Idioma' : 'Language';
        final englishLabel = isEs ? 'Inglés' : 'English';
        final spanishLabel = isEs ? 'Español' : 'Spanish';

        return Scaffold(
          appBar: AppBar(
            title: Text(
              title,
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontFamily: 'Outfit',
              ),
            ),
            centerTitle: true,
          ),
          body: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              _buildLanguageOption(
                context,
                label: englishLabel,
                langCode: 'en',
                isSelected: currentLang == 'en',
              ),
              const SizedBox(height: 16),
              _buildLanguageOption(
                context,
                label: spanishLabel,
                langCode: 'es',
                isSelected: currentLang == 'es',
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildLanguageOption(
    BuildContext context, {
    required String label,
    required String langCode,
    required bool isSelected,
  }) {
    return InkWell(
      onTap: () async {
        await LanguageService.instance.setLanguage(langCode);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                langCode == 'es' ? 'Idioma cambiado a Español' : 'Language changed to English',
              ),
              duration: const Duration(seconds: 2),
            ),
          );
        }
      },
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? const Color(0xFFFF9533) : const Color(0xFFF8E8D8),
            width: isSelected ? 2 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: isSelected
                  ? const Color(0xFFFF9533).withOpacity(0.12)
                  : Colors.black.withOpacity(0.03),
              blurRadius: 15,
              offset: const Offset(0, 5),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: isSelected
                    ? const Color(0xFFFF9533)
                    : const Color(0xFFFF9533).withOpacity(0.1),
                borderRadius: BorderRadius.circular(15),
              ),
              child: Icon(
                Icons.language_rounded,
                color: isSelected ? Colors.white : const Color(0xFFFF9533),
                size: 24,
              ),
            ),
            const SizedBox(width: 20),
            Text(
              label,
              style: TextStyle(
                fontSize: 17,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
                color: const Color(0xFF2D2D2D),
              ),
            ),
            const Spacer(),
            if (isSelected)
              const Icon(
                Icons.check_circle_rounded,
                color: Color(0xFFFF9533),
                size: 24,
              )
            else
              const Icon(
                Icons.arrow_forward_ios_rounded,
                color: Color(0xFFD1D1D1),
                size: 18,
              ),
          ],
        ),
      ),
    );
  }
}
