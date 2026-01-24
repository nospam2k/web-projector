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
  // Load dark mode from localStorage
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('isDarkMode');
    return saved ? JSON.parse(saved) : false;
  });

  const currentTheme = isDarkMode ? THEMES.dark : THEMES.light;

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  // Save to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('isDarkMode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  return { isDarkMode, setIsDarkMode, currentTheme, toggleTheme };
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

function useWebSocket(songs, setSongs, slides, setSlides, songItems, setSongItems, slideItems, setSlideItems, setSelectedLiveItem, setLiveBackgroundColor, setLiveBackgroundImage, setFontFamily, setFontStyle) {
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  const settersRef = useRef({
    setSongs,
    setSlides,
    setSongItems,
    setSlideItems,
    setSelectedLiveItem,
    setLiveBackgroundColor,
    setLiveBackgroundImage,
    setFontFamily,
    setFontStyle
  });

  useEffect(() => {
    settersRef.current = {
      setSongs,
      setSlides,
      setSongItems,
      setSlideItems,
      setSelectedLiveItem,
      setLiveBackgroundColor,
      setLiveBackgroundImage,
      setFontFamily,
      setFontStyle
    };
  });

  const connect = useRef(async () => {
    if (!mountedRef.current) return;

    // Test API connectivity first
    try {
      const testRes = await fetch('/api/test');
      const testData = await testRes.json();
    } catch (err) {
      console.error('[CLIENT] API test failed:', err);
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    let websocket;
    try {
      websocket = new WebSocket(wsUrl);
    } catch (err) {
      console.error('[CLIENT] Failed to create WebSocket:', err);
      return;
    }

    websocket.onopen = () => {
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        const setters = settersRef.current;

        switch (data.type) {
          case 'fullState':
            setters.setSongs(data.data.songs || []);
            setters.setSlides(data.data.slides || []);
            setters.setSongItems(data.data.songItems || []);
            setters.setSlideItems(data.data.slideItems || []);
            setters.setSelectedLiveItem(data.data.selectedLiveItem || null);
            if (data.data.settings) {
              // Dark mode is saved in localStorage, not synced from server
              if (typeof data.data.settings.liveBackgroundColor !== 'undefined') setters.setLiveBackgroundColor(data.data.settings.liveBackgroundColor || '#000000');
              if (typeof data.data.settings.liveBackgroundImage !== 'undefined') setters.setLiveBackgroundImage(data.data.settings.liveBackgroundImage || null);
              if (typeof data.data.settings.fontFamily !== 'undefined') setters.setFontFamily(data.data.settings.fontFamily);
              if (typeof data.data.settings.fontStyle !== 'undefined') setters.setFontStyle(data.data.settings.fontStyle);
            }
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
          case 'selectedLiveItem':
            setters.setSelectedLiveItem(data.data);
            break;
          case 'settings':
            if (data.data) {
              // Dark mode is saved in localStorage, not synced from server
              if (typeof data.data.liveBackgroundColor !== 'undefined') setters.setLiveBackgroundColor(data.data.liveBackgroundColor || '#000000');
              if (typeof data.data.liveBackgroundImage !== 'undefined') setters.setLiveBackgroundImage(data.data.liveBackgroundImage || null);
              if (typeof data.data.fontFamily !== 'undefined') setters.setFontFamily(data.data.fontFamily);
              if (typeof data.data.fontStyle !== 'undefined') setters.setFontStyle(data.data.fontStyle);
            }
            break;
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err, event.data);
      }
    };

    websocket.onclose = (event) => {
      // Only reconnect on abnormal closure (not user-initiated)
      if (mountedRef.current && event.code !== 1000 && event.code !== 1001) {
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

  const sendSelectedLiveItem = (selectedItem) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'updateSelectedLiveItem',
        selectedItem
      }));
    }
  };

  const sendSettings = (settings) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'updateSettings',
        settings
      }));
    }
  };

  return { sendUpdate, sendSelectedLiveItem, sendSettings };
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

