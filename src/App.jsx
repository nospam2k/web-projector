import { useState, useEffect, useRef } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';

// ============================================================================
// CONSTANTS
// ============================================================================

const THEMES = {
  light: {
    bg: 'bg-gray-100',
    menuBar: 'bg-white',
    menuButton: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:outline-none focus:bg-gray-100 active:bg-gray-100',
    menuButtonActive: 'bg-blue-500 text-white focus:outline-none focus:bg-blue-500 active:bg-blue-500',
    leftPanel: 'bg-white text-gray-900',
    rightPanel: 'bg-gray-200 text-gray-900',
    border: 'border-gray-300'
  },
  dark: {
    bg: 'bg-gray-900',
    menuBar: 'bg-black',
    menuButton: 'bg-gray-800 text-gray-300 hover:bg-gray-700 focus:outline-none focus:bg-gray-800 active:bg-gray-800',
    menuButtonActive: 'bg-blue-500 text-white focus:outline-none focus:bg-blue-500 active:bg-blue-500',
    leftPanel: 'bg-gray-800 text-gray-100',
    rightPanel: 'bg-gray-700 text-gray-100',
    border: 'border-gray-600'
  }
};

const MENU_ITEMS = ['Live', 'Chords', 'Songs', 'Slides', 'Settings'];

// ============================================================================
// HOOKS
// ============================================================================

function useTheme() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const currentTheme = isDarkMode ? THEMES.dark : THEMES.light;
  const toggleTheme = () => setIsDarkMode(!isDarkMode);
  return { isDarkMode, currentTheme, toggleTheme };
}

function useDatabase() {
  const [songs, setSongs] = useState([]);
  const [slides, setSlides] = useState([]);
  const [songItems, setSongItems] = useState([]);
  const [slideItems, setSlideItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadSongs = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/songs');
      const result = await response.json();
      setSongs(result || []);
    } catch (err) {
      console.error('Error loading songs:', err);
      setSongs([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSlides = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/slides');
      const result = await response.json();
      setSlides(result || []);
    } catch (err) {
      console.error('Error loading slides:', err);
      setSlides([]);
    } finally {
      setLoading(false);
    }
  };

  const loadPlaylists = async () => {
    try {
      const songsResponse = await fetch('/api/playlist/songs');
      const slidesResponse = await fetch('/api/playlist/slides');
      const songs = await songsResponse.json();
      const slides = await slidesResponse.json();
      setSongItems(songs || []);
      setSlideItems(slides || []);
    } catch (err) {
      console.error('Error loading playlists:', err);
    }
  };

  useEffect(() => {
    loadSongs();
    loadSlides();
    loadPlaylists();
  }, []);

  return { songs, setSongs, slides, setSlides, songItems, setSongItems, slideItems, setSlideItems, loading };
}

function useWebSocket(songs, setSongs, slides, setSlides, songItems, setSongItems, slideItems, setSlideItems) {
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  const settersRef = useRef({
    setSongs,
    setSlides,
    setSongItems,
    setSlideItems
  });

  useEffect(() => {
    settersRef.current = {
      setSongs,
      setSlides,
      setSongItems,
      setSlideItems
    };
  });

  const connect = useRef(async () => {
    if (!mountedRef.current) return;

    // Test API connectivity first
    try {
      const testRes = await fetch('/api/test');
      const testData = await testRes.json();
      console.log('[CLIENT] API test:', testData);
    } catch (err) {
      console.error('[CLIENT] API test failed:', err);
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;
    console.log('[CLIENT] Attempting WebSocket connection');
    console.log('[CLIENT] Protocol:', protocol);
    console.log('[CLIENT] Host:', host);
    console.log('[CLIENT] Full URL:', wsUrl);
    console.log('[CLIENT] Current page location:', window.location.href);

    let websocket;
    try {
      websocket = new WebSocket(wsUrl);
      console.log('[CLIENT] WebSocket object created, readyState:', websocket.readyState);
    } catch (err) {
      console.error('[CLIENT] Failed to create WebSocket:', err);
      return;
    }

    websocket.onopen = () => {
      console.log('[CLIENT] WebSocket OPENED, readyState:', websocket.readyState);
    };

    websocket.onmessage = (event) => {
      try {
        console.log('WebSocket message received, size:', event.data.length, 'bytes');
        const data = JSON.parse(event.data);
        console.log('WebSocket received:', data.type);

        const setters = settersRef.current;

        switch (data.type) {
          case 'fullState':
            console.log('Setting full state:', {
              songs: data.data.songs?.length,
              slides: data.data.slides?.length,
              songItems: data.data.songItems?.length,
              slideItems: data.data.slideItems?.length
            });
            setters.setSongs(data.data.songs || []);
            setters.setSlides(data.data.slides || []);
            setters.setSongItems(data.data.songItems || []);
            setters.setSlideItems(data.data.slideItems || []);
            break;
          case 'songs':
            setters.setSongs(data.data);
            break;
          case 'slides':
            setters.setSlides(data.data);
            break;
          case 'songItems':
            setters.setSongItems(data.data);
            break;
          case 'slideItems':
            setters.setSlideItems(data.data);
            break;
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err, event.data);
      }
    };

    websocket.onclose = (event) => {
      console.log('[CLIENT] WebSocket CLOSED');
      console.log('[CLIENT] Close code:', event.code);
      console.log('[CLIENT] Close reason:', event.reason);
      console.log('[CLIENT] Was clean:', event.wasClean);
      console.log('[CLIENT] ReadyState:', websocket.readyState);
      // Only reconnect on abnormal closure (not user-initiated)
      if (mountedRef.current && event.code !== 1000 && event.code !== 1001) {
        console.log('[CLIENT] Reconnecting in 2s...');
        reconnectTimeoutRef.current = setTimeout(() => {
          connect.current();
        }, 2000);
      }
    };

    websocket.onerror = (error) => {
      console.error('[CLIENT] WebSocket ERROR');
      console.error('[CLIENT] Error event:', error);
      console.error('[CLIENT] ReadyState at error:', websocket.readyState);
    };

    wsRef.current = websocket;
  });

  useEffect(() => {
    connect.current();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const sendUpdate = (type, playlistType, items) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type,
        playlistType,
        items
      }));
    }
  };

  return { sendUpdate };
}

