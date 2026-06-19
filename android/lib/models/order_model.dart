import 'dart:convert';

class OrderModel {
  final String id;
  final String userId;
  final String customerName;
  final String customerPhone;
  final String? address;
  final String? reference;
  final String orderType;
  final String status;
  final double totalAmount;
  final List<OrderItem> items;
  final DateTime createdAt;
  final String? customerNotes;
  final String? paymentMethod;
  final String? deliveryDate;
  final String? deliveryTime;
  final String? deliveryTimeMode;

  OrderModel({
    required this.id,
    required this.userId,
    required this.customerName,
    required this.customerPhone,
    this.address,
    this.reference,
    required this.orderType,
    required this.status,
    required this.totalAmount,
    required this.items,
    required this.createdAt,
    this.customerNotes,
    this.paymentMethod,
    this.deliveryDate,
    this.deliveryTime,
    this.deliveryTimeMode,
  });

  factory OrderModel.fromJson(Map<String, dynamic> json) {
    var itemsList = <OrderItem>[];
    if (json['items'] != null) {
      final decodedItems = json['items'] is String
          ? jsonDecode(json['items'])
          : json['items'];
      if (decodedItems is List) {
        itemsList = decodedItems.map((i) => OrderItem.fromJson(i)).toList();
      }
    }

    return OrderModel(
      id: json['id'].toString(),
      userId: json['user_id'],
      customerName: json['customer_name'] ?? 'N/A',
      customerPhone: json['customer_phone'] ?? 'N/A',
      address: json['address'],
      reference: json['reference'],
      orderType: json['order_type'] ?? 'pickup',
      status: json['status'] ?? 'pending',
      totalAmount: (json['total_amount'] ?? json['total'] ?? 0).toDouble(),
      items: itemsList,
      createdAt: DateTime.parse(json['created_at']),
      customerNotes: json['customer_notes'],
      paymentMethod: json['payment_method'],
      deliveryDate: json['delivery_date'],
      deliveryTime: json['delivery_time'],
      deliveryTimeMode: json['delivery_time_mode'],
    );
  }
}

class OrderItem {
  final String name;
  final int quantity;
  final double price;
  final double? total;
  final String? size;
  final List<String>? toppings;
  final String? instructions;

  OrderItem({
    required this.name,
    required this.quantity,
    required this.price,
    this.total,
    this.size,
    this.toppings,
    this.instructions,
  });

  factory OrderItem.fromJson(Map<String, dynamic> json) {
    return OrderItem(
      name: json['name'] ?? 'Unknown Item',
      quantity: json['quantity'] ?? 1,
      price: (json['price'] ?? 0).toDouble(),
      total: json['total']?.toDouble(),
      size: json['size'],
      toppings: json['toppings'] != null ? List<String>.from(json['toppings']) : null,
      instructions: json['instructions'],
    );
  }
}