function MenuBar({ activeButton, onButtonClick, theme, menuBarRef, uiFontFamily, uiFontSize, uiFontStyle }) {
  const getFontStyleProps = () => {
    switch (uiFontStyle) {
      case 'bold':
        return { fontWeight: 'bold', fontStyle: 'normal' };
      case 'italic':
        return { fontWeight: 'normal', fontStyle: 'italic' };
      case 'bold-italic':
        return { fontWeight: 'bold', fontStyle: 'italic' };
      default:
        return { fontWeight: 'normal', fontStyle: 'normal' };
    }
  };

  const uiStyle = {
    fontFamily: uiFontFamily,
    fontSize: `${uiFontSize}px`,
    ...getFontStyleProps()
  };

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
            style={uiStyle}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function ControlButtons({ theme, width, controlButtonsRef, onClearToggle, onHideToggle, uiFontFamily, uiFontSize, uiFontStyle, onPrev, onNext }) {
  const [isClearActive, setIsClearActive] = useState(false);
  const [isHideActive, setIsHideActive] = useState(false);

  const handleClearToggle = () => {
    setIsClearActive(!isClearActive);
    onClearToggle?.(!isClearActive);
  };

  const handleHideToggle = () => {
    setIsHideActive(!isHideActive);
    onHideToggle?.(!isHideActive);
  };

  return (
    <div ref={controlButtonsRef} className={`flex ${theme.leftPanel}`} style={{ width }}>
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          handleClearToggle();
        }}
        className={`flex-1 py-4 font-semibold transition duration-200 border ${theme.border} focus:outline-none focus:ring-0 ${
          isClearActive ? 'bg-green-500 text-white hover:bg-green-600 focus:bg-green-500 active:bg-green-500' : theme.menuButton
        }`}
        style={{ WebkitTapHighlightColor: 'transparent', fontFamily: uiFontFamily, fontSize: `${uiFontSize}px`, ...(uiFontStyle === 'bold' ? { fontWeight: 'bold' } : {}), ...(uiFontStyle === 'italic' ? { fontStyle: 'italic' } : {}), ...(uiFontStyle === 'bold-italic' ? { fontWeight: 'bold', fontStyle: 'italic' } : {}) }}
      >
        {isClearActive ? 'Show' : 'Clear'}
      </button>
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          handleHideToggle();
        }}
        className={`flex-1 py-4 font-semibold transition duration-200 border ${theme.border} focus:outline-none focus:ring-0 ${
          isHideActive ? 'bg-green-500 text-white hover:bg-green-600 focus:bg-green-500 active:bg-green-500' : theme.menuButton
        }`}
        style={{ WebkitTapHighlightColor: 'transparent', fontFamily: uiFontFamily, fontSize: `${uiFontSize}px`, ...(uiFontStyle === 'bold' ? { fontWeight: 'bold' } : {}), ...(uiFontStyle === 'italic' ? { fontStyle: 'italic' } : {}), ...(uiFontStyle === 'bold-italic' ? { fontWeight: 'bold', fontStyle: 'italic' } : {}) }}
      >
        {isHideActive ? 'Show' : 'Hide'}
      </button>
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          onPrev?.();
        }}
        className={`flex-1 py-4 font-semibold transition duration-200 border ${theme.border} focus:outline-none focus:ring-0 ${theme.menuButton}`}
        style={{ WebkitTapHighlightColor: 'transparent', fontFamily: uiFontFamily, fontSize: `${uiFontSize}px`, ...(uiFontStyle === 'bold' ? { fontWeight: 'bold' } : {}), ...(uiFontStyle === 'italic' ? { fontStyle: 'italic' } : {}), ...(uiFontStyle === 'bold-italic' ? { fontWeight: 'bold', fontStyle: 'italic' } : {}) }}
      >
        Previous
      </button>
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          onNext?.();
        }}
        className={`flex-1 py-4 font-semibold transition duration-200 border ${theme.border} focus:outline-none focus:ring-0 ${theme.menuButton}`}
        style={{ WebkitTapHighlightColor: 'transparent', fontFamily: uiFontFamily, fontSize: `${uiFontSize}px`, ...(uiFontStyle === 'bold' ? { fontWeight: 'bold' } : {}), ...(uiFontStyle === 'italic' ? { fontStyle: 'italic' } : {}), ...(uiFontStyle === 'bold-italic' ? { fontWeight: 'bold', fontStyle: 'italic' } : {}) }}
      >
        Next
      </button>
      
    </div>
  );
}

