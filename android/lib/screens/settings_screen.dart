import 'package:flutter/material.dart';
import '../services/print_service.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final PrintService _printService = PrintService();
  final _ipController = TextEditingController();
  List<String> _printerIps = [];

  @override
  void initState() {
    super.initState();
    _loadPrinters();
  }

  Future<void> _loadPrinters() async {
    final ips = await _printService.getSavedPrinterIps();
    setState(() => _printerIps = ips);
  }

  Future<void> _addPrinter() async {
    final ip = _ipController.text.trim();
    if (ip.isEmpty) return;

    // Basic IP validation regex
    final ipRegex = RegExp(r'^(\d{1,3}\.){3}\d{1,3}$');
    if (!ipRegex.hasMatch(ip)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Invalid IP Address'), backgroundColor: Colors.red),
      );
      return;
    }

    await _printService.savePrinterIp(ip);
    _ipController.clear();
    _loadPrinters();
  }

  Future<void> _removePrinter(String ip) async {
    await _printService.removePrinterIp(ip);
    _loadPrinters();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Printer Settings")),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              "Ethernet Printers",
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10),
            const Text(
              "Add the IP addresses of your Epson TM-T20III printers connected to the network.",
              style: TextStyle(color: Colors.grey),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _ipController,
                    decoration: InputDecoration(
                      hintText: "e.g. 192.168.1.100",
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 10),
                IconButton.filled(
                  onPressed: _addPrinter,
                  icon: const Icon(Icons.add),
                  style: IconButton.styleFrom(backgroundColor: const Color(0xFFFF9533)),
                ),
              ],
            ),
            const SizedBox(height: 30),
            Expanded(
              child: ListView.separated(
                itemCount: _printerIps.length,
                separatorBuilder: (context, index) => const Divider(),
                itemBuilder: (context, index) {
                  final ip = _printerIps[index];
                  return ListTile(
                    leading: const Icon(Icons.print, color: Color(0xFFFF9533)),
                    title: Text(ip),
                    subtitle: const Text("Ethernet Port 9100"),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete_outline, color: Colors.red),
                      onPressed: () => _removePrinter(ip),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
