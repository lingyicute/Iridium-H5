import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  styled,
  Container,
} from '@mui/material';

const Logo = styled(Typography)(({ theme }) => ({
  fontSize: '5rem',
  fontWeight: 'bold',
  marginBottom: theme.spacing(4),
  fontFamily: 'Noto Sans SC, sans-serif',
  background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
}));

const SearchBox = styled(TextField)(() => ({
  width: '100%',
  maxWidth: '584px',
  '& .MuiInputBase-root': {
    height: '44px',
    borderRadius: '22px',
  },
}));

interface NewTabProps {
  onNavigate: (url: string) => void;
}

const NewTab: React.FC<NewTabProps> = ({ onNavigate }) => {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url) {
      // 如果输入的不是完整URL，添加https://
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      onNavigate(fullUrl);
    }
  };

  return (
    <Container>
      <Box
        sx={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          mt: -10,
        }}
      >
        <Logo variant="h1">Iridium</Logo>
        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <SearchBox
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="输入网址"
            variant="outlined"
          />
        </Box>
      </Box>
    </Container>
  );
};

export default NewTab; 