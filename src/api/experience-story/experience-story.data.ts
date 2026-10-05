export interface ExperienceHeritageStory {
  locale: 'vi' | 'en';
  paragraphs: readonly string[];
  illustration: {
    src: string;
    alt: string;
    position: 'left' | 'right';
  };
  background: {
    src: string;
    color: string;
  };
}

export const EXPERIENCE_HERITAGE_DATA: Record<'vi' | 'en', ExperienceHeritageStory> = {
  vi: {
    locale: 'vi',
    paragraphs: [
      'Từ những năm 1700, nghành chăn thả gia súc đã bắt đầu phổ biến ở miền nam Brazil. Cũng từ đây cộng đồng lao động du mục Brazil đã sáng tạo ra cách ướp những tảng thịt lớn trong muối biển và nướng chậm trên than củi hồng. Còn điều gì tuyệt hơn sau một ngày dài lao động trên đồng cỏ đươc thưởng thức món nướng nóng hổi bên những người anh em?',
      'Ngày nay, người Brazil vẫn tiếp nối truyền thống ẩm thực của tổ tiên bằng cách mở những nhà hàng bán đồ nướng của riêng họ trên khắp thế giới. Những tảng thịt bò, heo, gà, cừu, xúc xích ... quay chậm, đều trong những bếp nướng Churrasco queria, những món thịt béo hơn sẽ được đặt bên trên, để nước thịt béo ngậy nóng sẽ chảy xuống thấm vào những món thịt ở phía dưới. Đó là một trong những bí quyết để khi người phục vụ mang xiên thịt tới cắt tại bàn, thịt thơm lừng mà mềm mượt.',
      'Từ năm 2003 thương hiệu Au Lac do Brazil là tiền thân của Salanca, tiên phong đưa văn hoá ẩm thực Brazil tới thành phố Hồ Chí Minh, sau đó 2006 tại Hà Nội, với chất lượng ẩm thực, phong cách phục vụ nồng ấm đã được người Việt nhiệt tình ủng hộ tại 2 miền Nam-Bắc. Ngày 1/1/2022, ghi dấu một bước ngoặt quan trọng, thương hiệu Salanca tách hẳn khỏi Au Lac do Brazil, hoạt động và phát triển tại thị trường miền Bắc, dưới sự quản lý của Ms. Nga Nguyễn và anh Jan Stromler là nhà sáng lập đã đem thương hiệu về Việt Nam. Tại miền Nam, thương hiệu Au Lac do Brazil Saigon được chuyển nhượng cho Tập đoàn NoVaFood phát triển.',
      'Bước tiếp những thành công của Au Lac do Brazil, thương hiệu Salanca giữ vững các giá trị và tri ân sự ủng hộ của thực khách. Với mục tiêu lan toả lối sống nồng nhiệt và chân thành, ăn steak là phải thoả thích, vậy tới Salanca Brazil, bạn hãy tạm quên các chế độ ăn uống hà khắc một ngày để khai vị 1 ly caipirinha và thưởng thức thịt nóng được phục vụ tại bàn.',
    ],
    illustration: {
      src: 'https://salanca-s3.s3.cloudfly.vn/uploads/pdf_heritage_vi_bg_0162c6d1ee.webp',
      alt: 'Họa tiết chim vẹt và thiên nhiên nhiệt đới Brazil',
      position: 'left',
    },
    background: {
      src: 'https://salanca-s3.s3.cloudfly.vn/uploads/pdf_heritage_vi_bg_0162c6d1ee.webp',
      color: '#9e151b',
    },
  },
  en: {
    locale: 'en',
    paragraphs: [
      'From 1700s, the pasture industry became popular in South of Brazil. Developing from this, the community of Brazilian vagrant labor invented a method of marinating huge meat blocks with sea salt and then grilling them slowly over burning charcoal. What is more amazing than enjoying a fresh grill with brothers after a long working day on the pastureland?',
      'Nowadays, the Brazilian inherits that dining tradition by opening their exclusive grilling restaurants all over the world. Blocks of beef, pork, chicken, lamb, sausage… are rolled slowly in the same speed inside the Churrasco queria kitchens. Usually, they put the kind which is fattier above, then the greasy liquid falls down and drips over the others below. This is also one of the secrets to serve the meat right at the table, the meat will be sliced right from the skewer by the waiter, with fresh smell and smooth texture.',
      'Since 2003, the brand name Au Lac do Brazil, the precursor of Salanca, has led in bringing the Brazil food & beverage to Ho Chi Minh City, and 2006 in Hanoi. The brand was deeply loved and recognized by the Vietnamese diners due to the food quality and the warm service. The date of 1st of January, 2022 marked a significant milestone, Salanca is thoroughly separated from Au Lac do Brazil, managed by Ms. Nga Nguyen and mr. Jan Stromler the initial founder who has franchised the brand to Vietnam, operating and developing in Nothern region. In the South, Au Lac do Brazil is transfered to NoVaFood Group for continuously developing.',
      'Moving forward from the previous success of Au Lac do Brazil, the brand Salanca has strengthened their values and always appreciated the diners’ continuous support. Salanca spreads an intense and sincere lifestyle, eating steaks delightfully. Therefore, arriving at Salanca Brazil, you can temporarily leave behind a strict day diet, start with a caipirinha and enjoy the fresh meats served right at your table.',
    ],
    illustration: {
      src: 'https://salanca-s3.s3.cloudfly.vn/uploads/pdf_heritage_en_bg_64e909b12d.webp',
      alt: 'Brazilian macaws and tropical flora',
      position: 'right',
    },
    background: {
      src: 'https://salanca-s3.s3.cloudfly.vn/uploads/pdf_heritage_en_bg_64e909b12d.webp',
      color: '#9e151b',
    },
  },
};
