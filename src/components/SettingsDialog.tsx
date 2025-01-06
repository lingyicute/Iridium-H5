import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Grid,
  Box,
  Typography,
  styled,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { ThemeOption } from '../theme/themes';

const ColorCircle = styled(Box)<{ color: string; isSelected: boolean }>(
  ({ theme, color, isSelected }) => ({
    width: 48,
    height: 48,
    borderRadius: '50%',
    backgroundColor: color,
    cursor: 'pointer',
    border: isSelected ? `3px solid ${theme.palette.primary.main}` : 'none',
    transition: 'transform 0.2s',
    '&:hover': {
      transform: 'scale(1.1)',
    },
  })
);

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  themes: ThemeOption[];
  currentTheme: string;
  onThemeChange: (theme: ThemeOption) => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onClose,
  themes,
  currentTheme,
  onThemeChange,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          width: '66%',
          maxHeight: '80vh',
        },
      }}
    >
      <DialogTitle>
        设置
        <IconButton
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="h6" gutterBottom>
          主题颜色
        </Typography>
        <Grid container spacing={2}>
          {themes.map((theme) => (
            <Grid item key={theme.name}>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <ColorCircle
                  color={theme.primary}
                  isSelected={theme.name === currentTheme}
                  onClick={() => onThemeChange(theme)}
                />
                <Typography variant="caption">{theme.name}</Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog; 