import React, { useState, ChangeEvent, useEffect, useRef } from 'react';
import { Search, MessageSquare, ArrowRight } from 'lucide-react';

type Mode = 'search' | 'chat';

interface DualTextAreaProps {
  onSearch?: (query: string) => void;
  onSendMessage?: (message: string) => void;
}

const DualTextArea: React.FC<DualTextAreaProps> = ({ onSearch, onSendMessage }) => {
  const [activeMode, setActiveMode] = useState<Mode>('search');
  const [searchText, setSearchText] = useState<string>('');
  const [chatText, setChatText] = useState<string>('');
  const [isNarrow, setIsNarrow] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTextareaRef = useRef<HTMLTextAreaElement>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);

  const BUTTON_WIDTH = 200; // Fixed width for minimized buttons
  const GAP = 16; // gap-4 = 16px
  const ROW_HEIGHT = 60; // Base height (px) for both rows/buttons

  const handleModeSwitch = (mode: Mode): void => {
    setActiveMode(mode);
  };

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>): void => {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = `${target.scrollHeight}px`;
  };

  const adjustTextareaHeight = (textarea: HTMLTextAreaElement | null): void => {
    if (textarea) {
      // Force reflow
      textarea.style.height = '32px';
      requestAnimationFrame(() => {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
      });
    }
  };

  const handleSearchClick = (): void => {
    if (onSearch) {
      onSearch(searchText);
    }
    console.log('Search:', searchText);
  };

  const handleSendClick = (): void => {
    if (onSendMessage) {
      onSendMessage(chatText);
    }
    console.log('Chat:', chatText);
  };

  // Check if remaining space for textarea is less than 3/4 of total width
  useEffect(() => {
    const checkWidth = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const remainingSpace = containerWidth - BUTTON_WIDTH - GAP;
        const threeFourths = containerWidth * 0.75;
        
        // If remaining space is less than 3/4 of container width, split into two lines
        setIsNarrow(remainingSpace < threeFourths);
      }
    };

    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  // Adjust textarea height when toggling modes or text changes
  useEffect(() => {
    if (activeMode === 'search') {
      // Multiple adjustments to ensure correct height
      const timer1 = setTimeout(() => adjustTextareaHeight(searchTextareaRef.current), 0);
      const timer2 = setTimeout(() => adjustTextareaHeight(searchTextareaRef.current), 100);
      const timer3 = setTimeout(() => adjustTextareaHeight(searchTextareaRef.current), 300);
      
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    } else if (activeMode === 'chat') {
      const timer1 = setTimeout(() => adjustTextareaHeight(chatTextareaRef.current), 0);
      const timer2 = setTimeout(() => adjustTextareaHeight(chatTextareaRef.current), 100);
      const timer3 = setTimeout(() => adjustTextareaHeight(chatTextareaRef.current), 300);
      
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    }
  }, [activeMode]);

  // Also adjust on text change
  useEffect(() => {
    if (activeMode === 'search') {
      adjustTextareaHeight(searchTextareaRef.current);
    }
  }, [searchText, activeMode]);

  useEffect(() => {
    if (activeMode === 'chat') {
      adjustTextareaHeight(chatTextareaRef.current);
    }
  }, [chatText, activeMode]);

  return (
    <div 
      ref={containerRef}
      style={{ 
        width: '100%', 
        paddingLeft: '24px', 
        paddingRight: '24px', 
        paddingBottom: '24px',
        boxSizing: 'border-box'
      }}
    >
      <div className={`flex gap-4 ${isNarrow ? 'flex-col' : 'flex-row items-end'}`}>
        {/* Basic Search Text Area - Always on the left (or top if narrow) */}
        {activeMode === 'search' ? (
          <div 
            className="flex items-stretch border-2 border-[#0076BA] rounded-2xl bg-white overflow-hidden transition-all duration-500 ease-in-out animate-in fade-in slide-in-from-left-4" 
            style={{ 
              width: isNarrow ? '100%' : `calc(100% - ${BUTTON_WIDTH}px - ${GAP}px)`,
              gap: '16px',
              minHeight: `${ROW_HEIGHT}px`,
            }}
          >
            {/* Icon badge on the left - narrower */}
            <div className="flex-shrink-0 bg-[#0076BA] flex items-center justify-center transition-all duration-500" style={{ width: '60px' }}>
              <Search className="w-8 h-8 text-yellow-400 transition-all duration-500" />
            </div>
            
            {/* Main input area - white space created by gap */}
            <div className="flex-1 relative flex flex-col py-3 pr-6">
              {/* Label at top on its own line */}
              <div className="mb-2 animate-in fade-in duration-300 delay-100">
                <span className="text-base font-semibold text-[#0076BA]">Search</span>
              </div>

              {/* Text input on next line */}
              <div className="flex-1 flex items-start pr-12 animate-in fade-in duration-300 delay-150">
                <textarea
                  ref={searchTextareaRef}
                  value={searchText}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setSearchText(e.target.value)}
                  placeholder="Search for courses..."
                  className="w-full resize-none outline-none text-lg leading-relaxed transition-all duration-300"
                  style={{ minHeight: '32px', maxHeight: '200px', height: '32px' }}
                  rows={1}
                  onInput={handleTextareaInput}
                />
              </div>
              
              {/* Submit button on the right */}
              <button
                className="absolute top-1/2 right-4 -translate-y-1/2 bg-[#0076BA] hover:bg-[#004D80] text-white rounded-full p-3 transition-all duration-300 animate-in fade-in zoom-in delay-200"
                aria-label="Search"
                onClick={handleSearchClick}
              >
                <ArrowRight className="w-6 h-6" />
              </button>
            </div>
          </div>
        ) : (
          <div 
            style={{ 
              width: isNarrow ? `${BUTTON_WIDTH}px` : `${BUTTON_WIDTH}px`,
              height: `${ROW_HEIGHT}px`,
            }}
            className={`transition-all duration-500 ease-in-out ${isNarrow ? 'self-start' : ''}`}
          >
            <button
              onClick={() => handleModeSwitch('search')}
              className="w-full h-full border-2 border-[#0076BA] bg-white hover:bg-gray-50 rounded-2xl flex items-center justify-center gap-3 px-4 transition-all duration-500 ease-in-out hover:scale-105"
              aria-label="Switch to search mode"
            >
              <Search className="w-5 h-5 text-[#0076BA] transition-all duration-300" />
              <span className="text-base font-semibold text-[#0076BA] transition-all duration-300">Search</span>
            </button>
          </div>
        )}

        {/* AI-Enabled Chat Button/Text Area - Always on the right (or bottom if narrow) */}
        {activeMode === 'chat' ? (
          <div 
            className="flex items-stretch border-2 border-[#8B1A5C] rounded-2xl bg-white overflow-hidden transition-all duration-500 ease-in-out animate-in fade-in slide-in-from-right-4" 
            style={{ 
              width: isNarrow ? '100%' : `calc(100% - ${BUTTON_WIDTH}px - ${GAP}px)`,
              gap: '16px',
              minHeight: `${ROW_HEIGHT}px`,
            }}
          >
            {/* Icon badge on the left - narrower */}
            <div className="flex-shrink-0 bg-[#8B1A5C] flex items-center justify-center transition-all duration-500" style={{ width: '60px' }}>
              <MessageSquare className="w-8 h-8 text-white transition-all duration-500" />
            </div>
            
            {/* Main input area - white space created by gap */}
            <div className="flex-1 relative flex flex-col py-3 pr-6">
              {/* Label at top on its own line */}
              <div className="mb-2 animate-in fade-in duration-300 delay-100">
                <span className="text-base font-semibold text-[#8B1A5C]">AI-Enabled Chat</span>
              </div>

              {/* Text input on next line */}
              <div className="flex-1 flex items-start pr-12 animate-in fade-in duration-300 delay-150">
                <textarea
                  ref={chatTextareaRef}
                  value={chatText}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setChatText(e.target.value)}
                  placeholder="Ask me anything..."
                  className="w-full resize-none outline-none text-lg leading-relaxed transition-all duration-300"
                  style={{ minHeight: '32px', maxHeight: '200px', height: '32px' }}
                  rows={1}
                  onInput={handleTextareaInput}
                />
              </div>
              
              {/* Submit button on the right */}
              <button
                className="absolute top-1/2 right-4 -translate-y-1/2 bg-[#8B1A5C] hover:bg-[#6B1447] text-white rounded-full p-3 transition-all duration-300 animate-in fade-in zoom-in delay-200"
                aria-label="Send message"
                onClick={handleSendClick}
              >
                <ArrowRight className="w-6 h-6" />
              </button>
            </div>
          </div>
        ) : (
          <div 
            style={{ 
              width: isNarrow ? `${BUTTON_WIDTH}px` : `${BUTTON_WIDTH}px`,
              height: `${ROW_HEIGHT}px`,
            }}
            className={`transition-all duration-500 ease-in-out ${isNarrow ? 'self-end' : ''}`}
          >
            <button
              onClick={() => handleModeSwitch('chat')}
              className="w-full h-full bg-[#8B1A5C] hover:bg-[#6B1447] text-white rounded-2xl flex items-center justify-center gap-3 px-4 transition-all duration-500 ease-in-out whitespace-nowrap hover:scale-105"
              aria-label="Switch to chat mode"
            >
              <MessageSquare className="w-5 h-5 transition-all duration-300" />
              <span className="text-base font-semibold transition-all duration-300">AI-Enabled Chat</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DualTextArea;