function useLayout(menuBarRef, controlButtonsRef, rightPanelRef, triggerRecalc) {
  const [isPortrait, setIsPortrait] = useState(true);
  const [leftPanelSize, setLeftPanelSize] = useState({ width: '100%', height: '0px' });

  useEffect(() => {
    const handleResize = () => {
      requestAnimationFrame(() => {
        const portrait = window.innerHeight > window.innerWidth;
        setIsPortrait(portrait);

        const menuBarHeight = menuBarRef.current?.offsetHeight || 60;
        const controlButtonsHeight = controlButtonsRef.current?.offsetHeight || 60;
        const availableHeight = window.innerHeight - menuBarHeight - controlButtonsHeight;

        let availableWidth;
        if (portrait) {
          availableWidth = window.innerWidth;
        } else {
          const rightPanelWidth = rightPanelRef.current?.offsetWidth || 0;
          availableWidth = window.innerWidth - rightPanelWidth;
          if (availableWidth <= 0 || !rightPanelRef.current) {
            availableWidth = window.innerWidth * 0.65;
          }
        }

        const widthBasedHeight = availableWidth * (9 / 16);
        const heightBasedWidth = availableHeight * (16 / 9);

        let width, height;
        if (portrait) {
          width = availableWidth;
          height = widthBasedHeight;
        } else {
          if (widthBasedHeight <= availableHeight) {
            width = availableWidth;
            height = widthBasedHeight;
          } else {
            height = availableHeight;
            width = heightBasedWidth;
          }
        }

        if (width <= 0 || height <= 0 || !isFinite(width) || !isFinite(height)) {
          return;
        }

        setLeftPanelSize({ width: `${width}px`, height: `${height}px` });
      });
    };

    handleResize();
    const timer = setTimeout(handleResize, 100);
    window.addEventListener('resize', handleResize);

    const resizeObserver = rightPanelRef.current ? new ResizeObserver(() => {
      setTimeout(handleResize, 50);
    }) : null;

    if (resizeObserver && rightPanelRef.current) {
      resizeObserver.observe(rightPanelRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [menuBarRef, controlButtonsRef, rightPanelRef, triggerRecalc]);

  return { isPortrait, leftPanelSize };
}

function useDragAndDrop(items, setItems, onDragEnd) {
  const [draggedItem, setDraggedItem] = useState(null);
  const [touchStartY, setTouchStartY] = useState(null);
  const [touchOffset, setTouchOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const handleDragStart = (e, index) => {
    setDraggedItem(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedItem === null || draggedItem === index) return;
    const newItems = [...items];
    const draggedItemContent = newItems[draggedItem];
    newItems.splice(draggedItem, 1);
    newItems.splice(index, 0, draggedItemContent);
    setDraggedItem(index);
    setItems(newItems);
  };

  const handleDragEnd = () => {
    const wasDragging = draggedItem !== null;
    setDraggedItem(null);
    if (wasDragging && onDragEnd) {
      setTimeout(() => onDragEnd(itemsRef.current), 0);
    }
  };

  const handleMouseDown = (e) => {
    const target = e.target.closest('svg, [data-grip]');
    if (!target) e.preventDefault();
  };

  const handleTouchStart = (e, index) => {
    const target = e.target.closest('svg, [data-grip]');
    if (target) {
      setTouchStartY(e.touches[0].clientY);
      setDraggedItem(index);
      setIsDragging(true);
      setTouchOffset(0);
      e.preventDefault();
    }
  };

  const handleTouchMove = (e) => {
    if (draggedItem === null || touchStartY === null) return;
    
    const currentY = e.touches[0].clientY;
    const offset = currentY - touchStartY;
    setTouchOffset(offset);
    
    const listItems = document.querySelectorAll('[data-item-index]');
    let hoverIndex = -1;
    
    listItems.forEach((li) => {
      const rect = li.getBoundingClientRect();
      const midPoint = rect.top + rect.height / 2;
      
      if (offset > 0) {
        if (currentY > midPoint) {
          const itemIndex = parseInt(li.getAttribute('data-item-index'));
          if (itemIndex > draggedItem) hoverIndex = itemIndex;
        }
      } else {
        if (currentY < midPoint) {
          const itemIndex = parseInt(li.getAttribute('data-item-index'));
          if (itemIndex < draggedItem && (hoverIndex === -1 || itemIndex > hoverIndex)) {
            hoverIndex = itemIndex;
          }
        }
      }
    });
    
    if (hoverIndex !== -1 && hoverIndex !== draggedItem) {
      const newItems = [...items];
      const draggedItemContent = newItems[draggedItem];
      newItems.splice(draggedItem, 1);
      newItems.splice(hoverIndex, 0, draggedItemContent);
      setDraggedItem(hoverIndex);
      setItems(newItems);
      setTouchStartY(currentY);
      setTouchOffset(0);
    }
    
    e.preventDefault();
  };

  const handleTouchEnd = () => {
    const wasDragging = draggedItem !== null;
    setDraggedItem(null);
    setTouchStartY(null);
    setTouchOffset(0);
    setTimeout(() => setIsDragging(false), 100);
    if (wasDragging && onDragEnd) {
      setTimeout(() => onDragEnd(itemsRef.current), 0);
    }
  };

  return {
    draggedItem,
    touchOffset,
    isDragging,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleMouseDown,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  };
}

// ============================================================================
// COMPONENTS
// ============================================================================

function MenuBar({ activeButton, onButtonClick, theme, menuBarRef }) {
  return (
    <div ref={menuBarRef} className={theme.menuBar}>
      <div className="flex w-full">
        {MENU_ITEMS.map((item) => (
          <button
            key={item}
            onClick={() => onButtonClick(item)}
            className={`flex-1 py-4 font-semibold transition duration-200 border ${theme.border} ${
              activeButton === item ? theme.menuButtonActive : theme.menuButton
            }`}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function ControlButtons({ theme, width, controlButtonsRef }) {
  const [isClearActive, setIsClearActive] = useState(false);
  const [isHideActive, setIsHideActive] = useState(false);

  return (
    <div ref={controlButtonsRef} className={`flex ${theme.leftPanel}`} style={{ width }}>
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          setIsClearActive(!isClearActive);
        }}
        style={{ WebkitTapHighlightColor: 'transparent' }}
        className={`flex-1 py-4 font-semibold transition duration-200 border ${theme.border} focus:outline-none focus:ring-0 ${
          isClearActive ? 'bg-green-500 text-white hover:bg-green-600 focus:bg-green-500 active:bg-green-500' : theme.menuButton
        }`}
      >
        {isClearActive ? 'Show' : 'Clear'}
      </button>
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          setIsHideActive(!isHideActive);
        }}
        style={{ WebkitTapHighlightColor: 'transparent' }}
        className={`flex-1 py-4 font-semibold transition duration-200 border ${theme.border} focus:outline-none focus:ring-0 ${
          isHideActive ? 'bg-green-500 text-white hover:bg-green-600 focus:bg-green-500 active:bg-green-500' : theme.menuButton
        }`}
      >
        {isHideActive ? 'Show' : 'Hide'}
      </button>
      <button
        style={{ WebkitTapHighlightColor: 'transparent' }}
        className={`flex-1 py-4 font-semibold transition duration-200 border ${theme.border} focus:outline-none focus:ring-0 ${theme.menuButton}`}
      >
        Previous
      </button>
      <button
        style={{ WebkitTapHighlightColor: 'transparent' }}
        className={`flex-1 py-4 font-semibold transition duration-200 border ${theme.border} focus:outline-none focus:ring-0 ${theme.menuButton}`}
      >
        Next
      </button>
    </div>
  );
}

function RightPanel({ items, setItems, theme, isPortrait, rightPanelRef, dragHandlers, showToggle, toggleLabel, onToggle }) {
  const [selectedItem, setSelectedItem] = useState(null);

  const handleItemClick = (item) => {
    if (!dragHandlers.isDragging) {
      setSelectedItem(item.id);
      console.log(`Clicked: ${item.text}`);
    }
  };

  const handleDeleteItem = (index) => {
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  return (
    <div ref={rightPanelRef} className={`overflow-auto ${theme.rightPanel} ${isPortrait ? 'w-full' : ''}`}>
      {showToggle && (
        <div className="p-4 pb-0">
          <button
            onClick={onToggle}
            className={`w-full py-2 px-4 rounded ${theme.menuButton}`}
          >
            {toggleLabel}
          </button>
        </div>
      )}
      <div className="p-4">
        <ul className="space-y-2 relative">
          {items.map((item, index) => (
            <li
              key={`${item.id}-${index}`}
              data-item-index={index}
              draggable
              onDragStart={(e) => dragHandlers.handleDragStart(e, index)}
              onDragOver={(e) => dragHandlers.handleDragOver(e, index)}
              onDragEnd={dragHandlers.handleDragEnd}
              onMouseDown={dragHandlers.handleMouseDown}
              onTouchStart={(e) => dragHandlers.handleTouchStart(e, index)}
              onTouchMove={dragHandlers.handleTouchMove}
              onTouchEnd={dragHandlers.handleTouchEnd}
              style={{
                transform: dragHandlers.draggedItem === index && dragHandlers.touchOffset !== 0
                  ? `translateY(${dragHandlers.touchOffset}px)`
                  : 'translateY(0)',
                transition: dragHandlers.draggedItem === index && dragHandlers.touchOffset !== 0 ? 'none' : 'all 0.2s ease',
                zIndex: dragHandlers.draggedItem === index ? 10 : 1,
                position: 'relative'
              }}
              className={`p-3 rounded whitespace-nowrap flex items-center justify-between gap-3 ${
                dragHandlers.draggedItem === index ? 'opacity-80 shadow-lg' : ''
              } ${
                selectedItem === item.id ? theme.menuButtonActive : theme.menuButton
              }`}
            >
              <span className="cursor-pointer flex-1" onClick={() => handleItemClick(item)}>
                {item.text}
              </span>
              <button
                onClick={() => handleDeleteItem(index)}
                className="flex-shrink-0 p-1 rounded bg-red-500 hover:bg-red-700 text-white transition-colors"
                title="Delete item"
              >
                <Trash2 size={18} />
              </button>
              <div data-grip className="cursor-move flex-shrink-0 touch-none">
                <GripVertical size={20} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LivePanel({ theme, leftPanelSize, controlButtonsRef, currentItems }) {
  const [fontSize, setFontSize] = useState(40);
  const textRef = useRef(null);
  const fontFamily = 'Arial Black';

  const currentItem = currentItems[0];
  const content = currentItem?.songData?.lyrics || currentItem?.slideData?.content || '';
  const lines = content.split('\n').filter(line => line.trim());

  useEffect(() => {
    if (!textRef.current || !lines.length) return;

    const containerWidth = parseFloat(leftPanelSize.width);
    const containerHeight = parseFloat(leftPanelSize.height);

    if (!containerWidth || !containerHeight) return;

    let size = 100;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    while (size > 10) {
      ctx.font = `${size}px ${fontFamily}`;

      const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
      const totalHeight = lines.length * size * 1.2;

      if (maxLineWidth <= containerWidth * 0.9 && totalHeight <= containerHeight * 0.9) {
        setFontSize(size);
        return;
      }
      size -= 2;
    }
  }, [leftPanelSize, lines, fontFamily, content, currentItems]);

  return (
    <>
      <div
        ref={textRef}
        className={`${theme.leftPanel} flex-shrink-0 relative overflow-hidden flex items-center justify-center`}
        style={{
          width: leftPanelSize.width,
          height: leftPanelSize.height,
          maxWidth: 'none',
          minWidth: '100px',
          minHeight: '56px'
        }}
      >
        <pre style={{
          fontSize: `${fontSize}px`,
          fontFamily: fontFamily,
          lineHeight: 1.2,
          margin: 0,
          whiteSpace: 'pre',
          textAlign: 'center',
          color: 'white',
          WebkitTextStroke: '1px black',
          textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black'
        }}>
          {content}
        </pre>
      </div>
      <ControlButtons theme={theme} width={leftPanelSize.width} controlButtonsRef={controlButtonsRef} />
    </>
  );
}

function ChordsPanel({ theme, currentItems }) {
  const [fontSize, setFontSize] = useState(16);
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const fontFamily = 'Arial';

  const currentItem = currentItems[0];
  const content = currentItem?.songData?.chords || '';
  const lines = content.split('\n');

  const isChordLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    
    const chordPattern = /\b[A-G](#|b)?(m|maj|min|sus|dim|aug|add)?[0-9]?\b/g;
    const matches = trimmed.match(chordPattern);
    
    if (matches) {
      const chordLength = matches.join('').length;
      const totalLength = trimmed.replace(/\s/g, '').length;
      return totalLength > 0 && (chordLength / totalLength) > 0.3;
    }
    return false;
  };

  useEffect(() => {
    if (!containerRef.current || !textRef.current || lines.length === 0) return;

    const resizeText = () => {
      const containerWidth = containerRef.current.clientWidth - 64;
      const containerHeight = containerRef.current.clientHeight - 64;

      if (!containerWidth || !containerHeight) return;

      let size = 100;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      while (size > 10) {
        const maxLineWidth = Math.max(...lines.map(line => {
          const weight = isChordLine(line) ? 'bold ' : '';
          ctx.font = `${weight}${size}px ${fontFamily}`;
          return ctx.measureText(line).width;
        }));
        const totalHeight = lines.length * size * 1.2;

        if (maxLineWidth <= containerWidth && totalHeight <= containerHeight) {
          setFontSize(size);
          return;
        }
        size -= 2;
      }
      setFontSize(10);
    };

    resizeText();
    window.addEventListener('resize', resizeText);
    return () => window.removeEventListener('resize', resizeText);
  }, [lines, fontFamily, content, currentItems]);

  return (
    <div ref={containerRef} className={`${theme.leftPanel} p-8 overflow-auto h-full`}>
      <div ref={textRef} style={{
        fontSize: `${fontSize}px`,
        fontFamily: fontFamily,
        lineHeight: 1.2,
        whiteSpace: 'pre'
      }}>
        {lines.map((line, index) => (
          <div key={index} style={{ fontWeight: isChordLine(line) ? 'bold' : 'normal' }}>
            {line || '\u00A0'}
          </div>
        ))}
      </div>
    </div>
  );
}

function SongsPanel({ theme, songs, loading, onAddSong }) {
  if (loading) {
    return (
      <div className={`${theme.leftPanel} p-8`}>
        <h2 className="text-xl font-bold mb-4">Songs</h2>
        <p className="text-gray-500">Loading songs...</p>
      </div>
    );
  }

  return (
    <div className={`${theme.leftPanel} p-8 overflow-auto`}>
      <h2 className="text-xl font-bold mb-4">Songs</h2>
      {songs.length === 0 ? (
        <p className="text-gray-500">No songs found in database</p>
      ) : (
        <ul className="space-y-2">
          {songs.map(song => (
            <li key={song.id} className={`p-3 rounded flex items-center justify-between ${theme.menuButton}`}>
              <span>{song.title}</span>
              <Plus
                size={20}
                className="cursor-pointer flex-shrink-0"
                onClick={() => onAddSong(song)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SlidesPanel({ theme, slides, loading, onAddSlide }) {
  if (loading) {
    return (
      <div className={`${theme.leftPanel} p-8`}>
        <h2 className="text-xl font-bold mb-4">Slides</h2>
        <p className="text-gray-500">Loading slides...</p>
      </div>
    );
  }

  return (
    <div className={`${theme.leftPanel} p-8 overflow-auto`}>
      <h2 className="text-xl font-bold mb-4">Slides</h2>
      {slides.length === 0 ? (
        <p className="text-gray-500">No slides found in database</p>
      ) : (
        <ul className="space-y-2">
          {slides.map(slide => (
            <li key={slide.id} className={`p-3 rounded flex items-center justify-between ${theme.menuButton}`}>
              <span>{slide.title}</span>
              <Plus
                size={20}
                className="cursor-pointer flex-shrink-0"
                onClick={() => onAddSlide(slide)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LeftPanel({ activeButton, theme, isPortrait, leftPanelSize, controlButtonsRef, songs, slides, loading, onAddSong, onAddSlide, currentItems }) {
  const renderPanel = () => {
    switch (activeButton) {
      case 'Live':
        return <LivePanel theme={theme} leftPanelSize={leftPanelSize} controlButtonsRef={controlButtonsRef} currentItems={currentItems} />;
      case 'Chords':
        return <ChordsPanel theme={theme} currentItems={currentItems} />;
      case 'Songs':
        return <SongsPanel theme={theme} songs={songs} loading={loading} onAddSong={onAddSong} />;
      case 'Slides':
        return <SlidesPanel theme={theme} slides={slides} loading={loading} onAddSlide={onAddSlide} />;
      default:
        return null;
    }
  };

  return (
    <div className={`flex flex-col ${isPortrait ? 'w-full' : 'flex-1'}`}>
      {renderPanel()}
    </div>
  );
}

function SettingsPanel({ theme, isDarkMode, toggleTheme }) {
  return (
    <div className={`p-8 ${theme.bg} overflow-auto`}>
      <div className={`space-y-4 ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
        <div className={`flex items-center justify-between p-4 rounded border ${theme.border}`}>
          <span className="font-semibold">Theme</span>
          <button
            onClick={toggleTheme}
            className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded transition duration-200"
          >
            {isDarkMode ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================

export default function App() {
  const [activeButton, setActiveButton] = useState('Live');
  const [liveToggleSongs, setLiveToggleSongs] = useState(true);
  const [chordsToggleSongs, setChordsToggleSongs] = useState(true);

  const menuBarRef = useRef(null);
  const controlButtonsRef = useRef(null);
  const rightPanelRef = useRef(null);

  const { isDarkMode, currentTheme, toggleTheme } = useTheme();
  const { songs, setSongs, slides, setSlides, songItems, setSongItems, slideItems, setSlideItems, loading } = useDatabase();

  // WebSocket hook
  const { sendUpdate } = useWebSocket(songs, setSongs, slides, setSlides, songItems, setSongItems, slideItems, setSlideItems);

  const triggerRecalc = `${liveToggleSongs}-${chordsToggleSongs}-${songItems.length}-${slideItems.length}`;
  const { isPortrait, leftPanelSize } = useLayout(menuBarRef, controlButtonsRef, rightPanelRef, triggerRecalc);


  useEffect(() => {
    if (rightPanelRef.current && !isPortrait) {
      rightPanelRef.current.style.width = '';
      rightPanelRef.current.style.minWidth = '';
      rightPanelRef.current.style.maxWidth = '';
      
      void rightPanelRef.current.offsetWidth;
      
      requestAnimationFrame(() => {
        if (rightPanelRef.current) {
          rightPanelRef.current.style.width = 'fit-content';
          rightPanelRef.current.style.minWidth = 'fit-content';
        }
      });
    }
  }, [triggerRecalc, isPortrait]);

  const currentItems = activeButton === 'Songs' ? songItems
    : activeButton === 'Slides' ? slideItems
    : activeButton === 'Live' ? songItems
    : activeButton === 'Chords' ? songItems
    : songItems;

  const setCurrentItems = activeButton === 'Songs' ? setSongItems
    : activeButton === 'Slides' ? setSlideItems
    : activeButton === 'Live' ? setSongItems
    : activeButton === 'Chords' ? setSongItems
    : setSongItems;

  const getRightPanelItems = () => {
    if (activeButton === 'Songs' || activeButton === 'Slides') {
      return currentItems;
    }
    if (activeButton === 'Live') {
      return liveToggleSongs ? songItems : slideItems;
    }
    if (activeButton === 'Chords') {
      return chordsToggleSongs ? songItems : slideItems;
    }
    return currentItems;
  };

  const getRightPanelSetItems = () => {
    if (activeButton === 'Songs' || activeButton === 'Slides') {
      return setCurrentItems;
    }
    if (activeButton === 'Live') {
      return liveToggleSongs ? setSongItems : setSlideItems;
    }
    if (activeButton === 'Chords') {
      return chordsToggleSongs ? setSongItems : setSlideItems;
    }
    return setCurrentItems;
  };

  const handleDragEnd = (finalItems) => {
    sendUpdate('updatePlaylist', currentPlaylistType, finalItems);
  };

  const dragHandlers = useDragAndDrop(currentItems, setCurrentItems, handleDragEnd);

  const handleButtonClick = (buttonName) => {
    setActiveButton(buttonName);
    console.log(`${buttonName} clicked`);
  };

  const handleAddSong = (song) => {
    setSongItems(prev => {
      const updated = [...prev, { id: song.id, text: song.title, songData: song }];
      sendUpdate('updatePlaylist', 'songs', updated);
      return updated;
    });
  };

  const handleAddSlide = (slide) => {
    setSlideItems(prev => {
      const updated = [...prev, { id: slide.id, text: slide.title, slideData: slide }];
      sendUpdate('updatePlaylist', 'slides', updated);
      return updated;
    });
  };

  return (
    <div className={`min-h-screen ${currentTheme.bg}`}>
      <MenuBar 
        activeButton={activeButton}
        onButtonClick={handleButtonClick}
        theme={currentTheme}
        menuBarRef={menuBarRef}
      />

      {activeButton === 'Settings' ? (
        <SettingsPanel 
          theme={currentTheme}
          isDarkMode={isDarkMode}
          toggleTheme={toggleTheme}
        />
      ) : (
        <div className={`flex h-[calc(100vh-60px)] overflow-hidden ${isPortrait ? 'flex-col' : 'flex-row'}`}>
          <LeftPanel
            activeButton={activeButton}
            theme={currentTheme}
            isPortrait={isPortrait}
            leftPanelSize={leftPanelSize}
            controlButtonsRef={controlButtonsRef}
            songs={songs}
            slides={slides}
            loading={loading}
            onAddSong={handleAddSong}
            onAddSlide={handleAddSlide}
            currentItems={currentItems}
          />

          <RightPanel
            key={triggerRecalc}
            items={getRightPanelItems()}
            setItems={getRightPanelSetItems()}
            theme={currentTheme}
            isPortrait={isPortrait}
            rightPanelRef={rightPanelRef}
            dragHandlers={dragHandlers}
            showToggle={activeButton === 'Live' || activeButton === 'Chords'}
            toggleLabel={activeButton === 'Live'
              ? (liveToggleSongs ? 'Slides' : 'Songs')
              : (chordsToggleSongs ? 'Slides' : 'Songs')}
            onToggle={() => {
              if (activeButton === 'Live') {
                setLiveToggleSongs(!liveToggleSongs);
              } else {
                setChordsToggleSongs(!chordsToggleSongs);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}