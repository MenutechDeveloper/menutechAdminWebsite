import 'dart:convert';
import 'order_model.dart';

enum EntryType { order, reservation }

class UnifiedItem {
  final String id;
  final String userId;
  final EntryType entryType;
  final String customerName;
  final String customerPhone;
  final String? customerEmail;
  final String status;
  final double totalAmount;
  final DateTime createdAt;

  // Order specific fields
  final String? address;
  final String? reference;
  final String orderType; // 'delivery' or 'pickup'
  final List<OrderItem> items;
  final String? customerNotes;
  final String? paymentMethod;
  final String? deliveryDate;
  final String? deliveryTime;
  final String? deliveryTimeMode;

  // Reservation specific fields
  final String? reservationDate;
  final String? reservationTime;
  final int partySize;
  final String? comments;
  final List<OrderItem> preorderItems;

  UnifiedItem({
    required this.id,
    required this.userId,
    required this.entryType,
    required this.customerName,
    required this.customerPhone,
    this.customerEmail,
    required this.status,
    required this.totalAmount,
    required this.createdAt,
    this.address,
    this.reference,
    this.orderType = 'pickup',
    this.items = const [],
    this.customerNotes,
    this.paymentMethod,
    this.deliveryDate,
    this.deliveryTime,
    this.deliveryTimeMode,
    this.reservationDate,
    this.reservationTime,
    this.partySize = 2,
    this.comments,
    this.preorderItems = const [],
  });

  factory UnifiedItem.fromOrderJson(Map<String, dynamic> json) {
    var itemsList = <OrderItem>[];
    if (json['items'] != null) {
      final decodedItems = json['items'] is String
          ? jsonDecode(json['items'])
          : json['items'];
      if (decodedItems is List) {
        itemsList = decodedItems.map((i) => OrderItem.fromJson(i)).toList();
      }
    }

    return UnifiedItem(
      id: json['id'].toString(),
      userId: json['user_id'] ?? '',
      entryType: EntryType.order,
      customerName: json['customer_name'] ?? 'N/A',
      customerPhone: json['customer_phone'] ?? 'N/A',
      customerEmail: json['customer_email'] ?? json['email'] ?? json['customerEmail'],
      status: json['status'] ?? 'pending',
      totalAmount: (json['total_amount'] ?? json['total'] ?? 0).toDouble(),
      createdAt: DateTime.parse(json['created_at']).toLocal(),
      address: json['address'],
      reference: json['reference'],
      orderType: json['order_type'] ?? 'pickup',
      items: itemsList,
      customerNotes: json['customer_notes'],
      paymentMethod: json['payment_method'],
      deliveryDate: json['delivery_date'],
      deliveryTime: json['delivery_time'],
      deliveryTimeMode: json['delivery_time_mode'],
    );
  }

  factory UnifiedItem.fromReservationJson(Map<String, dynamic> json) {
    var preorders = <OrderItem>[];
    if (json['preorder_items'] != null) {
      final decoded = json['preorder_items'] is String
          ? jsonDecode(json['preorder_items'])
          : json['preorder_items'];
      if (decoded is List) {
        preorders = decoded.map((i) => OrderItem.fromJson(i)).toList();
      }
    }

    double calcTotal = preorders.fold(0, (sum, i) => sum + (i.price * i.quantity));
    double finalTotal = (json['preorder_total'] ?? calcTotal).toDouble();

    return UnifiedItem(
      id: json['id'].toString(),
      userId: json['user_id'] ?? '',
      entryType: EntryType.reservation,
      customerName: json['customer_name'] ?? 'N/A',
      customerPhone: json['customer_phone'] ?? 'N/A',
      customerEmail: json['customer_email'] ?? json['email'] ?? json['customerEmail'],
      status: json['status'] ?? 'pending',
      totalAmount: finalTotal,
      createdAt: DateTime.parse(json['created_at']).toLocal(),
      reservationDate: json['reservation_date'] ?? '',
      reservationTime: json['reservation_time'] ?? '',
      partySize: json['party_size'] ?? json['guests_count'] ?? 2,
      comments: json['comments'],
      preorderItems: preorders,
    );
  }

  factory UnifiedItem.fromJson(Map<String, dynamic> json) {
    final entryTypeStr = json['entry_type'] ?? json['entryType'];
    if (entryTypeStr == 'reservation' || json.containsKey('reservation_date')) {
      return UnifiedItem.fromReservationJson(json);
    } else {
      return UnifiedItem.fromOrderJson(json);
    }
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'user_id': userId,
      'entry_type': entryType == EntryType.reservation ? 'reservation' : 'order',
      'customer_name': customerName,
      'customer_phone': customerPhone,
      'customer_email': customerEmail,
      'status': status,
      'total_amount': totalAmount,
      'created_at': createdAt.toIso8601String(),
      'address': address,
      'reference': reference,
      'order_type': orderType,
      'items': items.map((i) => {
        'name': i.name,
        'quantity': i.quantity,
        'price': i.price,
        'total': i.total,
        'size': i.size,
        'instructions': i.instructions,
      }).toList(),
      'customer_notes': customerNotes,
      'payment_method': paymentMethod,
      'delivery_date': deliveryDate,
      'delivery_time': deliveryTime,
      'delivery_time_mode': deliveryTimeMode,
      'reservation_date': reservationDate,
      'reservation_time': reservationTime,
      'party_size': partySize,
      'comments': comments,
      'preorder_items': preorderItems.map((i) => {
        'name': i.name,
        'quantity': i.quantity,
        'price': i.price,
        'total': i.total,
        'size': i.size,
        'instructions': i.instructions,
      }).toList(),
    };
  }

  OrderModel toOrderModel() {
    return OrderModel(
      id: id,
      userId: userId,
      customerName: customerName,
      customerPhone: customerPhone,
      address: address,
      reference: reference,
      orderType: orderType,
      status: status,
      totalAmount: totalAmount,
      items: items,
      createdAt: createdAt,
      customerNotes: customerNotes,
      paymentMethod: paymentMethod,
      deliveryDate: deliveryDate,
      deliveryTime: deliveryTime,
      deliveryTimeMode: deliveryTimeMode,
    );
  }
}
