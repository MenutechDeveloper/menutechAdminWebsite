import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:menutech_admin/main.dart';

void main() {
  testWidgets('Counter increments smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const MenutechAdminApp());

    // Basic check to ensure the app loads (e.g. finds a text or widget)
    // Since it starts at Login, we could look for 'Welcome'
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