function RightPanel({ items, setItems, theme, isPortrait, rightPanelRef, dragHandlers, showToggle, toggleLabel, onToggle, onItemClick, selectedLiveItem, onDeleteItem, uiFontFamily, uiFontSize, uiFontStyle }) {
  const [selectedItem, setSelectedItem] = useState(null);

  // When the currently selected live item changes (e.g. from server),
  // highlight the corresponding item in this panel and scroll it into view.
  useEffect(() => {
    if (!selectedLiveItem || !items || !rightPanelRef?.current) return;

    // selectedLiveItem may be an object ({ id, songData/slideData }) or an id
    const selId = typeof selectedLiveItem === 'object' ? selectedLiveItem.id : selectedLiveItem;
    if (selId == null) return;

    const matchIndex = items.findIndex(it => String(it.id) === String(selId));
    if (matchIndex === -1) return;

    const matched = items[matchIndex];
    setSelectedItem(matched.id);

    // Scroll the matched list item into view if possible
    try {
      const container = rightPanelRef.current;
      const el = container.querySelector(`[data-item-index='${matchIndex}']`);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } catch (e) {
      // ignore
    }
  }, [selectedLiveItem, items, rightPanelRef]);

  const handleItemClick = (item) => {
    if (!dragHandlers.isDragging) {
      setSelectedItem(item.id);
      onItemClick?.(item);
    }
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
              <span className="cursor-pointer flex-1" onClick={() => handleItemClick(item)} style={{ fontFamily: uiFontFamily, fontSize: `${uiFontSize}px`, ...(uiFontStyle === 'bold' ? { fontWeight: 'bold' } : {}), ...(uiFontStyle === 'italic' ? { fontStyle: 'italic' } : {}), ...(uiFontStyle === 'bold-italic' ? { fontWeight: 'bold', fontStyle: 'italic' } : {}) }}>
                {item.text}
              </span>
              <button
                onClick={() => onDeleteItem?.(index)}
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

function LivePanel({ theme, leftPanelSize, controlButtonsRef, currentItems, liveBackgroundColor, liveBackgroundImage, selectedLiveItem, fontFamily = '', fontStyle = 'normal', uiFontFamily, uiFontSize, uiFontStyle, onPrev, onNext }) {
  const [fontSize, setFontSize] = useState(40);
  const [titleFontSize, setTitleFontSize] = useState(40);
  const [contentFontSize, setContentFontSize] = useState(30);
  const [isTextCleared, setIsTextCleared] = useState(false);
  const [isTextHidden, setIsTextHidden] = useState(false);
  const textRef = useRef(null);

  // Convert fontStyle prop to CSS properties
  const getFontStyleProps = () => {
    switch (fontStyle) {
      case 'bold':
        return { fontWeight: 'bold', fontStyle: 'normal' };
      case 'italic':
        return { fontWeight: 'normal', fontStyle: 'italic' };
      case 'bold-italic':
        return { fontWeight: 'bold', fontStyle: 'italic' };
      default:
        return { fontWeight: 'normal', fontStyle: 'normal' };
    }
  };

  const fontStyleProps = getFontStyleProps();

  const displayItem = selectedLiveItem || currentItems[0];
  const isSlide = !!displayItem?.slideData;
  const content = displayItem?.songData?.lyrics || displayItem?.slideData?.content || '';
  const slideTitle = displayItem?.slideData?.title || '';
  // Don't filter out empty lines - they still take up space in the display
  const lines = content.split('\n');
  const titleLines = slideTitle.split('\n').filter(line => line.trim());

  const backgroundStyle = {
    backgroundColor: isTextHidden ? '#000000' : liveBackgroundColor,
    backgroundImage: isTextHidden ? 'none' : (liveBackgroundImage ? `url(${liveBackgroundImage})` : 'none'),
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  };

  // Font calculation for songs (centered, original logic)
  useEffect(() => {
    if (isSlide) return; // Skip for slides
    if (!textRef.current || !lines.length) return;

    const containerWidth = parseFloat(leftPanelSize.width);
    const containerHeight = parseFloat(leftPanelSize.height);

    if (!containerWidth || !containerHeight) return;

    let size = 100;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    while (size > 10) {
      ctx.font = `${size}px ${fontFamily}`;

      // Measure the widest line (handle empty lines)
      const lineWidths = lines.map(line => line.trim() ? ctx.measureText(line).width : 0);
      const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
      const totalHeight = lines.length * size * 1.2;

      // Use tighter constraints (85% instead of 90%) to ensure text fits with margin
      if (maxLineWidth <= containerWidth * 0.85 && totalHeight <= containerHeight * 0.85) {
        setFontSize(size);
        return;
      }
      size -= 2;
    }
    // If no size fits, set minimum
    setFontSize(10);
  }, [leftPanelSize, lines, fontFamily, content, selectedLiveItem, isSlide]);

  // Font calculation for slides (title + content layout)
  useEffect(() => {
    if (!isSlide) return; // Skip for songs
    
    const containerWidth = parseFloat(leftPanelSize.width);
    const containerHeight = parseFloat(leftPanelSize.height);

    if (!containerWidth || !containerHeight) return;

    // Account for padding around the entire slide (20px)
    const totalPadding = 40; // 20px top + 20px bottom
    const availableHeight = containerHeight - totalPadding;

    // Title takes up smaller of 15% height or 50% width, line height always 15% of container height (max)
    const titleLineHeight = availableHeight * 0.15;
    const rectangleMaxWidth = containerWidth * 0.5;
    const rectanglePadding = 24; // 12px left + 12px right
    const rectangleVertPadding = 12; // 6px top + 6px bottom
    const maxTitleWidth = rectangleMaxWidth - rectanglePadding;
    const maxTitleHeight = titleLineHeight - rectangleVertPadding;
    
    // Calculate title font size to fit within rectangle constraints, accounting for descenders
    let titleSize = 100;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    while (titleSize > 10) {
      ctx.font = `${titleSize}px ${fontFamily}`;
      const textWidth = titleLines.length > 0 ? Math.max(...titleLines.map(line => ctx.measureText(line).width)) : 0;
      // Account for descenders - use larger multiplier for actual text height
      const textHeight = titleSize * 1.3;

      // Fit within both width and height constraints with slight margin (95%)
      if (textWidth <= maxTitleWidth * 0.95 && textHeight <= maxTitleHeight * 0.95) {
        setTitleFontSize(titleSize);
        break;
      }
      titleSize -= 2;
    }

    // Content takes up remaining height, left justified
    const contentHeight = availableHeight - titleLineHeight;
    const contentPadding = 24; // 12px left + 12px right
    const contentVertPadding = 12; // 6px top + 6px bottom
    const maxContentWidth = containerWidth * 0.95 - contentPadding;
    const maxContentHeight = contentHeight - contentVertPadding;
    
    if (lines.length === 0) {
      setContentFontSize(10);
      return;
    }

    let contentSize = 100;
    while (contentSize > 10) {
      ctx.font = `${contentSize}px ${fontFamily}`;

      // Measure the widest line (handle empty lines)
      const lineWidths = lines.map(line => line.trim() ? ctx.measureText(line).width : 0);
      const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
      const totalHeight = lines.length * contentSize * 1.2;

      // Use slightly smaller target (95%) to ensure proper margins within the rectangle
      if (maxLineWidth <= maxContentWidth * 0.95 && totalHeight <= maxContentHeight * 0.95) {
        setContentFontSize(contentSize);
        return;
      }
      contentSize -= 2;
    }
    // If no size fits, set minimum
    setContentFontSize(10);
  }, [leftPanelSize, titleLines, lines, fontFamily, isSlide, selectedLiveItem]);

  if (isSlide && !isTextCleared && !isTextHidden && slideTitle) {
    // Slide layout: title + content
    const totalPadding = 40; // 20px top + 20px bottom
    const availableHeight = parseFloat(leftPanelSize.height) - totalPadding;
    const titleLineHeight = availableHeight * 0.15;
    
    return (
      <>
        <div
          className="flex-shrink-0 relative overflow-hidden flex flex-col"
          style={{
            width: leftPanelSize.width,
            height: leftPanelSize.height,
            maxWidth: 'none',
            minWidth: '100px',
            minHeight: '56px',
            padding: '20px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '15px',
            ...backgroundStyle
          }}
        >
          {/* Title Section with Rounded Rectangle */}
          <div
            style={{
              height: titleLineHeight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'visible',
              padding: '0px'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                borderRadius: '12px',
                padding: '6px 12px',
                width: 'fit-content',
                maxWidth: '50%',
                height: '90%',
                border: '2px solid white'
              }}
            >
              <pre
                style={{
                  fontSize: `${titleFontSize}px`,
                  fontFamily: fontFamily,
                  ...fontStyleProps,
                  lineHeight: 1.1,
                  margin: 0,
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                  color: 'white',
                  WebkitTextStroke: '1px black',
                  textShadow: 'none',
                  overflow: 'visible'
                }}
              >
                {slideTitle}
              </pre>
            </div>
          </div>

          {/* Content Section */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'visible',
              padding: '0px'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                borderRadius: '12px',
                padding: '6px 12px',
                width: '100%',
                height: '100%',
                border: '2px solid white',
                overflow: 'auto'
              }}
            >
              <pre
                style={{
                  fontSize: `${contentFontSize}px`,
                  fontFamily: fontFamily,
                  ...fontStyleProps,
                  lineHeight: 1.2,
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word',
                  textAlign: 'left',
                  color: 'white',
                  WebkitTextStroke: '1px black',
                  textShadow: 'none'
                }}
              >
                {content}
              </pre>
            </div>
          </div>
        </div>
        <ControlButtons 
          theme={theme} 
          width={leftPanelSize.width} 
          controlButtonsRef={controlButtonsRef}
          onClearToggle={setIsTextCleared}
          onHideToggle={setIsTextHidden}
          onPrev={onPrev}
          onNext={onNext}
          uiFontFamily={uiFontFamily}
          uiFontSize={uiFontSize}
          uiFontStyle={uiFontStyle}
        />
      </>
    );
  }

  // Song layout: centered content (original layout)
  return (
    <>
      <div
        ref={textRef}
        className="flex-shrink-0 relative overflow-hidden flex items-center justify-center"
        style={{
          width: leftPanelSize.width,
          height: leftPanelSize.height,
          maxWidth: 'none',
          minWidth: '100px',
          minHeight: '56px',
          ...backgroundStyle
        }}
      >
        {!isTextCleared && !isTextHidden && (
          <pre style={{
            fontSize: `${fontSize}px`,
            fontFamily: fontFamily,
            ...fontStyleProps,
            lineHeight: 1.2,
            margin: 0,
            whiteSpace: 'pre',
            textAlign: 'center',
            color: 'white',
                  WebkitTextStroke: '1px black',
                  textShadow: 'none'
          }}>
            {content}
          </pre>
        )}
      </div>
      <ControlButtons 
        theme={theme} 
        width={leftPanelSize.width} 
        controlButtonsRef={controlButtonsRef}
        onClearToggle={setIsTextCleared}
        onHideToggle={setIsTextHidden}
        onPrev={onPrev}
        onNext={onNext}
        uiFontFamily={uiFontFamily}
        uiFontSize={uiFontSize}
        uiFontStyle={uiFontStyle}
      />
    </>
  );
}

function ChordsPanel({ theme, currentItems, selectedLiveItem }) {
  const [fontSize, setFontSize] = useState(16);
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const fontFamily = 'Arial';

  // Use selectedLiveItem if available, otherwise fall back to first item in list
  const displayItem = selectedLiveItem || currentItems[0];
  const content = displayItem?.songData?.chords || '';
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
  }, [lines, fontFamily, content, selectedLiveItem]);

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

