import 'package:flutter/material.dart';
import '../services/print_service.dart';

class PrinterSettingsScreen extends StatefulWidget {
  const PrinterSettingsScreen({super.key});

  @override
  State<PrinterSettingsScreen> createState() => _PrinterSettingsScreenState();
}

class _PrinterSettingsScreenState extends State<PrinterSettingsScreen> {
  final PrintService _printService = PrintService();
  final _ipController = TextEditingController();
  List<String> _printerIps = [];
  String? _activeIp;

  @override
  void initState() {
    super.initState();
    _loadPrinters();
  }

  Future<void> _loadPrinters() async {
    final ips = await _printService.getSavedPrinterIps();
    final remoteIp = await _printService.getRemotePrinterIp();

    if (ips.isEmpty && remoteIp != null) {
      await _printService.savePrinterIp(remoteIp);
      final updatedIps = await _printService.getSavedPrinterIps();
      setState(() {
        _printerIps = updatedIps;
        _activeIp = remoteIp;
      });
      return;
    }

    setState(() {
      _printerIps = ips;
      _activeIp = remoteIp;
    });
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
            const Divider(),
            const SizedBox(height: 10),
            Expanded(
              child: ListView.separated(
                itemCount: _printerIps.length,
                separatorBuilder: (context, index) => const Divider(),
                itemBuilder: (context, index) {
                  final ip = _printerIps[index];
                  final isActive = ip == _activeIp;
                  return ListTile(
                    leading: Icon(
                      isActive ? Icons.print : Icons.print_outlined,
                      color: isActive ? const Color(0xFFFF9533) : Colors.grey,
                    ),
                    title: Text(
                      ip,
                      style: TextStyle(
                        fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                        color: isActive ? const Color(0xFFFF9533) : Colors.black,
                      ),
                    ),
                    subtitle: Text(isActive ? "Selected & Active" : "Click to connect & select"),
                    onTap: () async {
                      showDialog(
                        context: context,
                        barrierDismissible: false,
                        builder: (context) => const Center(child: CircularProgressIndicator(color: Color(0xFFFF9533))),
                      );
                      final success = await _printService.testConnection(ip);
                      if (!context.mounted) return;
                      // Close the progress dialog
                      Navigator.of(context).pop();

                      if (success) {
                        await _printService.savePrinterIp(ip);
                        await _loadPrinters();
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Printer $ip connected and selected successfully!'), backgroundColor: Colors.green),
                        );
                      } else {
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Could not connect to $ip. Check network.'), backgroundColor: Colors.red),
                        );
                      }
                    },
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
