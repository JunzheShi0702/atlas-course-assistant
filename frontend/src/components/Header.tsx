import React from 'react';
import { Settings, User } from 'lucide-react';

interface HeaderProps {
  title?: string;
}

const Header: React.FC<HeaderProps> = ({ 
  title = 'Atlas: Your 24/7 Course Advisor'
}) => {
  return (
    <header className="header-root">
      <div className="header-inner">
        <div className="header-row">
          {/* Left side - Title */}
          <div className="flex items-center">
            <h1 className="header-title">
              {title}
            </h1>
          </div>

          {/* Right side - User actions */}
          <div className="header-actions">
            <button
              className="header-icon-button"
              aria-label="Settings"
            >
              <Settings className="w-6 h-6 text-white" />
            </button>
            <button
              className="header-icon-button"
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