import { useState, useEffect, useRef } from 'react';

function PlainDisplay() {
  const [fontSize, setFontSize] = useState(40);
  const [titleFontSize, setTitleFontSize] = useState(40);
  const [contentFontSize, setContentFontSize] = useState(30);
  const [selectedLiveItem, setSelectedLiveItem] = useState(null);
  const [fontFamily, setFontFamily] = useState('');
  const [fontStyle, setFontStyle] = useState('normal');
  const textRef = useRef(null);
  const containerRef = useRef(null);

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

  // WebSocket connection
  useEffect(() => {
    let websocket;
    let reconnectTimeout;
    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws`;

      try {
        websocket = new WebSocket(wsUrl);
      } catch (err) {
        console.error('Failed to create WebSocket:', err);
        return;
      }

      websocket.onopen = () => {
        console.log('Plain display connected to WebSocket');
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'fullState':
              setSelectedLiveItem(data.data.selectedLiveItem || null);
              if (data.data.settings) {
                setFontFamily(data.data.settings.fontFamily || '');
                setFontStyle(data.data.settings.fontStyle || 'normal');
              }
              break;
            case 'selectedLiveItem':
              setSelectedLiveItem(data.data);
              break;
            case 'settings':
              if (data.data) {
                setFontFamily(data.data.fontFamily || '');
                setFontStyle(data.data.fontStyle || 'normal');
              }
              break;
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      websocket.onclose = (event) => {
        // Only reconnect on abnormal closure
        if (mounted && event.code !== 1000 && event.code !== 1001) {
          reconnectTimeout = setTimeout(() => {
            connect();
          }, 2000);
        }
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (websocket) {
        websocket.close();
      }
    };
  }, []);

  // Get container size
  const [containerSize, setContainerSize] = useState({ width: '100vw', height: '100vh' });

  useEffect(() => {
    const updateSize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      // Calculate 16:9 aspect ratio
      const aspectRatio = 16 / 9;
      let displayWidth, displayHeight;

      if (width / height > aspectRatio) {
        // Window is wider than 16:9, fit to height
        displayHeight = height;
        displayWidth = height * aspectRatio;
      } else {
        // Window is taller than 16:9, fit to width
        displayWidth = width;
        displayHeight = width / aspectRatio;
      }

      setContainerSize({ width: `${displayWidth}px`, height: `${displayHeight}px` });
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const displayItem = selectedLiveItem;
  const isSlide = !!displayItem?.slideData;
  const content = displayItem?.songData?.lyrics || displayItem?.slideData?.content || '';
  const slideTitle = displayItem?.slideData?.title || '';
  const lines = content.split('\n');
  const titleLines = slideTitle.split('\n').filter(line => line.trim());

  // Transparent background - no color or image
  const backgroundStyle = {
    backgroundColor: 'transparent'
  };

  // Font calculation for songs (centered, original logic)
  useEffect(() => {
    if (isSlide) return;
    if (!textRef.current || !lines.length) return;

    const containerWidth = parseFloat(containerSize.width);
    const containerHeight = parseFloat(containerSize.height);

    if (!containerWidth || !containerHeight) return;

    let size = 100;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    while (size > 10) {
      ctx.font = `${size}px ${fontFamily}`;

      const lineWidths = lines.map(line => line.trim() ? ctx.measureText(line).width : 0);
      const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
      const totalHeight = lines.length * size * 1.2;

      if (maxLineWidth <= containerWidth * 0.85 && totalHeight <= containerHeight * 0.85) {
        setFontSize(size);
        return;
      }
      size -= 2;
    }
    setFontSize(10);
  }, [containerSize, lines, fontFamily, content, selectedLiveItem, isSlide]);

  // Font calculation for slides (title + content layout)
  useEffect(() => {
    if (!isSlide) return;

    const containerWidth = parseFloat(containerSize.width);
    const containerHeight = parseFloat(containerSize.height);

    if (!containerWidth || !containerHeight) return;

    const totalPadding = 40;
    const availableHeight = containerHeight - totalPadding;

    const titleLineHeight = availableHeight * 0.15;
    const rectangleMaxWidth = containerWidth * 0.5;
    const rectanglePadding = 24;
    const rectangleVertPadding = 12;
    const maxTitleWidth = rectangleMaxWidth - rectanglePadding;
    const maxTitleHeight = titleLineHeight - rectangleVertPadding;

    let titleSize = 100;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    while (titleSize > 10) {
      ctx.font = `${titleSize}px ${fontFamily}`;
      const textWidth = titleLines.length > 0 ? Math.max(...titleLines.map(line => ctx.measureText(line).width)) : 0;
      const textHeight = titleSize * 1.3;

      if (textWidth <= maxTitleWidth * 0.95 && textHeight <= maxTitleHeight * 0.95) {
        setTitleFontSize(titleSize);
        break;
      }
      titleSize -= 2;
    }

    const contentHeight = availableHeight - titleLineHeight;
    const contentPadding = 24;
    const contentVertPadding = 12;
    const maxContentWidth = containerWidth * 0.95 - contentPadding;
    const maxContentHeight = contentHeight - contentVertPadding;

    if (lines.length === 0) {
      setContentFontSize(10);
      return;
    }

    let contentSize = 100;
    while (contentSize > 10) {
      ctx.font = `${contentSize}px ${fontFamily}`;

      const lineWidths = lines.map(line => line.trim() ? ctx.measureText(line).width : 0);
      const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
      const totalHeight = lines.length * contentSize * 1.2;

      if (maxLineWidth <= maxContentWidth * 0.95 && totalHeight <= maxContentHeight * 0.95) {
        setContentFontSize(contentSize);
        return;
      }
      contentSize -= 2;
    }
    setContentFontSize(10);
  }, [containerSize, titleLines, lines, fontFamily, isSlide, selectedLiveItem]);

  if (isSlide && slideTitle) {
    const totalPadding = 40;
    const availableHeight = parseFloat(containerSize.height) - totalPadding;
    const titleLineHeight = availableHeight * 0.15;

    return (
      <div
        ref={containerRef}
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          overflow: 'hidden'
        }}
      >
        <div
          className="flex-shrink-0 relative overflow-hidden flex flex-col"
          style={{
            width: containerSize.width,
            height: containerSize.height,
            padding: '20px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '15px',
            ...backgroundStyle
          }}
        >
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
                  textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black',
                  overflow: 'visible'
                }}
              >
                {slideTitle}
              </pre>
            </div>
          </div>

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
                  textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black'
                }}
              >
                {content}
              </pre>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Song layout: centered content
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        overflow: 'hidden'
      }}
    >
      <div
        ref={textRef}
        className="flex-shrink-0 relative overflow-hidden flex items-center justify-center"
        style={{
          width: containerSize.width,
          height: containerSize.height,
          ...backgroundStyle
        }}
      >
        {content && (
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
            textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black'
          }}>
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

export default PlainDisplay;
