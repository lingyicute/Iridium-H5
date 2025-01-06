import React, { useState, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Cookies from 'js-cookie';
import BrowserToolbar from './components/Toolbar';
import NewTab from './components/NewTab';
import BookmarksDialog from './components/BookmarksDialog';
import SettingsDialog from './components/SettingsDialog';
import { themeOptions, ThemeOption } from './theme/themes';

interface Bookmark {
  title: string;
  url: string;
}

const App: React.FC = () => {
  // 状态管理
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeOption>(themeOptions[0]);

  // 从 cookies 加载数据
  useEffect(() => {
    const savedBookmarks = Cookies.get('bookmarks');
    if (savedBookmarks) {
      setBookmarks(JSON.parse(savedBookmarks));
    }

    const savedTheme = Cookies.get('theme');
    if (savedTheme) {
      const theme = themeOptions.find((t) => t.name === savedTheme);
      if (theme) {
        setCurrentTheme(theme);
      }
    }
  }, []);

  // 创建主题
  const theme = createTheme({
    palette: {
      primary: {
        main: currentTheme.primary,
      },
      background: {
        default: currentTheme.secondary,
      },
    },
  });

  // 导航处理
  const handleNavigate = (url: string) => {
    if (!url) return;
    setCurrentUrl(url);
  };

  // 书签处理
  const toggleBookmark = () => {
    if (!currentUrl) return;

    const existingBookmark = bookmarks.find((b) => b.url === currentUrl);
    let newBookmarks: Bookmark[];

    if (existingBookmark) {
      newBookmarks = bookmarks.filter((b) => b.url !== currentUrl);
    } else {
      // 使用当前URL作为标题，因为iframe可能无法访问
      newBookmarks = [...bookmarks, { title: currentUrl, url: currentUrl }];
    }

    setBookmarks(newBookmarks);
    Cookies.set('bookmarks', JSON.stringify(newBookmarks));
  };

  // iframe加载错误处理
  const handleIframeError = () => {
    console.error('Failed to load URL:', currentUrl);
  };

  // 主题处理
  const handleThemeChange = (theme: ThemeOption) => {
    setCurrentTheme(theme);
    Cookies.set('theme', theme.name);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <BrowserToolbar
          onBack={() => window.history.back()}
          onForward={() => window.history.forward()}
          onHome={() => setCurrentUrl('')}
          onRefresh={() => currentUrl && handleNavigate(currentUrl)}
          onBookmark={toggleBookmark}
          onBookmarksOpen={() => setIsBookmarksOpen(true)}
          onSettingsOpen={() => setIsSettingsOpen(true)}
          isBookmarked={bookmarks.some((b) => b.url === currentUrl)}
          currentUrl={currentUrl}
          onUrlChange={handleNavigate}
        />

        <div style={{ flex: 1, position: 'relative' }}>
          {currentUrl ? (
            <iframe
              src={currentUrl}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              title="browser-frame"
              onError={handleIframeError}
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            />
          ) : (
            <NewTab onNavigate={handleNavigate} />
          )}
        </div>

        <BookmarksDialog
          open={isBookmarksOpen}
          onClose={() => setIsBookmarksOpen(false)}
          bookmarks={bookmarks}
          onBookmarkClick={(url) => {
            handleNavigate(url);
            setIsBookmarksOpen(false);
          }}
          onBookmarkDelete={(url) => {
            const newBookmarks = bookmarks.filter((b) => b.url !== url);
            setBookmarks(newBookmarks);
            Cookies.set('bookmarks', JSON.stringify(newBookmarks));
          }}
        />

        <SettingsDialog
          open={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          themes={themeOptions}
          currentTheme={currentTheme.name}
          onThemeChange={handleThemeChange}
        />
      </div>
    </ThemeProvider>
  );
};

export default App;
