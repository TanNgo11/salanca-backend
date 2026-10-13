/** O13 providers: carrier "Gọi xe" panel on the delivery leg. Each value is [vi, en]. */
export const o13Messages: Record<string, [string, string]> = {
  'error.CARRIER_NOT_CONFIGURED': [
    'Chi nhánh chưa bật đối tác giao xe',
    'No carrier is enabled for this branch',
  ],
  'error.CARRIER_BOOKING_FAILED': [
    'Đối tác không nhận chuyến này',
    'The carrier could not take this trip',
  ],
  'error.PROVIDER_UNAVAILABLE': [
    'Đối tác đang gián đoạn, thử lại sau',
    'The provider is unreachable — try again shortly',
  ],

  'carrier.title': ['Đối tác giao xe', 'Delivery carrier'],
  'carrier.call': ['Gọi xe', 'Call a courier'],
  'carrier.again': ['Gọi lại', 'Call again'],
  'carrier.cancel': ['Hủy chuyến đối tác', 'Cancel carrier trip'],
  'carrier.cancelConfirm': [
    'Hủy chuyến xe đang tìm tài xế? Đơn quay về trạng thái chờ giao.',
    'Cancel the trip while it searches for a driver? The leg returns to ready.',
  ],
  'carrier.canceled': ['Đã hủy chuyến đối tác', 'Carrier trip cancelled'],
  'carrier.booked': ['Đã gọi xe — đang tìm tài xế', 'Trip booked — searching for a driver'],
  'carrier.searching': ['Đang tìm tài xế…', 'Searching for a driver…'],
  'carrier.quoteLoading': ['Đang lấy giá từ đối tác…', 'Asking the carrier for a quote…'],
  'carrier.quoteFailed': ['Không lấy được giá từ đối tác', 'Could not get a carrier quote'],
  'carrier.fee': ['Phí đối tác thu', 'Carrier fee'],
  'carrier.customerFee': ['Phí khách đã trả', 'Customer-paid fee'],
  'carrier.due': ['Thu hộ (COD)', 'Collect on delivery'],
  'carrier.service': ['Dịch vụ', 'Service'],
  'carrier.trip': ['Mã chuyến', 'Trip ref'],
  'carrier.status': ['Trạng thái đối tác', 'Carrier status'],
  'carrier.driver': ['Tài xế', 'Driver'],
  'carrier.tracking': ['Link theo dõi', 'Tracking link'],
  'carrier.awaitingCollect': [
    'Tài xế đã giao — chờ thu tiền để hoàn tất',
    'Courier delivered — collect the payment to finish',
  ],
  'carrier.status.searching': ['Đang tìm tài xế', 'Searching'],
  'carrier.status.booked': ['Đã có tài xế', 'Driver assigned'],
  'carrier.status.in-process': ['Đang giao', 'In process'],
  'carrier.status.delivered': ['Đã giao (đối tác)', 'Delivered (carrier)'],
  'carrier.status.cancelled': ['Đối tác hủy', 'Cancelled by carrier'],
  'carrier.status.failed': ['Đối tác thất bại', 'Carrier failed'],
  'deliveries.failReason.carrier-cancelled': ['Đối tác hủy chuyến', 'Carrier cancelled the trip'],
  'deliveries.failReason.carrier-failed': ['Đối tác giao thất bại', 'Carrier delivery failed'],
};
