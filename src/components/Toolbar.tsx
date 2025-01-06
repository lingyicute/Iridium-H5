import React, { useState, useEffect } from 'react';
import {
  AppBar,
  Toolbar,
  IconButton,
  TextField,
  styled,
  Box,
} from '@mui/material';
import {
  ArrowBack,
  ArrowForward,
  Home,
  Refresh,
  Bookmark,
  BookmarkBorder,
  Collections,
  Settings,
} from '@mui/icons-material';

const StyledToolbar = styled(Toolbar)(() => ({
  minHeight: '48px',
  padding: '0 16px',
  gap: '8px',
}));

const AddressBar = styled(TextField)(({ theme }) => ({
  flex: 1,
  '& .MuiInputBase-root': {
    height: '36px',
    backgroundColor: theme.palette.background.paper,
  },
}));

interface ToolbarProps {
  onBack: () => void;
  onForward: () => void;
  onHome: () => void;
  onRefresh: () => void;
  onBookmark: () => void;
  onBookmarksOpen: () => void;
  onSettingsOpen: () => void;
  isBookmarked: boolean;
  currentUrl: string;
  onUrlChange: (url: string) => void;
}

const BrowserToolbar: React.FC<ToolbarProps> = ({
  onBack,
  onForward,
  onHome,
  onRefresh,
  onBookmark,
  onBookmarksOpen,
  onSettingsOpen,
  isBookmarked,
  currentUrl,
  onUrlChange,
}) => {
  const [url, setUrl] = useState(currentUrl);

  useEffect(() => {
    setUrl(currentUrl);
  }, [currentUrl]);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url) {
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      onUrlChange(fullUrl);
    }
  };

  return (
    <AppBar position="static" color="default" elevation={1}>
      <StyledToolbar>
        <IconButton onClick={onBack} size="small">
          <ArrowBack />
        </IconButton>
        <IconButton onClick={onForward} size="small">
          <ArrowForward />
        </IconButton>
        <IconButton onClick={onHome} size="small">
          <Home />
        </IconButton>
        <IconButton onClick={onRefresh} size="small">
          <Refresh />
        </IconButton>
        
        <Box component="form" onSubmit={handleUrlSubmit} sx={{ display: 'flex', flex: 1 }}>
          <AddressBar
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            variant="outlined"
            size="small"
            fullWidth
          />
          <IconButton onClick={onBookmark} size="small">
            {isBookmarked ? <Bookmark /> : <BookmarkBorder />}
          </IconButton>
        </Box>

        <IconButton onClick={onBookmarksOpen} size="small">
          <Collections />
        </IconButton>
        <IconButton onClick={onSettingsOpen} size="small">
          <Settings />
        </IconButton>
      </StyledToolbar>
    </AppBar>
  );
};

export default BrowserToolbar; 