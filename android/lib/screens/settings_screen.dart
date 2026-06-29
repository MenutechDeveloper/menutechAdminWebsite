import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
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
    if (ips.isEmpty) {
      final remoteIp = await _printService.getRemotePrinterIp();
      if (remoteIp != null) {
        await _printService.savePrinterIp(remoteIp);
        final updatedIps = await _printService.getSavedPrinterIps();
        setState(() => _printerIps = updatedIps);
        return;
      }
    }
    setState(() => _printerIps = ips);
  }

  Future<void> _discoverPrinters() async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: Color(0xFFFF9533)),
            SizedBox(height: 20),
            Text("Searching for printers on local network..."),
          ],
        ),
      ),
    );

    try {
      final discovered = await _printService.discoverPrinters();
      if (!mounted) return;
      Navigator.pop(context);

      if (discovered.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No printers found'), backgroundColor: Colors.orange),
        );
      } else {
        // Save all found printers to local storage, but only the last one will sync to Supabase
        // because of the unique user_id constraint in the table.
        for (var ip in discovered) {
          await _printService.savePrinterIp(ip);
        }
        await _loadPrinters();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Found and configured ${discovered.length} printer(s)'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error searching printers: $e'), backgroundColor: Colors.red),
      );
    }
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
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _discoverPrinters,
                icon: const Icon(Icons.search),
                label: const Text("SEARCH PRINTERS AUTOMATICALLY"),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF9533),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
            const SizedBox(height: 30),
            ListTile(
              leading: const Icon(Icons.privacy_tip_outlined, color: Colors.grey),
              title: const Text("Privacy Policy"),
              onTap: () async {
                final url = Uri.parse('https://menutech.xyz/privacy-policy');
                if (await canLaunchUrl(url)) {
                  await launchUrl(url, mode: LaunchMode.externalApplication);
                }
              },
            ),
            const Divider(),
            const SizedBox(height: 10),
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
