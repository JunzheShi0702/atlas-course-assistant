import React from 'react';

const Sidebar: React.FC = () => {
  return (
    <aside className="sidebar-root">
      {/* Shortlisted Courses Section - Top 2/3 */}
      <div className="sidebar-section-top">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Shortlisted Courses:</h2>
        
        {/* Shortlisted courses content area */}
        <div className="flex-1">
          {/* Courses will be added here dynamically */}
          <p className="text-gray-600 text-sm italic">No courses shortlisted yet</p>
        </div>
      </div>

      {/* Division Line */}
      <div className="sidebar-divider"></div>

      {/* Current Statistics Section - Bottom 1/3 */}
      <div className="sidebar-section-bottom">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Current Statistics</h2>
        
        {/* Statistics content */}
        <div className="space-y-3">
          {/* Credit */}
          <div className="flex justify-between items-center">
            <span className="text-gray-800 font-medium">Credit:</span>
            <span className="text-gray-600">-</span>
          </div>

          {/* Workload */}
          <div className="flex justify-between items-center">
            <span className="text-gray-800 font-medium">Workload:</span>
            <span className="text-gray-600">-</span>
          </div>

          {/* Difficulty */}
          <div className="flex justify-between items-center">
            <span className="text-gray-800 font-medium">Difficulty:</span>
            <span className="text-gray-600">-</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;