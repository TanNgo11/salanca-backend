import { Box, Typography } from '@strapi/design-system';

const HomePage = () => (
  <Box padding={8}>
    <Typography variant="alpha" tag="h1">
      Bán hàng
    </Typography>
    <Box paddingTop={4}>
      <Typography>Plugin ordering đang ở giai đoạn spike (Phase O0).</Typography>
    </Box>
  </Box>
);

export default HomePage;
