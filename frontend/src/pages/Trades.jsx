import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import SearchableSelect from '../components/SearchableSelect';
import { GAME_CATEGORIES, getItemsForCategory } from '../utils/tradeConstants';
import './Trades.css';

const Trades = () => {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { user, showToast } = useAuth();

  const emptyItem = () => ({
    name: '',
    gameCategory: '',
    value: '',
    valueUnit: '',
    mutation: '',
    traitsInput: '',
    weight: ''
  });

  const [tradeForm, setTradeForm] = useState({
    offeredItems: [emptyItem()],
    wantedItems: [emptyItem()],
    value: '',
    notes: '',
    robloxUsername: ''
  });

  useEffect(() => {
    fetchTrades();
  }, [page, search]);

  const fetchTrades = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/trades', {
        params: { page, limit: 20, search }
      });
      let trades = response.data.trades || response.data || [];
      // Ensure it's an array
      if (!Array.isArray(trades)) {
        trades = [];
      }
      // Parse JSON strings for offered/wanted if needed
      trades = trades.map(trade => ({
        ...trade,
        offered: typeof trade.offered === 'string' ? (() => {
          try { return JSON.parse(trade.offered); } catch { return []; }
        })() : (Array.isArray(trade.offered) ? trade.offered : []),
        wanted: typeof trade.wanted === 'string' ? (() => {
          try { return JSON.parse(trade.wanted); } catch { return []; }
        })() : (Array.isArray(trade.wanted) ? trade.wanted : [])
      }));
      setTrades(trades);
      setTotalPages(response.data.pagination?.totalPages || 1);
    } catch (error) {
      console.error('Error fetching trades:', error);
      // Set empty state on error to prevent crashes
      setTrades([]);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  };

  const copyLink = (tradeId) => {
    const link = `${window.location.origin}/trades/${tradeId}`;
    navigator.clipboard.writeText(link);
    alert('Link copied to clipboard!');
  };

  const addItemRow = (listKey) => {
    setTradeForm(prev => ({
      ...prev,
      [listKey]: [...prev[listKey], emptyItem()]
    }));
  };

  const removeItemRow = (listKey, index) => {
    setTradeForm(prev => {
      const updated = prev[listKey].filter((_, i) => i !== index);
      return {
        ...prev,
        [listKey]: updated.length > 0 ? updated : [emptyItem()]
      };
    });
  };

  const handleItemChange = (listKey, index, field, value) => {
    setTradeForm(prev => {
      const updated = [...prev[listKey]];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, [listKey]: updated };
    });
  };

  const resetTradeForm = () => {
    setTradeForm({
      offeredItems: [emptyItem()],
      wantedItems: [emptyItem()],
      value: '',
      notes: '',
      robloxUsername: ''
    });
  };

  const formatItemsForPayload = (items) => (
    items
      .filter(item => item.name && item.gameCategory)
      .map(item => {
        const payload = {
          name: item.name.trim(),
          gameCategory: item.gameCategory
        };
        if (item.value) payload.value = item.value;
        if (item.valueUnit) payload.valueUnit = item.valueUnit;
        if (item.mutation) payload.mutation = item.mutation;
        if (item.traitsInput) {
          const traits = item.traitsInput.split(',').map(trait => trait.trim()).filter(Boolean);
          if (traits.length) {
            payload.traits = traits;
          }
        }
        if (item.weight) payload.weight = item.weight;
        return payload;
      })
  );

  const handleTradeSubmit = async (e) => {
    e.preventDefault();
    const safeShowToast = showToast || ((msg) => alert(msg));

    if (!user) {
      safeShowToast('Please log in to post a trade.', 'warning');
      return;
    }

    const offered = formatItemsForPayload(tradeForm.offeredItems);
    const wanted = formatItemsForPayload(tradeForm.wantedItems);

    if (offered.length === 0 || wanted.length === 0) {
      safeShowToast('Please add at least one offered and one wanted item.', 'warning');
      return;
    }

    try {
      await axios.post('/api/trades', {
        offered,
        wanted,
        value: tradeForm.value || null,
        notes: tradeForm.notes || null,
        robloxUsername: tradeForm.robloxUsername || null
      });
      safeShowToast('Trade posted successfully!', 'success');
      setShowCreateModal(false);
      resetTradeForm();
      setPage(1);
      fetchTrades();
    } catch (error) {
      console.error('Error posting trade:', error);
      safeShowToast(error.response?.data?.error || 'Failed to post trade', 'error');
    }
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    resetTradeForm();
  };

  return (
    <div className="trades">
      <div className="trades-header">
        <h1>Trading Hub</h1>
        {user && (
          <button className="post-trade-btn" onClick={() => setShowCreateModal(true)}>
            + Post Trade
          </button>
        )}
      </div>
      <div className="search-bar">
        <input
          type="text"
          placeholder="Search trades..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {loading ? (
        <div className="loading">Loading trades...</div>
      ) : trades.length === 0 ? (
        <div className="no-trades">No trades found.</div>
      ) : (
        <>
          <div className="trades-grid">
            {trades.map((trade) => (
              <div key={trade.id} className="trade-card">
                <div className="trade-header">
                  <div className="trade-user">
                    <img
                      src={trade.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                      alt={trade.username}
                      className="trade-avatar"
                    />
                    <span>{trade.username}</span>
                  </div>
                  <button
                    onClick={() => copyLink(trade.id)}
                    className="copy-link-btn"
                    title="Copy link"
                  >
                    🔗
                  </button>
                </div>
                <div className="trade-content">
                  <div className="trade-section">
                    <strong>Offered:</strong> {Array.isArray(trade.offered) ? trade.offered.map(i => i?.name || i).join(', ') : (trade.offered || 'N/A')}
                  </div>

                  <div className="trade-section">
                    <strong>Wanted:</strong> {Array.isArray(trade.wanted) ? trade.wanted.map(i => i?.name || i).join(', ') : (trade.wanted || 'N/A')}
                  </div>
                  {trade.value && (
                    <div className="trade-section">
                      <strong>Value:</strong> {trade.value}
                    </div>
                  )}
                  {trade.notes && (
                    <div className="trade-section">
                      <strong>Notes:</strong> {trade.notes}
                    </div>
                  )}
                  {trade.robloxUsername && (
                    <div className="trade-section">
                      <strong>Roblox:</strong> {trade.robloxUsername}
                    </div>
                  )}
                </div>
                <div className="trade-footer">
                  <small>{new Date(trade.createdAt).toLocaleDateString()}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="pagination">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </button>
          </div>
        </>
      )}

      {showCreateModal && (
        <div className="post-trade-modal-overlay" onClick={closeCreateModal}>
          <div className="post-trade-modal" onClick={(e) => e.stopPropagation()}>
            <div className="post-trade-modal-header">
              <h2>Post a Trade</h2>
              <button className="close-modal-btn" onClick={closeCreateModal}>×</button>
            </div>
            <form className="post-trade-form" onSubmit={handleTradeSubmit}>
              <div className="form-section">
                <h3>Your Offer</h3>
                {tradeForm.offeredItems.map((item, index) => (
                  <div key={`offered-${index}`} className="trade-form-item-row">
                    <SearchableSelect
                      value={item.gameCategory}
                      onChange={(value) => handleItemChange('offeredItems', index, 'gameCategory', value)}
                      options={GAME_CATEGORIES.map(cat => ({ value: cat, label: cat }))}
                      placeholder="Category"
                      required
                    />
                    <SearchableSelect
                      value={item.name}
                      onChange={(value) => handleItemChange('offeredItems', index, 'name', value)}
                      options={getItemsForCategory(item.gameCategory).map(name => ({ value: name, label: name }))}
                      placeholder="Item"
                      required
                      disabled={!item.gameCategory}
                    />
                    <input
                      type="text"
                      placeholder="Value"
                      value={item.value}
                      onChange={(e) => handleItemChange('offeredItems', index, 'value', e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Traits (comma separated)"
                      value={item.traitsInput}
                      onChange={(e) => handleItemChange('offeredItems', index, 'traitsInput', e.target.value)}
                    />
                    <button type="button" onClick={() => removeItemRow('offeredItems', index)}>×</button>
                  </div>
                ))}
                <button type="button" className="add-item-btn" onClick={() => addItemRow('offeredItems')}>
                  + Add Item
                </button>
              </div>

              <div className="form-section">
                <h3>What You Want</h3>
                {tradeForm.wantedItems.map((item, index) => (
                  <div key={`wanted-${index}`} className="trade-form-item-row">
                    <SearchableSelect
                      value={item.gameCategory}
                      onChange={(value) => handleItemChange('wantedItems', index, 'gameCategory', value)}
                      options={GAME_CATEGORIES.map(cat => ({ value: cat, label: cat }))}
                      placeholder="Category"
                      required
                    />
                    <SearchableSelect
                      value={item.name}
                      onChange={(value) => handleItemChange('wantedItems', index, 'name', value)}
                      options={getItemsForCategory(item.gameCategory).map(name => ({ value: name, label: name }))}
                      placeholder="Item"
                      required
                      disabled={!item.gameCategory}
                    />
                    <input
                      type="text"
                      placeholder="Value"
                      value={item.value}
                      onChange={(e) => handleItemChange('wantedItems', index, 'value', e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Traits (comma separated)"
                      value={item.traitsInput}
                      onChange={(e) => handleItemChange('wantedItems', index, 'traitsInput', e.target.value)}
                    />
                    <button type="button" onClick={() => removeItemRow('wantedItems', index)}>×</button>
                  </div>
                ))}
                <button type="button" className="add-item-btn" onClick={() => addItemRow('wantedItems')}>
                  + Add Item
                </button>
              </div>

              <div className="form-grid">
                <div>
                  <label>Trade Value (optional)</label>
                  <input
                    type="text"
                    value={tradeForm.value}
                    onChange={(e) => setTradeForm(prev => ({ ...prev, value: e.target.value }))}
                    placeholder="e.g., 150M/s"
                  />
                </div>
                <div>
                  <label>Roblox Username (optional)</label>
                  <input
                    type="text"
                    value={tradeForm.robloxUsername}
                    onChange={(e) => setTradeForm(prev => ({ ...prev, robloxUsername: e.target.value }))}
                    placeholder="Your Roblox username"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={tradeForm.notes}
                  onChange={(e) => setTradeForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Any extra details about your trade..."
                  rows={3}
                />
              </div>

              <div className="post-trade-form-actions">
                <button type="button" className="secondary-btn" onClick={closeCreateModal}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Post Trade
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Trades;


