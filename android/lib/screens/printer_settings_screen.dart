import 'package:flutter/material.dart';
import '../services/print_service.dart';

class PrinterSettingsScreen extends StatefulWidget {
  const PrinterSettingsScreen({super.key});

  @override
  State<PrinterSettingsScreen> createState() => _PrinterSettingsScreenState();
}

class _PrinterSettingsScreenState extends State<PrinterSettingsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final PrintService _printService = PrintService();
  final _ipController = TextEditingController();

  List<String> _printerIps = [];
  Map<String, String> _printerNames = {};
  String? _activeIp;

  List<String> _discoveredIps = [];
  bool _isScanning = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadPrinters();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _ipController.dispose();
    super.dispose();
  }

  Future<void> _loadPrinters() async {
    final ips = await _printService.getSavedPrinterIps();
    final names = await _printService.getPrinterNames();
    final remoteIp = await _printService.getRemotePrinterIp();

    if (ips.isEmpty && remoteIp != null) {
      await _printService.savePrinterIp(remoteIp);
      final updatedIps = await _printService.getSavedPrinterIps();
      final updatedNames = await _printService.getPrinterNames();
      if (mounted) {
        setState(() {
          _printerIps = updatedIps;
          _printerNames = updatedNames;
          _activeIp = remoteIp;
        });
      }
      return;
    }

    if (mounted) {
      setState(() {
        _printerIps = ips;
        _printerNames = names;
        _activeIp = remoteIp;
      });
    }
  }

  Future<void> _discoverPrinters() async {
    setState(() {
      _isScanning = true;
      _discoveredIps = [];
    });

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
      Navigator.pop(context); // Close search dialog

      setState(() {
        _isScanning = false;
        _discoveredIps = discovered;
      });

      if (discovered.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No printers found'), backgroundColor: Colors.orange),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Found ${discovered.length} printer(s) on your network!'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      setState(() {
        _isScanning = false;
      });
      if (!mounted) return;
      Navigator.pop(context); // Close search dialog if open
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error searching printers: $e'), backgroundColor: Colors.red),
      );
    }
  }

  void _manualAddPrinter() {
    final ip = _ipController.text.trim();
    if (ip.isEmpty) return;

    final ipRegex = RegExp(r'^(\d{1,3}\.){3}\d{1,3}$');
    if (!ipRegex.hasMatch(ip)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Invalid IP Address'), backgroundColor: Colors.red),
      );
      return;
    }

    _ipController.clear();
    _navigateToConfigure(ip);
  }

  Future<void> _navigateToConfigure(String ip, {String? currentName}) async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (context) => ConfigurePrinterScreen(ip: ip, initialName: currentName),
      ),
    );

    if (result == true) {
      await _loadPrinters();
    }
  }

  Future<void> _removePrinter(String ip) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove Printer'),
        content: Text('Are you sure you want to remove the printer with IP $ip?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('CANCEL')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('REMOVE', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await _printService.removePrinterIp(ip);
      await _loadPrinters();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Printer Settings", style: TextStyle(fontWeight: FontWeight.bold)),
        bottom: TabBar(
          controller: _tabController,
          labelColor: const Color(0xFFFF9533),
          unselectedLabelColor: Colors.grey,
          indicatorColor: const Color(0xFFFF9533),
          tabs: const [
            Tab(text: "My Printers", icon: Icon(Icons.print_rounded)),
            Tab(text: "Search & Add", icon: Icon(Icons.search_rounded)),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildMyPrintersTab(),
          _buildSearchAndAddTab(),
        ],
      ),
    );
  }

  Widget _buildMyPrintersTab() {
    if (_printerIps.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.print_disabled_rounded, size: 80, color: Colors.grey.shade400),
            const SizedBox(height: 24),
            const Text(
              "No configured printers yet.",
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.grey),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            const Text(
              "Go to the 'Search & Add' tab to automatically search or manually enter your printer's IP.",
              style: TextStyle(fontSize: 14, color: Colors.grey),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(24.0),
      itemCount: _printerIps.length,
      separatorBuilder: (context, index) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final ip = _printerIps[index];
        final isActive = ip == _activeIp;
        final name = _printerNames[ip] ?? "Unnamed Printer";

        return InkWell(
          onTap: () async {
            showDialog(
              context: context,
              barrierDismissible: false,
              builder: (context) => const Center(
                child: CircularProgressIndicator(color: Color(0xFFFF9533)),
              ),
            );
            final success = await _printService.testConnection(ip);
            if (!mounted) return;
            Navigator.of(context).pop(); // Close spinner

            if (success) {
              await _printService.savePrinterIp(ip);
              await _loadPrinters();
              if (!mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Printer "$name" ($ip) is now active!'),
                  backgroundColor: Colors.green,
                ),
              );
            } else {
              if (!mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Could not connect to $ip. Verify network.'),
                  backgroundColor: Colors.red,
                ),
              );
            }
          },
          borderRadius: BorderRadius.circular(16),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isActive ? const Color(0xFFFF9533).withOpacity(0.05) : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: isActive ? const Color(0xFFFF9533) : const Color(0xFFF8E8D8),
                width: isActive ? 2 : 1,
              ),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: isActive ? const Color(0xFFFF9533).withOpacity(0.1) : Colors.grey.shade100,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    isActive ? Icons.print : Icons.print_outlined,
                    color: isActive ? const Color(0xFFFF9533) : Colors.grey,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: isActive ? const Color(0xFFFF9533) : Colors.black,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        "IP: $ip",
                        style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        isActive ? "Selected & Active" : "Click to test & select",
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                          color: isActive ? const Color(0xFFFF9533) : Colors.grey,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.edit_outlined, color: Colors.blueGrey),
                  onPressed: () => _navigateToConfigure(ip, currentName: _printerNames[ip]),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline, color: Colors.red),
                  onPressed: () => _removePrinter(ip),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildSearchAndAddTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            "Add Printers Graphically",
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          const Text(
            "Enter your thermal printer's IP address below or scan automatically to configure it.",
            style: TextStyle(color: Colors.grey, fontSize: 14),
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
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  ),
                  keyboardType: TextInputType.number,
                ),
              ),
              const SizedBox(width: 12),
              ElevatedButton(
                onPressed: _manualAddPrinter,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF9533),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text("ADD", style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _isScanning ? null : _discoverPrinters,
              icon: const Icon(Icons.search_rounded),
              label: const Text("SEARCH PRINTERS AUTOMATICALLY"),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFF9533),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          const SizedBox(height: 32),
          if (_discoveredIps.isNotEmpty) ...[
            const Text(
              "Discovered Printers",
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _discoveredIps.length,
              separatorBuilder: (context, index) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final ip = _discoveredIps[index];
                return InkWell(
                  onTap: () => _navigateToConfigure(ip),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFF8E8D8)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.wifi_rounded, color: Color(0xFFFF9533)),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Text(
                            ip,
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                          ),
                        ),
                        const Text(
                          "Configure",
                          style: TextStyle(
                            color: Color(0xFFFF9533),
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(width: 4),
                        const Icon(
                          Icons.arrow_forward_ios_rounded,
                          size: 14,
                          color: Color(0xFFFF9533),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ] else if (!_isScanning && _ipController.text.isEmpty) ...[
            Center(
              child: Padding(
                padding: const EdgeInsets.only(top: 40.0),
                child: Text(
                  "Scan to automatically detect thermal printers connected on your network.",
                  style: TextStyle(color: Colors.grey.shade500, fontStyle: FontStyle.italic),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class ConfigurePrinterScreen extends StatefulWidget {
  final String ip;
  final String? initialName;

  const ConfigurePrinterScreen({super.key, required this.ip, this.initialName});

  @override
  State<ConfigurePrinterScreen> createState() => _ConfigurePrinterScreenState();
}

class _ConfigurePrinterScreenState extends State<ConfigurePrinterScreen> {
  final PrintService _printService = PrintService();
  final _nameController = TextEditingController();
  bool _isTesting = false;
  String? _testStatus; // null, "success", "failed"

  @override
  void initState() {
    super.initState();
    _nameController.text = widget.initialName ?? '';
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _testConnection() async {
    setState(() {
      _isTesting = true;
      _testStatus = null;
    });

    final success = await _printService.testConnection(widget.ip);

    if (!mounted) return;
    setState(() {
      _isTesting = false;
      _testStatus = success ? "success" : "failed";
    });
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();

    // Save configuration
    await _printService.savePrinterIp(widget.ip);
    if (name.isNotEmpty) {
      await _printService.savePrinterName(widget.ip, name);
    } else {
      await _printService.savePrinterName(widget.ip, "Printer ${widget.ip}");
    }

    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Configure Printer", style: TextStyle(fontWeight: FontWeight.bold)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: const Color(0xFFFF9533).withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.print_outlined,
                  size: 64,
                  color: Color(0xFFFF9533),
                ),
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              "Printer Configuration",
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              "Set a custom name or identifier for the printer located at IP: ${widget.ip}.",
              style: const TextStyle(color: Colors.grey),
            ),
            const SizedBox(height: 24),
            const Text(
              "IP Address",
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.grey.shade300),
              ),
              child: Text(
                widget.ip,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.blueGrey),
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              "Printer Name / Alias",
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _nameController,
              decoration: InputDecoration(
                hintText: "e.g. Kitchen Printer, Main Cashier",
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              ),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _isTesting ? null : _testConnection,
                    icon: _isTesting
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFFF9533)),
                          )
                        : const Icon(Icons.network_check_rounded),
                    label: const Text("TEST CONNECTION"),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFFF9533),
                      side: const BorderSide(color: Color(0xFFFF9533)),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
              ],
            ),
            if (_testStatus != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _testStatus == "success" ? Colors.green.withOpacity(0.1) : Colors.red.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Icon(
                      _testStatus == "success" ? Icons.check_circle_rounded : Icons.error_rounded,
                      color: _testStatus == "success" ? Colors.green : Colors.red,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _testStatus == "success"
                            ? "Connection successful! Printer is reachable."
                            : "Could not connect to printer at ${widget.ip}. Please check network connection and port 9100.",
                        style: TextStyle(
                          color: _testStatus == "success" ? Colors.green.shade800 : Colors.red.shade800,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _save,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF9533),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text(
                  "SAVE PRINTER",
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
