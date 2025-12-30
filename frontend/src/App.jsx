import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import Layout from './components/Layout';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Trades from './pages/Trades';
import Middleman from './pages/Middleman';
import Reports from './pages/Reports';
import Admin from './pages/Admin';
import News from './pages/News';
import MarketTrends from './pages/MarketTrends';
import Wishlist from './pages/Wishlist';
import Templates from './pages/Templates';
import Disputes from './pages/Disputes';
import Profile from './pages/Profile';
import SmartAlerts from './pages/SmartAlerts';
import { AuthProvider } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';

// Configure axios defaults
// Configure axios for production
const API_URL = import.meta.env.VITE_API_URL || '';
if (API_URL) {
  axios.defaults.baseURL = API_URL;
}
axios.defaults.withCredentials = true;

// Add global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/trades" element={<Trades />} />
            <Route path="/middlemen" element={<Middleman />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/news" element={<News />} />
            <Route path="/market-trends" element={<MarketTrends />} />
            <Route path="/wishlist" element={<Wishlist />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/disputes" element={<Disputes />} />
            <Route path="/smart-alerts" element={<SmartAlerts />} />
            <Route path="/profile/:discordId" element={<Profile />} />
          </Routes>
        </Layout>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;

