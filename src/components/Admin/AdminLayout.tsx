import React, { useState } from 'react';
import OverviewDashboard from './OverviewDashboard';
import UserManagement from './UserManagement';
import SystemSettings from './SystemSettings';
import './AdminLayout.css';

export default function AdminLayout() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="admin-layout-container">
      <aside className="admin-sidebar glass-panel">
        <h2>Cloud9 Admin</h2>
        <nav>
          <button 
            className={activeTab === 'overview' ? 'active' : ''} 
            onClick={() => setActiveTab('overview')}
          >
            Dashboard
          </button>
          <button 
            className={activeTab === 'users' ? 'active' : ''} 
            onClick={() => setActiveTab('users')}
          >
            Users & Plans
          </button>
          <button 
            className={activeTab === 'settings' ? 'active' : ''} 
            onClick={() => setActiveTab('settings')}
          >
            System Config
          </button>
        </nav>
      </aside>

      <main className="admin-main-content">
        {activeTab === 'overview' && <OverviewDashboard />}
        {activeTab === 'users' && <UserManagement />}
        {activeTab === 'settings' && <SystemSettings />}
      </main>
    </div>
  );
}
