import { Box, Typography } from '@strapi/design-system';

const HomePage = () => (
  <Box padding={8}>
    <Typography variant="alpha" tag="h1">
      Bán hàng
    </Typography>
    <Box paddingTop={4}>
      <Typography>Lõi đơn hàng (Phase O1) đang được xây dựng. Chưa có màn hình vận hành.</Typography>
    </Box>
  </Box>
);

export default HomePage;