function SongsPanel({ theme, songs, loading, onAddSong, setSongs, onSelectSong, isDarkMode, sendUpdate, selectedLiveItem, setSelectedLiveItem, setSongItems }) {
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingContent, setEditingContent] = useState('');

  useEffect(() => {
    if (editingId === null) {
      setEditingTitle('');
      setEditingContent('');
    }
  }, [editingId]);

  const startEditing = (song) => {
    setEditingId(song.id);
    setEditingTitle(song.title || '');
    setEditingContent(song.lyrics ?? song.content ?? song.body ?? '');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingTitle('');
    setEditingContent('');
  };

  const saveEditing = async (id) => {
    const newTitle = editingTitle.trim();
    const newContent = editingContent;
    if (!newTitle) return;

    // Optimistically update local state
    setSongs(prev => prev.map(s => (s.id === id ? { ...s, title: newTitle, lyrics: newContent } : s)));

    try {
      // Save to database - the server will broadcast to other clients via WebSocket
      const response = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, lyrics: newContent })
      });

      const responseData = await response.json();

      // Re-fetch saved song from DB to ensure canonical data
      const res = await fetch(`/api/songs/${id}`);
      if (res.ok) {
        const data = await res.json();

        // Update the songs list with fresh data from DB
        setSongs(prev => prev.map(s => (s.id === id ? data : s)));

        // Update song playlist items if this song is in the playlist (update the title)
        setSongItems(prev => prev.map(item =>
          item.id === id ? { ...item, text: data.title, songData: data } : item
        ));

        // If this song is currently selected, update the live display
        const sel = selectedLiveItem;
        if (sel) {
          const selId = sel.id ?? sel.songData?.id ?? sel.slideData?.id;
          if (selId === id) {
            setSelectedLiveItem({ songData: data, id: data.id });
          }
        }
      }
    } catch (err) {
      console.error('Failed to save song:', err);
    }

    setEditingId(null);
    setEditingTitle('');
    setEditingContent('');
  };

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
              {editingId === song.id ? (
                <div className="flex-1 flex flex-col gap-3">
                  {(() => {
                    const inputClass = `w-full px-2 py-1 rounded border ${isDarkMode ? 'bg-gray-800 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`;
                    const textareaClass = `w-full h-48 p-2 rounded border resize-vertical ${isDarkMode ? 'bg-gray-800 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`;
                    const saveBtn = `px-4 py-2 rounded ${isDarkMode ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'}`;
                    const cancelBtn = `px-4 py-2 rounded ${isDarkMode ? 'bg-gray-700 text-white' : 'bg-gray-300 text-black'}`;
                    return (
                      <>
                        <input
                          autoFocus
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          className={inputClass}
                          placeholder="Song title"
                        />
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className={textareaClass}
                          placeholder="Song lyrics or content"
                        />
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => saveEditing(song.id)} className={saveBtn}>Save</button>
                          <button onClick={cancelEditing} className={cancelBtn}>Cancel</button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <>
                  <span className="cursor-pointer flex-1" onClick={() => onSelectSong?.(song)}>{song.title}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEditing(song)} className="px-2 py-1 bg-yellow-300 rounded text-sm">Edit</button>
                    <Plus
                      size={20}
                      className="cursor-pointer flex-shrink-0"
                      onClick={() => onAddSong(song)}
                    />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SlidesPanel({ theme, slides, loading, onAddSlide, setSlides, onSelectSlide, isDarkMode, sendUpdate, selectedLiveItem, setSelectedLiveItem, setSlideItems }) {
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingContent, setEditingContent] = useState('');

  useEffect(() => {
    if (editingId === null) {
      setEditingTitle('');
      setEditingContent('');
    }
  }, [editingId]);

  const startEditing = (slide) => {
    setEditingId(slide.id);
    setEditingTitle(slide.title || '');
    setEditingContent(slide.content ?? slide.body ?? '');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingTitle('');
    setEditingContent('');
  };

  const saveEditing = async (id) => {
    const newTitle = editingTitle.trim();
    const newContent = editingContent;
    if (!newTitle) return;

    // Optimistically update local state
    setSlides(prev => prev.map(s => (s.id === id ? { ...s, title: newTitle, content: newContent } : s)));

    try {
      // Save to database - the server will broadcast to other clients via WebSocket
      const response = await fetch(`/api/slides/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, content: newContent })
      });

      const responseData = await response.json();

      // Re-fetch saved slide from DB to ensure canonical data
      const res = await fetch(`/api/slides/${id}`);
      if (res.ok) {
        const data = await res.json();

        // Update the slides list with fresh data from DB
        setSlides(prev => prev.map(s => (s.id === id ? data : s)));

        // Update slide playlist items if this slide is in the playlist (update the title)
        setSlideItems(prev => prev.map(item =>
          item.id === id ? { ...item, text: data.title, slideData: data } : item
        ));

        // If this slide is currently selected, update the live display
        const sel = selectedLiveItem;
        if (sel) {
          const selId = sel.id ?? sel.songData?.id ?? sel.slideData?.id;
          if (selId === id) {
            setSelectedLiveItem({ slideData: data, id: data.id });
          }
        }
      }
    } catch (err) {
      console.error('Failed to save slide:', err);
    }

    setEditingId(null);
    setEditingTitle('');
    setEditingContent('');
  };

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
              {editingId === slide.id ? (
                <div className="flex-1 flex flex-col gap-3">
                  {(() => {
                    const inputClass = `w-full px-2 py-1 rounded border ${isDarkMode ? 'bg-gray-800 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`;
                    const textareaClass = `w-full h-48 p-2 rounded border resize-vertical ${isDarkMode ? 'bg-gray-800 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`;
                    const saveBtn = `px-4 py-2 rounded ${isDarkMode ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'}`;
                    const cancelBtn = `px-4 py-2 rounded ${isDarkMode ? 'bg-gray-700 text-white' : 'bg-gray-300 text-black'}`;
                    return (
                      <>
                        <input
                          autoFocus
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          className={inputClass}
                          placeholder="Slide title"
                        />
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className={textareaClass}
                          placeholder="Slide content"
                        />
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => saveEditing(slide.id)} className={saveBtn}>Save</button>
                          <button onClick={cancelEditing} className={cancelBtn}>Cancel</button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <>
                  <span className="cursor-pointer flex-1" onClick={() => onSelectSlide?.(slide)}>{slide.title}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEditing(slide)} className="px-2 py-1 bg-yellow-300 rounded text-sm">Edit</button>
                    <Plus
                      size={20}
                      className="cursor-pointer flex-shrink-0"
                      onClick={() => onAddSlide(slide)}
                    />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LeftPanel({ activeButton, theme, isPortrait, leftPanelSize, controlButtonsRef, songs, slides, loading, onAddSong, onAddSlide, currentItems, liveBackgroundColor, liveBackgroundImage, selectedLiveItem, setSongs, setSlides, onSelectSong, onSelectSlide, isDarkMode, setSelectedLiveItem, setSongItems, setSlideItems, fontFamily, fontStyle, uiFontFamily, uiFontSize, uiFontStyle, onPrev, onNext }) {
  const renderPanel = () => {
    switch (activeButton) {
      case 'Live':
        return <LivePanel theme={theme} leftPanelSize={leftPanelSize} controlButtonsRef={controlButtonsRef} currentItems={currentItems} liveBackgroundColor={liveBackgroundColor} liveBackgroundImage={liveBackgroundImage} selectedLiveItem={selectedLiveItem} fontFamily={fontFamily} fontStyle={fontStyle} uiFontFamily={uiFontFamily} uiFontSize={uiFontSize} uiFontStyle={uiFontStyle} onPrev={onPrev} onNext={onNext} />;
      case 'Chords':
        return <ChordsPanel theme={theme} currentItems={currentItems} selectedLiveItem={selectedLiveItem} />;
      case 'Songs':
        return <SongsPanel theme={theme} songs={songs} loading={loading} onAddSong={onAddSong} setSongs={setSongs} onSelectSong={onSelectSong} isDarkMode={isDarkMode} sendUpdate={sendUpdate} selectedLiveItem={selectedLiveItem} setSelectedLiveItem={setSelectedLiveItem} setSongItems={setSongItems} />;
      case 'Slides':
        return <SlidesPanel theme={theme} slides={slides} loading={loading} onAddSlide={onAddSlide} setSlides={setSlides} onSelectSlide={onSelectSlide} isDarkMode={isDarkMode} sendUpdate={sendUpdate} selectedLiveItem={selectedLiveItem} setSelectedLiveItem={setSelectedLiveItem} setSlideItems={setSlideItems} />;
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

function SettingsPanel({ theme, isDarkMode, toggleTheme, liveBackgroundColor, setLiveBackgroundColor, liveBackgroundImage, setLiveBackgroundImage, fontFamily, setFontFamily, fontStyle, setFontStyle, sendSettings, uiFontFamily, setUiFontFamily, uiFontSize, setUiFontSize, uiFontStyle, setUiFontStyle, availableFonts }) {
  const [bkgimages, setBkgimages] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchBkgimages();
  }, []);

  const fetchBkgimages = async () => {
    try {
      const response = await fetch('/api/bkgimages');
      const data = await response.json();
      setBkgimages(data);
    } catch (err) {
      console.error('Failed to fetch background images:', err);
    }
  };

  const handleBkgimageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/bkgimages/upload', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (data.success) {
        fetchBkgimages();
      }
    } catch (err) {
      console.error('Failed to upload background image:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBkgimageSelect = (bkgimagePath) => {
    setLiveBackgroundImage(bkgimagePath);
  };

  const handleBkgimageDelete = async (filename) => {
    if (!window.confirm(`Delete background image "${filename}"?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/bkgimages/${filename}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (data.success) {
        if (liveBackgroundImage?.includes(filename)) {
          setLiveBackgroundImage(null);
        }
        fetchBkgimages();
      }
    } catch (err) {
      console.error('Failed to delete background image:', err);
    }
  };

  const clearBackgroundImage = () => {
    setLiveBackgroundImage(null);
  };

  return (
    <div className={`p-8 ${theme.bg} overflow-auto h-full`}>
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

        <div className="border-t pt-4 mt-4">
          <h3 className="font-semibold mb-4">Text Display Settings</h3>

            <div className={`p-4 rounded border ${theme.border} mb-4`}>
            <label className="block mb-2 text-sm">Font Family</label>
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className={`w-full p-2 rounded border ${isDarkMode ? 'bg-gray-800 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`}
            >
              {availableFonts && availableFonts.length > 0 ? (
                availableFonts.map(f => (
                  <option key={f.filename} value={f.family}>{f.family}</option>
                ))
              ) : (
                <option value="" disabled>No fonts found in /fonts — add font files</option>
              )}
            </select>
          </div>

          <div className={`p-4 rounded border ${theme.border} mb-4`}>
            <label className="block mb-2 text-sm">Font Style</label>
            <select
              value={fontStyle}
              onChange={(e) => setFontStyle(e.target.value)}
              className={`w-full p-2 rounded border ${isDarkMode ? 'bg-gray-800 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`}
            >
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
              <option value="italic">Italic</option>
              <option value="bold-italic">Bold Italic</option>
            </select>
          </div>
          
          <div className="border-t pt-4 mt-4">
            <h3 className="font-semibold mb-4">UI Font Settings (menus, buttons, lists)</h3>

            <div className={`p-4 rounded border ${theme.border} mb-4`}>
              <label className="block mb-2 text-sm">UI Font Family</label>
              <select
                value={uiFontFamily}
                onChange={(e) => setUiFontFamily(e.target.value)}
                className={`w-full p-2 rounded border ${isDarkMode ? 'bg-gray-800 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`}
              >
                {availableFonts && availableFonts.length > 0 ? (
                  availableFonts.map(f => (
                    <option key={f.filename} value={f.family}>{f.family}</option>
                  ))
                ) : (
                  <option value="" disabled>No fonts found in /fonts — add font files</option>
                )}
              </select>
            </div>

            <div className={`p-4 rounded border ${theme.border} mb-4`}>
              <label className="block mb-2 text-sm">UI Font Size (px)</label>
              <input
                type="number"
                min={10}
                max={36}
                value={uiFontSize}
                onChange={(e) => setUiFontSize(e.target.value)}
                className={`w-32 p-2 rounded border ${isDarkMode ? 'bg-gray-800 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`}
              />
            </div>

            <div className={`p-4 rounded border ${theme.border} mb-4`}>
              <label className="block mb-2 text-sm">UI Font Style</label>
              <select
                value={uiFontStyle}
                onChange={(e) => setUiFontStyle(e.target.value)}
                className={`w-full p-2 rounded border ${isDarkMode ? 'bg-gray-800 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`}
              >
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
                <option value="italic">Italic</option>
                <option value="bold-italic">Bold Italic</option>
              </select>
            </div>
          </div>
        </div>

        <div className="border-t pt-4 mt-4">
          <h3 className="font-semibold mb-4">Live Display Background</h3>

          <div className={`p-4 rounded border ${theme.border} mb-4`}>
            <label className="block mb-2 text-sm">Background Color</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={liveBackgroundColor}
                onChange={(e) => setLiveBackgroundColor(e.target.value)}
                className="w-16 h-10 cursor-pointer rounded"
              />
              <span className="text-sm">{liveBackgroundColor}</span>
            </div>
          </div>

          <div className={`p-4 rounded border ${theme.border} mb-4`}>
            <label className="block mb-2 text-sm">Upload Background Image (JPG)</label>
            <input
              type="file"
              accept="image/jpeg,image/jpg"
              onChange={handleBkgimageUpload}
              disabled={loading}
              className="block w-full text-sm"
            />
            {loading && <p className="text-xs text-blue-600 mt-2">Uploading...</p>}
          </div>

          <div className={`p-4 rounded border ${theme.border}`}>
            {bkgimages.length === 0 ? (
              <p className="text-xs text-gray-500">No background images saved yet</p>
            ) : (
              <div className="grid grid-cols-9 gap-2">
                {bkgimages.map((bkgimg) => (
                  <div key={bkgimg.filename} className="relative group">
                    <div
                      onClick={() => handleBkgimageSelect(bkgimg.path)}
                      className={`cursor-pointer overflow-hidden rounded transition-all hover:opacity-75 border-2 ${
                        liveBackgroundImage?.includes(bkgimg.filename)
                          ? 'border-blue-500'
                          : isDarkMode ? 'border-gray-600' : 'border-gray-300'
                      }`}
                      style={{ paddingBottom: '56.25%', position: 'relative' }}
                    >
                      <img
                        src={bkgimg.path}
                        alt="background image"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover'
                        }}
                      />
                    </div>
                    <button
                      onClick={() => handleBkgimageDelete(bkgimg.filename)}
                      className="absolute top-1 right-1 bg-red-500 hover:bg-red-700 text-white rounded-full p-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete background image"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
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
  const [liveBackgroundColor, setLiveBackgroundColor] = useState('#000000');
  const [liveBackgroundImage, setLiveBackgroundImage] = useState(null);
  const [fontFamily, setFontFamily] = useState('');
  const [fontStyle, setFontStyle] = useState('normal');
  const [selectedLiveItem, setSelectedLiveItem] = useState(null);

  // UI font settings (stored in localStorage, not synced)
  const [uiFontSize, setUiFontSize] = useState(() => {
    return localStorage.getItem('uiFontSize') || '14';
  });
  const [uiFontFamily, setUiFontFamily] = useState(() => {
    return localStorage.getItem('uiFontFamily') || 'inherit';
  });
  const [uiFontStyle, setUiFontStyle] = useState(() => {
    return localStorage.getItem('uiFontStyle') || 'normal';
  });

  const [availableFonts, setAvailableFonts] = useState([]);

  // Fetch available fonts from server on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/fonts');
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setAvailableFonts(data || []);

        // If no explicit fontFamily chosen yet and we have fonts, pick first available
        if (!fontFamily && data && data.length > 0) {
          setFontFamily(data[0].family);
        }
        if (!uiFontFamily && data && data.length > 0) {
          setUiFontFamily(data[0].family);
        }
      } catch (err) {
        console.error('Failed to fetch fonts:', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Inject @font-face rules for discovered fonts so browsers will load them
  useEffect(() => {
    if (!availableFonts || availableFonts.length === 0) return;

    const existing = document.getElementById('discovered-fonts-css');
    if (existing) existing.remove();

    const style = document.createElement('style');
    style.id = 'discovered-fonts-css';

    const rules = availableFonts.map(f => {
      const ext = f.filename.split('.').pop().toLowerCase();
      let format = '';
      if (ext === 'woff2') format = "format('woff2')";
      else if (ext === 'woff') format = "format('woff')";
      else if (ext === 'ttf') format = "format('truetype')";
      else if (ext === 'otf') format = "format('opentype')";
      else if (ext === 'eot') format = "";
      const src = `url(${f.url}) ${format}`.trim();
      return `@font-face { font-family: '${f.family}'; src: ${src}; font-display: swap; }`;
    }).join('\n');

    style.appendChild(document.createTextNode(rules));
    document.head.appendChild(style);
  }, [availableFonts]);

  // Persist UI font settings to localStorage (these are per-browser settings)
  useEffect(() => {
    try {
      localStorage.setItem('uiFontSize', String(uiFontSize));
      localStorage.setItem('uiFontFamily', String(uiFontFamily));
      localStorage.setItem('uiFontStyle', String(uiFontStyle));
    } catch (e) {
      // ignore localStorage errors
    }
  }, [uiFontSize, uiFontFamily, uiFontStyle]);

  const menuBarRef = useRef(null);
  const controlButtonsRef = useRef(null);
  const rightPanelRef = useRef(null);

  const { isDarkMode, setIsDarkMode, currentTheme, toggleTheme } = useTheme();
  const { songs, setSongs, slides, setSlides, songItems, setSongItems, slideItems, setSlideItems, loading } = useDatabase();

  // WebSocket hook
  const { sendUpdate, sendSelectedLiveItem, sendSettings } = useWebSocket(
    songs, setSongs,
    slides, setSlides,
    songItems, setSongItems,
    slideItems, setSlideItems,
    setSelectedLiveItem,
    setLiveBackgroundColor,
    setLiveBackgroundImage,
    setFontFamily,
    setFontStyle
  );

  const triggerRecalc = `${liveToggleSongs}-${chordsToggleSongs}-${songItems.length}-${slideItems.length}`;
  const { isPortrait, leftPanelSize } = useLayout(menuBarRef, controlButtonsRef, rightPanelRef, triggerRecalc);

  // Initialize selectedLiveItem when data first loads (only if not already set from server)
  const hasInitialized = useRef(false);
  useEffect(() => {
    // Only run once when data first arrives
    if (hasInitialized.current) return;
    if (selectedLiveItem !== null) {
      hasInitialized.current = true;
      return; // Already initialized from server
    }
    if (songItems.length === 0 && slideItems.length === 0) return; // No data yet

    hasInitialized.current = true;

    // Determine which items to use based on current view
    let itemsToCheck = [];
    let isSlideList = false;

    if (activeButton === 'Live') {
      itemsToCheck = liveToggleSongs ? songItems : slideItems;
      isSlideList = !liveToggleSongs;
    } else if (activeButton === 'Chords') {
      itemsToCheck = chordsToggleSongs ? songItems : slideItems;
      isSlideList = !chordsToggleSongs;
    } else if (activeButton === 'Songs') {
      itemsToCheck = songItems;
      isSlideList = false;
    } else if (activeButton === 'Slides') {
      itemsToCheck = slideItems;
      isSlideList = true;
    }

    // If there are items, select the first one
    if (itemsToCheck.length > 0) {
      const firstItem = itemsToCheck[0];
      setSelectedLiveItem(firstItem);

      // Ensure the right panel toggle matches the type of item
      if (activeButton === 'Live') {
        setLiveToggleSongs(!isSlideList);
      } else if (activeButton === 'Chords') {
        setChordsToggleSongs(!isSlideList);
      }
    }
  }, [songItems, slideItems]);

  // Save selectedLiveItem to database whenever it changes
  const selectedLiveItemIdRef = useRef(null);
  const isFirstRender = useRef(true);
  useEffect(() => {
    // Skip the first render to avoid saving the initial null value
    if (isFirstRender.current) {
      isFirstRender.current = false;
      selectedLiveItemIdRef.current = selectedLiveItem?.id || null;
      return;
    }

    const currentId = selectedLiveItem?.id || null;

    // Skip if the ID hasn't actually changed (comparing IDs instead of object references)
    if (selectedLiveItemIdRef.current === currentId) {
      return;
    }
    selectedLiveItemIdRef.current = currentId;

    if (selectedLiveItem !== null) {
      sendSelectedLiveItem(selectedLiveItem);
    }
  }, [selectedLiveItem, sendSelectedLiveItem]);

  // When selectedLiveItem loads from database, ensure the correct toggle is set
  useEffect(() => {
    if (!selectedLiveItem) return;

    const isSlide = !!selectedLiveItem.slideData;

    if (activeButton === 'Live') {
      setLiveToggleSongs(!isSlide);
    } else if (activeButton === 'Chords') {
      setChordsToggleSongs(!isSlide);
    }
  }, [selectedLiveItem]);

  // Save settings to database when they change (dark mode is saved in localStorage, not DB)
  const settingsRef = useRef({ liveBackgroundColor, liveBackgroundImage, fontFamily, fontStyle });
  const isFirstSettingsRender = useRef(true);
  useEffect(() => {
    // Skip first render to avoid saving initial values
    if (isFirstSettingsRender.current) {
      isFirstSettingsRender.current = false;
      settingsRef.current = { liveBackgroundColor, liveBackgroundImage };
      return;
    }

    // Check if any setting actually changed
    const hasChanged =
      settingsRef.current.liveBackgroundColor !== liveBackgroundColor ||
      settingsRef.current.liveBackgroundImage !== liveBackgroundImage ||
      settingsRef.current.fontFamily !== fontFamily ||
      settingsRef.current.fontStyle !== fontStyle;

    if (!hasChanged) return;

    settingsRef.current = { liveBackgroundColor, liveBackgroundImage, fontFamily, fontStyle };

    // Send to server (dark mode is NOT synced, it's per-device)
    sendSettings({
      liveBackgroundColor,
      liveBackgroundImage,
      fontFamily,
      fontStyle
    });
  }, [liveBackgroundColor, liveBackgroundImage, fontFamily, fontStyle, sendSettings]);

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

  const getCurrentPlaylistType = () => {
    if (activeButton === 'Songs') return 'songs';
    if (activeButton === 'Slides') return 'slides';
    if (activeButton === 'Live') {
      return liveToggleSongs ? 'songs' : 'slides';
    }
    if (activeButton === 'Chords') {
      return chordsToggleSongs ? 'songs' : 'slides';
    }
    return 'songs';
  };

  const handleDragEnd = (finalItems) => {
    const playlistType = getCurrentPlaylistType();
    sendUpdate('updatePlaylist', playlistType, finalItems);
  };

  const handleDeleteFromPlaylist = (index) => {
    const items = getRightPanelItems();
    const setItems = getRightPanelSetItems();
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);

    const playlistType = getCurrentPlaylistType();
    sendUpdate('updatePlaylist', playlistType, newItems);
  };

  const getSelectedId = () => {
    if (!selectedLiveItem) return null;
    return selectedLiveItem.id ?? selectedLiveItem.songData?.id ?? selectedLiveItem.slideData?.id ?? null;
  };

  const handlePrevSelection = () => {
    const items = rightPanelItems;
    const selId = getSelectedId();
    if (!selId || !items || items.length === 0) return;
    const idx = items.findIndex(it => String(it.id) === String(selId));
    if (idx <= 0) return; // nothing to do if first or not found
    const prev = items[idx - 1];
    if (prev) setSelectedLiveItem(prev);
  };

  const handleNextSelection = () => {
    const items = rightPanelItems;
    const selId = getSelectedId();
    if (!selId || !items || items.length === 0) return;
    const idx = items.findIndex(it => String(it.id) === String(selId));
    if (idx === -1 || idx >= items.length - 1) return; // nothing to do if last or not found
    const next = items[idx + 1];
    if (next) setSelectedLiveItem(next);
  };

  const rightPanelItems = getRightPanelItems();
  const rightPanelSetItems = getRightPanelSetItems();
  const dragHandlers = useDragAndDrop(rightPanelItems, rightPanelSetItems, handleDragEnd);

  const handleButtonClick = (buttonName) => {
    setActiveButton(buttonName);
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

  // When a song/slide is selected from the left panel, fetch latest from DB and set as live item
  const handleSelectSong = async (song) => {
    if (!song || !song.id) return;
    try {
      const res = await fetch(`/api/songs/${song.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedLiveItem({ songData: data, id: data.id });
        return;
      }
    } catch (err) {
      console.error('Failed to fetch song from DB:', err);
    }
    // Fallback to using provided object
    setSelectedLiveItem({ songData: song, id: song.id });
  };

  const handleSelectSlide = async (slide) => {
    if (!slide || !slide.id) return;
    try {
      const res = await fetch(`/api/slides/${slide.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedLiveItem({ slideData: data, id: data.id });
        return;
      }
    } catch (err) {
      console.error('Failed to fetch slide from DB:', err);
    }
    setSelectedLiveItem({ slideData: slide, id: slide.id });
  };

  return (
    <div className={`min-h-screen ${currentTheme.bg}`}>
      <MenuBar 
        activeButton={activeButton}
        onButtonClick={handleButtonClick}
        theme={currentTheme}
        menuBarRef={menuBarRef}
        uiFontFamily={uiFontFamily}
        uiFontSize={uiFontSize}
        uiFontStyle={uiFontStyle}
      />

      {activeButton === 'Settings' ? (
        <SettingsPanel
          theme={currentTheme}
          isDarkMode={isDarkMode}
          toggleTheme={toggleTheme}
          liveBackgroundColor={liveBackgroundColor}
          setLiveBackgroundColor={setLiveBackgroundColor}
          liveBackgroundImage={liveBackgroundImage}
          setLiveBackgroundImage={setLiveBackgroundImage}
          fontFamily={fontFamily}
          setFontFamily={setFontFamily}
          fontStyle={fontStyle}
          setFontStyle={setFontStyle}
          sendSettings={sendSettings}
          uiFontFamily={uiFontFamily}
          setUiFontFamily={setUiFontFamily}
          uiFontSize={uiFontSize}
          setUiFontSize={setUiFontSize}
          uiFontStyle={uiFontStyle}
          setUiFontStyle={setUiFontStyle}
          availableFonts={availableFonts}
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
            setSongs={setSongs}
            slides={slides}
            setSlides={setSlides}
            loading={loading}
            onAddSong={handleAddSong}
            onAddSlide={handleAddSlide}
            onSelectSong={handleSelectSong}
            onSelectSlide={handleSelectSlide}
            isDarkMode={isDarkMode}
            sendUpdate={sendUpdate}
            selectedLiveItem={selectedLiveItem}
            setSelectedLiveItem={setSelectedLiveItem}
            setSongItems={setSongItems}
            setSlideItems={setSlideItems}
            currentItems={currentItems}
            liveBackgroundColor={liveBackgroundColor}
            liveBackgroundImage={liveBackgroundImage}
            fontFamily={fontFamily}
            fontStyle={fontStyle}
            uiFontFamily={uiFontFamily}
            uiFontSize={uiFontSize}
            uiFontStyle={uiFontStyle}
            onPrev={handlePrevSelection}
            onNext={handleNextSelection}
          />

          <RightPanel
            key={triggerRecalc}
            items={rightPanelItems}
            setItems={rightPanelSetItems}
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
            onItemClick={setSelectedLiveItem}
            selectedLiveItem={selectedLiveItem}
            onDeleteItem={handleDeleteFromPlaylist}
            uiFontFamily={uiFontFamily}
            uiFontSize={uiFontSize}
            uiFontStyle={uiFontStyle}
          />
        </div>
      )}
    </div>
  );
}