/**
 * O7 Admin strings, VI and EN side by side: `key: [vi, en]`. Merged next to o3–o6.
 * The translation test fails when a screen uses a key that is missing here.
 */
export const o7Messages: Record<string, [string, string]> = {
  'branch.special.title': ['Ngày đặc biệt', 'Special days'],
  'branch.special.add': ['Thêm ngày đặc biệt', 'Add a special day'],
  'branch.special.date': ['Ngày', 'Date'],
  'branch.special.closed': ['Đóng cửa', 'Closed'],
  'branch.special.note': ['Ghi chú', 'Note'],
  'branch.special.notePlaceholder': ['Mùng 2 Tết', 'Second day of Tet'],
  'branch.special.remove': ['Xóa ngày', 'Remove day'],
  'branch.special.removeRange': ['Xóa khoảng', 'Remove range'],
  'branch.special.addRange': ['+ khoảng', '+ range'],
  'branch.special.open': ['Mở', 'Opens'],
  'branch.special.close': ['Đóng', 'Closes'],
  'branch.special.past': ['Đã qua ({count})', 'Past ({count})'],
  'branch.special.empty': ['Chưa có ngày đặc biệt', 'No special days yet'],
  'branch.special.hint': [
    'Ngày đặc biệt thay giờ mở cửa thường và ngày nghỉ của đúng ngày đó. Khoảng 22:00–02:00 là mở qua nửa đêm.',
    'A special day replaces the regular hours and the holiday for that date. A 22:00–02:00 range stays open past midnight.',
  ],
  'branch.special.copyToDelivery': ['Chép sang Giao tận nơi', 'Copy to delivery'],
  'branch.special.copyToPickup': ['Chép sang Tự lấy', 'Copy to pickup'],
  'branch.special.copyTitle': ['Ghi đè ngày đặc biệt?', 'Overwrite special days?'],
  'branch.special.copyBody': [
    'Danh sách ngày đặc biệt bên kia sẽ bị thay bằng danh sách này.',
    'The other method’s special days will be replaced by this list.',
  ],
  'branch.special.copyConfirm': ['Ghi đè', 'Overwrite'],
  'branch.special.copyCancel': ['Hủy', 'Cancel'],
  'branch.special.duplicate': ['Ngày bị trùng', 'That date is already listed'],
  'branch.special.overlap': ['Khoảng giờ chồng nhau', 'Those ranges overlap'],
  'branch.special.needRange': [
    'Cần ít nhất một khoảng giờ hoặc bật Đóng cửa',
    'Add at least one range, or mark the day closed',
  ],
};
