import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'supabase_service.dart';

class LanguageService {
  static final LanguageService instance = LanguageService._internal();
  factory LanguageService() => instance;
  LanguageService._internal();

  final ValueNotifier<String> currentLanguage = ValueNotifier<String>('en');

  bool get isSpanish => currentLanguage.value == 'es';

  Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final String? cachedLang = prefs.getString('app_language');
      if (cachedLang == 'es' || cachedLang == 'en') {
        currentLanguage.value = cachedLang!;
      }

      await fetchFromDatabase();
    } catch (e) {
      debugPrint('Error initializing LanguageService: $e');
    }
  }

  Future<void> fetchFromDatabase() async {
    try {
      final user = SupabaseService().currentUser;
      if (user == null) return;

      final res = await SupabaseService()
          .client
          .from('menutech_restaurants')
          .select('language')
          .eq('user_id', user.id)
          .maybeSingle();

      if (res != null && res['language'] != null) {
        final lang = res['language'].toString().trim().toLowerCase();
        if (lang == 'es' || lang == 'en') {
          currentLanguage.value = lang;
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('app_language', lang);
        }
      }
    } catch (e) {
      debugPrint('Error fetching language from database: $e');
    }
  }

  Future<void> setLanguage(String lang) async {
    if (lang != 'en' && lang != 'es') return;

    currentLanguage.value = lang;

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('app_language', lang);

      final user = SupabaseService().currentUser;
      if (user != null) {
        final now = DateTime.now().toIso8601String();
        await SupabaseService().client.from('menutech_restaurants').upsert({
          'user_id': user.id,
          'language': lang,
          'updated_at': now,
        }, onConflict: 'user_id');
      }
    } catch (e) {
      debugPrint('Error saving language: $e');
    }
  }
}
