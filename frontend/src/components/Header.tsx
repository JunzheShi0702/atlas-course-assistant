import React from 'react';
import { Settings, User } from 'lucide-react';

interface HeaderProps {
  title?: string;
}

const Header: React.FC<HeaderProps> = ({ 
  title = 'Atlas: Your 24/7 Course Advisor'
}) => {
  return (
    <header className="bg-gradient-to-b from-[#0076BA] to-[#004D80] shadow-lg w-full">
      <div className="w-full" style={{ paddingLeft: '10px', paddingRight: '10px', paddingTop: '8px', paddingBottom: '8px' }}>
        <div className="flex items-center justify-between" style={{ gap: '8px' }}>
          {/* Left side - Title */}
          <div className="flex items-center">
            <h1 className="text-3xl font-bold text-white" style={{ paddingTop: '3px', paddingBottom: '3px' }}>
              {title}
            </h1>
          </div>

          {/* Right side - User actions */}
          <div className="flex items-center" style={{ gap: '5px' }}>
            <button
              className="hover:bg-white/10 rounded-lg transition-colors"
              style={{ padding: '4px' }}
              aria-label="Settings"
            >
              <Settings className="w-6 h-6 text-white" />
            </button>
            <button
              className="hover:bg-white/10 rounded-lg transition-colors"
              style={{ padding: '4px' }}
              aria-label="User profile"
            >
              <User className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;