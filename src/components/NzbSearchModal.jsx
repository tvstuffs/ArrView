import { useState, useRef, useCallback } from 'react'
import './NzbSearchModal.css'

function formatSize(bytes) {
  if (!bytes) return '—'
  const b = parseInt(bytes)
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`
  if (b >= 1048576)    return `${(b / 1048576).toFixed(0)} MB`
  return `${(b / 1024).toFixed(0)} KB`
}

function formatAge(pubDate) {
  if (!pubDate) return '—'
  const diff = Date.now() - new Date(pubDate).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1d ago'
  if (days < 30)  return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${(days / 365).toFixed(1)}y ago`
}

export default function NzbSearchModal({ onClose, onToast }) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [sending, setSending]   = useState({})
  const [sent, setSent]         = useState({})
  const inputRef = useRef(null)

  const search = useCallback(async (q) => {
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const r = await fetch(`/api/nzbhydra/search?q=${encodeURIComponent(q.trim())}`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Search failed')
      setResults(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  function handleKeyDown(e) {
    if (e.key === 'Enter') search(query)
    if (e.key === 'Escape') onClose()
  }

  async function handleDownload(result) {
    const key = result.guid
    setSending(s => ({ ...s, [key]: true }))
    try {
      const r = await fetch('/api/sabnzbd/addurl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: result.link, name: result.title }),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setSent(s => ({ ...s, [key]: true }))
      onToast(`Added: ${result.title}`, 'success')
    } catch (e) {
      onToast(`Error: ${e.message}`, 'error')
    } finally {
      setSending(s => ({ ...s, [key]: false }))
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="nzb-search-panel">
        <div className="nzb-search-header">
          <h2 className="nzb-search-title">🔎 Search NZBHydra</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="nzb-search-bar">
          <input
            ref={inputRef}
            className="nzb-search-input"
            type="text"
            placeholder="Search for something to download…"
            value={query}
            autoFocus
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="btn btn-primary"
            onClick={() => search(query)}
            disabled={loading || !query.trim()}
          >
            {loading ? <span className="spinner" /> : 'Search'}
          </button>
        </div>

        <div className="nzb-search-body">
          {!results && !loading && !error && (
            <div className="nzb-empty">
              <div className="nzb-empty-icon">🔍</div>
              <span>Enter a search term and press Search or Enter</span>
            </div>
          )}

          {loading && (
            <div className="nzb-empty">
              <span className="spinner" />
              <span>Searching NZBHydra…</span>
            </div>
          )}

          {error && (
            <div className="nzb-empty">
              <div className="nzb-empty-icon">⚠️</div>
              <span>{error}</span>
            </div>
          )}

          {results && results.length === 0 && (
            <div className="nzb-empty">
              <div className="nzb-empty-icon">🤷</div>
              <span>No results found</span>
            </div>
          )}

          {results && results.length > 0 && (
            <div className="nzb-results">
              <div className="nzb-results-count text-xs text-muted">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </div>
              {results.map((r, i) => {
                const key = r.guid || i
                const isSending = sending[key]
                const isSent    = sent[key]
                return (
                  <div key={key} className={`nzb-result-row ${isSent ? 'sent' : ''}`}>
                    <div className="nzb-result-main">
                      <div className="nzb-result-title" title={r.title}>{r.title}</div>
                      <div className="nzb-result-meta">
                        {r.indexer && <span className="badge badge-muted">{r.indexer}</span>}
                        {r.category && <span className="badge badge-muted">{r.category}</span>}
                        <span className="text-xs text-muted">{formatSize(r.size)}</span>
                        <span className="text-xs text-muted">{formatAge(r.pubDate)}</span>
                      </div>
                    </div>
                    <button
                      className={`btn btn-sm ${isSent ? 'btn-success' : 'btn-primary'}`}
                      onClick={() => !isSent && handleDownload(r)}
                      disabled={isSending || isSent}
                      title={isSent ? 'Added to SABnzbd' : 'Send to SABnzbd'}
                    >
                      {isSending ? <span className="spinner" /> : isSent ? '✓ Added' : '⬇ Download'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
