import { useState, useEffect } from 'react'
import './EpisodeSearchModal.css'

function formatSize(bytes) {
  if (!bytes) return '—'
  const b = parseInt(bytes)
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`
  if (b >= 1048576)    return `${(b / 1048576).toFixed(0)} MB`
  return `${(b / 1024).toFixed(0)} KB`
}

function formatAge(hours) {
  if (hours == null) return '—'
  const h = parseFloat(hours)
  if (h < 24)   return `${Math.round(h)}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)   return `${d}d ago`
  if (d < 365)  return `${Math.floor(d / 30)}mo ago`
  return `${(d / 365).toFixed(1)}y ago`
}

export default function EpisodeSearchModal({ episode, seriesTitle, nzbhydraUrl, onClose, onToast }) {
  const [results, setResults]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [grabbing, setGrabbing] = useState({})
  const [grabbed, setGrabbed]   = useState({})
  const [sortBy, setSortBy]     = useState('age')
  const [showRejected, setShowRejected] = useState(true)

  const epLabel = `S${String(episode.seasonNumber).padStart(2,'0')}E${String(episode.episodeNumber).padStart(2,'0')}`

  useEffect(() => {
    async function search() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          episodeId:   episode.id,
          seriesTitle: seriesTitle,
          season:      episode.seasonNumber,
          episode:     episode.episodeNumber,
        })
        const r = await fetch(`/api/sonarr/release?${params}`)
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Search failed')
        setResults(Array.isArray(data) ? data : [])
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    search()
  }, [episode.id])

  async function handleGrab(release) {
    const key = release.guid
    setGrabbing(g => ({ ...g, [key]: true }))
    try {
      let r, data
      if (release._source === 'nzbhydra') {
        // NZBHydra-direct result: send NZB URL straight to SABnzbd
        r = await fetch('/api/sabnzbd/addurl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: release._nzbUrl, name: release.title }),
        })
      } else {
        // Sonarr-managed release: let Sonarr grab it
        r = await fetch('/api/sonarr/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(release),
        })
      }
      data = await r.json()
      if (data.error) throw new Error(data.error)
      setGrabbed(g => ({ ...g, [key]: true }))
      onToast(`Grabbed: ${release.title}`, 'success')
    } catch (e) {
      onToast(`Grab failed: ${e.message}`, 'error')
    } finally {
      setGrabbing(g => ({ ...g, [key]: false }))
    }
  }

  const approved   = results?.filter(r => r.approved || (!r.rejections?.length)) ?? []
  const rejected   = results?.filter(r => !r.approved && r.rejections?.length)   ?? []
  const allResults = [...(results ?? [])].sort((a, b) => {
    // approved first, then sort by chosen field
    if (a.approved !== b.approved) return a.approved ? -1 : 1
    if (sortBy === 'age')     return (a.ageHours ?? 0) - (b.ageHours ?? 0)
    if (sortBy === 'size')    return (b.size ?? 0) - (a.size ?? 0)
    if (sortBy === 'indexer') return (a.indexer ?? '').localeCompare(b.indexer ?? '')
    return 0
  })

  function sorted(list) {
    return [...list].sort((a, b) => {
      if (sortBy === 'age')     return (a.ageHours ?? 0) - (b.ageHours ?? 0)
      if (sortBy === 'size')    return (b.size ?? 0) - (a.size ?? 0)
      if (sortBy === 'indexer') return (a.indexer ?? '').localeCompare(b.indexer ?? '')
      return 0
    })
  }

  const displayList = showRejected ? allResults : sorted(approved)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ep-search-panel">
        <div className="ep-search-header">
          <div>
            <h2 className="ep-search-title">Interactive Search</h2>
            <div className="ep-search-subtitle">
              {seriesTitle} &mdash; {epLabel}{episode.title ? ` · ${episode.title}` : ''}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {loading && (
          <div className="ep-search-empty">
            <span className="spinner" />
            <span>Searching Sonarr indexers… this may take a moment</span>
          </div>
        )}

        {error && (
          <div className="ep-search-empty">
            <div style={{fontSize:32}}>⚠️</div>
            <span>{error}</span>
          </div>
        )}

        {results && !loading && (
          <>
            <div className="ep-search-toolbar">
              <span className="text-sm text-muted">
                {allResults.length} result{allResults.length !== 1 ? 's' : ''}
                {rejected.length > 0 && ` · ${rejected.length} rejected`}
              </span>
              <div className="ep-search-toolbar-right">
                <label className="text-xs text-muted" style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                  <input type="checkbox" checked={showRejected} onChange={e => setShowRejected(e.target.checked)} />
                  Show rejected
                </label>
                <select
                  className="sort-select"
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                >
                  <option value="age">Sort: Newest</option>
                  <option value="size">Sort: Largest</option>
                  <option value="indexer">Sort: Indexer</option>
                </select>
              </div>
            </div>

            <div className="ep-search-body">
              {displayList.length === 0 && (
                <div className="ep-search-empty" style={{padding:'40px 0'}}>
                  <div style={{fontSize:32}}>🤷</div>
                  <span>No results found from any indexer</span>
                  <span className="text-xs text-muted" style={{textAlign:'center',maxWidth:400}}>
                    Sonarr searched all configured indexers and found nothing.
                    Check that your indexers in NZBHydra have valid API keys and are reachable.
                  </span>
                  {nzbhydraUrl && (
                    <a
                      className="btn btn-secondary btn-sm"
                      href={`${nzbhydraUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open NZBHydra ↗
                    </a>
                  )}
                </div>
              )}

              {displayList.map(release => (
                <ReleaseRow
                  key={release.guid}
                  release={release}
                  grabbing={grabbing[release.guid]}
                  grabbed={grabbed[release.guid]}
                  onGrab={handleGrab}
                  rejected={!release.approved && !!release.rejections?.length}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ReleaseRow({ release, grabbing, grabbed, onGrab, rejected }) {
  const qualityName = release.quality?.quality?.name || release.qualityVersion || '—'
  const protocol = release.protocol === 'usenet' ? '📰' : '🌱'
  const rejections = release.rejections || []
  const isHydraDirect = release._source === 'nzbhydra'

  return (
    <div className={`release-row ${rejected ? 'release-rejected' : ''} ${grabbed ? 'release-grabbed' : ''}`}>
      <div className="release-main">
        <div className="release-title" title={release.title}>{release.title}</div>
        <div className="release-meta">
          <span className="badge badge-muted">{protocol} {release.indexer || '—'}</span>
          {!isHydraDirect && <span className="badge badge-muted">{qualityName}</span>}
          <span className="text-xs text-muted">{formatSize(release.size)}</span>
          <span className="text-xs text-muted">{formatAge(release.ageHours)}</span>
          {release.seeders != null && (
            <span className="text-xs text-muted">↑{release.seeders}</span>
          )}
          {isHydraDirect && (
            <span className="badge badge-muted" title="Result from NZBHydra direct search — will be sent to SABnzbd">NZBHydra</span>
          )}
          {rejections.length > 0 && (
            <span className="release-rejection" title={rejections.join(' · ')}>
              ⚠ {rejections[0]}{rejections.length > 1 ? ` +${rejections.length - 1}` : ''}
            </span>
          )}
        </div>
      </div>
      <button
        className={`btn btn-sm ${grabbed ? 'btn-success' : 'btn-primary'}`}
        onClick={() => !grabbed && onGrab(release)}
        disabled={grabbing || grabbed}
      >
        {grabbing ? <span className="spinner" /> : grabbed ? '✓ Grabbed' : '⬇ Grab'}
      </button>
    </div>
  )
}
