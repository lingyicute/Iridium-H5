import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Grid,
  Card,
  CardContent,
  Typography,
  IconButton,
  styled,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import { Close, Delete } from '@mui/icons-material';

const StyledCard = styled(Card)(({ theme }) => ({
  cursor: 'pointer',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

interface Bookmark {
  title: string;
  url: string;
}

interface BookmarksDialogProps {
  open: boolean;
  onClose: () => void;
  bookmarks: Bookmark[];
  onBookmarkClick: (url: string) => void;
  onBookmarkDelete: (url: string) => void;
}

const BookmarksDialog: React.FC<BookmarksDialogProps> = ({
  open,
  onClose,
  bookmarks,
  onBookmarkClick,
  onBookmarkDelete,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

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
        书签
        <IconButton
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2}>
          {bookmarks.map((bookmark, index) => (
            <Grid item xs={12} sm={isMobile ? 12 : 6} key={index}>
              <StyledCard>
                <CardContent
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    '&:last-child': { pb: 2 },
                  }}
                >
                  <div
                    style={{ flex: 1, cursor: 'pointer' }}
                    onClick={() => onBookmarkClick(bookmark.url)}
                  >
                    <Typography variant="subtitle1" noWrap>
                      {bookmark.title}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="textSecondary"
                      noWrap
                      sx={{ fontSize: '0.75rem' }}
                    >
                      {bookmark.url}
                    </Typography>
                  </div>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onBookmarkDelete(bookmark.url);
                    }}
                  >
                    <Delete />
                  </IconButton>
                </CardContent>
              </StyledCard>
            </Grid>
          ))}
        </Grid>
      </DialogContent>
    </Dialog>
  );
};

export default BookmarksDialog; 