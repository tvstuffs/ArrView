import { useState, useEffect, useCallback } from 'react'
import './ShowsTab.css'
import AddMediaModal from './AddMediaModal.jsx'
import EpisodeSearchModal from './EpisodeSearchModal.jsx'

const STATUS_BADGE = {
  continuing: 'badge-success',
  ended:      'badge-muted',
  upcoming:   'badge-accent',
}

// Poll a Sonarr command until it completes, then call onDone(status, result)
async function pollCommand(commandId, onDone, intervalMs = 3000, maxMs = 90000) {
  const deadline = Date.now() + maxMs
  async function check() {
    if (Date.now() > deadline) { onDone('timeout', null); return }
    try {
      const r = await fetch(`/api/sonarr/command/${commandId}`)
      const data = await r.json()
      if (data.status === 'completed' || data.status === 'failed') {
        onDone(data.status, data.result)
      } else {
        setTimeout(check, intervalMs)
      }
    } catch {
      setTimeout(check, intervalMs)
    }
  }
  setTimeout(check, intervalMs)
}

// Sum episode counts from main seasons only (exclude season 0 / specials)
function mainSeasonCounts(show) {
  const seasons = (show.seasons || []).filter(s => s.seasonNumber > 0)
  if (seasons.length > 0) {
    const total  = seasons.reduce((n, s) => n + (s.statistics?.totalEpisodeCount || 0), 0)
    const onDisk = seasons.reduce((n, s) => n + (s.statistics?.episodeFileCount  || 0), 0)
    return { total, onDisk }
  }
  // Fallback: use show-level stats (no season breakdown available)
  const stats = show.statistics || {}
  return { total: stats.totalEpisodeCount || 0, onDisk: stats.episodeFileCount || 0 }
}



function EpisodeRow({ ep, onSearch, onInteractiveSearch, onDeleted }) {
  const [showInfo, setShowInfo]         = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]         = useState(false)
  const downloaded = ep.hasFile
  const airDate = ep.airDateUtc ? new Date(ep.airDateUtc) : null
  const hasAired = airDate && airDate < new Date()
  const isMissing = !downloaded && hasAired

  async function handleDelete() {
    setDeleting(true)
    try {
      // 1. Delete the file from disk
      const delRes = await fetch(`/api/sonarr/episodefile/${ep.episodeFileId}`, { method: 'DELETE' })
      if (!delRes.ok) {
        const d = await delRes.json()
        throw new Error(d.error || 'Delete failed')
      }
      // 2. Unmonitor the episode so it won't be re-downloaded automatically
      await fetch('/api/sonarr/episode/monitor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [ep.id], monitored: false }),
      })
      onDeleted()
    } catch (e) {
      onDeleted(e.message)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className={`episode-row-wrap ${isMissing ? 'episode-missing' : downloaded ? 'episode-downloaded' : ''}`}>
      <div className="episode-row">
        <span className="ep-num text-xs text-muted">
          S{String(ep.seasonNumber).padStart(2,'0')}E{String(ep.episodeNumber).padStart(2,'0')}
        </span>
        <span className="ep-title truncate" title={ep.title}>{ep.title}</span>
        {ep.overview && (
          <button
            className={`btn-ep-info ${showInfo ? 'active' : ''}`}
            onClick={e => { e.stopPropagation(); setShowInfo(v => !v) }}
            title="Show episode description"
          >ℹ</button>
        )}
        <div className="ep-right">
          {airDate && (
            <span className="text-xs text-muted">
              {airDate.toLocaleDateString()}
            </span>
          )}
          {downloaded ? (
            <>
              <span className="badge badge-success text-xs">✓</span>
              {confirmDelete ? (
                <>
                  <button
                    className="btn btn-danger btn-xs"
                    onClick={handleDelete}
                    disabled={deleting}
                    title="Confirm delete from disk and unmonitor"
                  >
                    {deleting ? <span className="spinner" style={{width:10,height:10}} /> : '✓ Confirm'}
                  </button>
                  <button
                    className="btn btn-secondary btn-xs"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >Cancel</button>
                </>
              ) : (
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setConfirmDelete(true)}
                  title="Delete from disk and unmonitor"
                >🗑</button>
              )}
            </>
          ) : !hasAired ? (
            <span className="badge badge-muted text-xs">Upcoming</span>
          ) : (
            <>
              <button className="btn btn-accent btn-xs" onClick={() => onSearch(ep.id)}>
                ⬇ Download
              </button>
              <button className="btn btn-secondary btn-xs" onClick={() => onInteractiveSearch(ep)} title="Interactive search — pick a release manually">
                🔍
              </button>
            </>
          )}
        </div>
      </div>
      {showInfo && ep.overview && (
        <div className="ep-overview">{ep.overview}</div>
      )}
    </div>
  )
}

function ShowCard({ show, onToast, sonarrEvent, sonarrUrl, nzbhydraUrl, onRemoved }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedSeasons, setExpandedSeasons] = useState(new Set())
  const [episodes, setEpisodes] = useState(null)
  const [loadingEps, setLoadingEps] = useState(false)
  const [searching, setSearching] = useState(false)
  const [interactiveEp, setInteractiveEp] = useState(null)
  const [deletingSeason, setDeletingSeason] = useState(null)
  const [confirmSeasonDelete, setConfirmSeasonDelete] = useState(null)
  const [confirmRemoveSeries, setConfirmRemoveSeries] = useState(false)
  const [deleteSeriesFiles, setDeleteSeriesFiles] = useState(false)
  const [removingSeries, setRemovingSeries] = useState(false)

  const { total, onDisk } = mainSeasonCounts(show)
  const missing = Math.max(0, total - onDisk)
  const pct     = total > 0 ? Math.round((onDisk / total) * 100) : 0

  const fetchEpisodes = useCallback(async () => {
    try {
      const r = await fetch(`/api/sonarr/series/${show.id}/episodes`)
      const data = await r.json()
      setEpisodes(Array.isArray(data) ? data : [])
    } catch {
      setEpisodes(prev => prev ?? [])
    }
  }, [show.id])

  async function loadEpisodes() {
    if (!episodes) setLoadingEps(true)
    await fetchEpisodes()
    setLoadingEps(false)
  }

  // Poll episodes every 15s while expanded (fallback if webhook not configured)
  useEffect(() => {
    if (!expanded) return
    loadEpisodes()
    const interval = setInterval(fetchEpisodes, 15000)
    return () => clearInterval(interval)
  }, [expanded, fetchEpisodes])

  // Immediate refresh when a webhook event arrives for this series
  useEffect(() => {
    if (!sonarrEvent || !expanded) return
    if (sonarrEvent.seriesId == null || sonarrEvent.seriesId === show.id) {
      fetchEpisodes()
    }
  }, [sonarrEvent])

  async function searchMissing() {
    setSearching(true)
    try {
      const r = await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SeriesSearch', seriesId: show.id }),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      onToast(`Searching all missing episodes of "${show.title}"…`, 'info')
      pollCommand(data.id, (status, result) => {
        if (status === 'completed' && result === 'successful') {
          onToast(`Search complete for "${show.title}" — check downloads`, 'success')
        } else if (status === 'completed' && result === 'skipped') {
          onToast(`Search skipped for "${show.title}" (no indexer results)`, 'info')
        } else if (status === 'failed' || result === 'unsuccessful') {
          onToast(`Search failed for "${show.title}"`, 'error')
        } else if (status === 'timeout') {
          onToast(`"${show.title}" search is taking a while — check Sonarr`, 'info')
        }
      })
    } catch (e) {
      onToast(`Search failed: ${e.message}`, 'error')
    } finally {
      setSearching(false)
    }
  }

  async function searchEpisode(episodeId) {
    try {
      const r = await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'EpisodeSearch', episodeIds: [episodeId] }),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      onToast('Episode search queued…', 'info')
      pollCommand(data.id, (status, result) => {
        if (status === 'completed' && result === 'successful') {
          onToast('Episode search completed — check downloads', 'success')
        } else if (status === 'completed' && result === 'skipped') {
          onToast('Episode search skipped (no indexers returned results)', 'info')
        } else if (status === 'failed' || result === 'unsuccessful') {
          onToast('Episode search failed — no results found', 'error')
        } else if (status === 'timeout') {
          onToast('Episode search is taking a while — check Sonarr for status', 'info')
        }
      })
    } catch (e) {
      onToast(`Search failed: ${e.message}`, 'error')
    }
  }

  async function deleteSeasonFiles(sn) {
    const eps = (episodes || []).filter(e => e.seasonNumber === sn && e.hasFile)
    if (!eps.length) return
    setDeletingSeason(sn)
    try {
      // Delete all episode files in the season
      await Promise.all(eps.map(ep =>
        fetch(`/api/sonarr/episodefile/${ep.episodeFileId}`, { method: 'DELETE' })
      ))
      // Unmonitor all episodes in the season
      await fetch('/api/sonarr/episode/monitor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: eps.map(e => e.id), monitored: false }),
      })
      onToast(`Season ${sn}: ${eps.length} episode${eps.length !== 1 ? 's' : ''} deleted and unmonitored`, 'info')
      fetchEpisodes()
    } catch (e) {
      onToast(`Season delete failed: ${e.message}`, 'error')
    } finally {
      setDeletingSeason(null)
      setConfirmSeasonDelete(null)
    }
  }

  async function removeSeries() {
    setRemovingSeries(true)
    try {
      const url = `/api/sonarr/series/${show.id}?deleteFiles=${deleteSeriesFiles}`
      const r = await fetch(url, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Remove failed')
      onToast(`"${show.title}" removed${deleteSeriesFiles ? ' and files deleted' : ''}`, 'info')
      onRemoved()
    } catch (e) {
      onToast(`Remove failed: ${e.message}`, 'error')
    } finally {
      setRemovingSeries(false)
      setConfirmRemoveSeries(false)
    }
  }

  // Group episodes by season
  const seasonMap = {}
  if (episodes) {
    for (const ep of episodes) {
      if (ep.seasonNumber === 0) continue // skip specials
      if (!seasonMap[ep.seasonNumber]) seasonMap[ep.seasonNumber] = []
      seasonMap[ep.seasonNumber].push(ep)
    }
    Object.values(seasonMap).forEach(arr =>
      arr.sort((a, b) => b.episodeNumber - a.episodeNumber)
    )
  }
  const seasons = Object.keys(seasonMap).map(Number).sort((a, b) => b - a)

  function toggleSeason(sn) {
    setExpandedSeasons(prev => {
      const next = new Set(prev)
      next.has(sn) ? next.delete(sn) : next.add(sn)
      return next
    })
  }

  return (
    <div className={`show-card card ${expanded ? 'expanded' : ''}`}>
      {interactiveEp && (
        <EpisodeSearchModal
          episode={interactiveEp}
          seriesTitle={show.title}
          nzbhydraUrl={nzbhydraUrl}
          onClose={() => setInteractiveEp(null)}
          onToast={onToast}
        />
      )}
      <div className="show-card-main" onClick={() => setExpanded(prev => !prev)}>
        <div className="show-info">
          <div className="show-title font-semibold truncate" title={show.title}>{show.title}</div>
          <div className="show-meta">
            {show.year && <span className="text-xs text-muted">{show.year}</span>}
            {show.network && <span className="text-xs text-secondary">{show.network}</span>}
            <span className={`badge text-xs ${STATUS_BADGE[show.status?.toLowerCase()] || 'badge-muted'}`}>
              {show.status}
            </span>
          </div>
          <div className="show-progress">
            <div className="progress-bar" style={{height:4}}>
              <div className="progress-fill" style={{width:`${pct}%`}} />
            </div>
            <span className="text-xs text-muted">
              {onDisk}/{total} eps
              {missing > 0 && <span className="missing-badge">{missing} missing</span>}
            </span>
          </div>
        </div>
        {missing > 0 && (
          <button
            className="btn btn-success btn-sm"
            onClick={e => { e.stopPropagation(); searchMissing() }}
            disabled={searching}
            title="Search for all missing episodes"
          >
            {searching ? <span className="spinner" style={{width:12,height:12}} /> : '⬇'} Search Missing
          </button>
        )}
        {sonarrUrl && show.titleSlug && (
          <a
            className="btn btn-ghost btn-sm"
            href={`${sonarrUrl}/series/${show.titleSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            title="Open in Sonarr"
          >Open in Sonarr ↗</a>
        )}
        {confirmRemoveSeries ? (
          <div className="series-remove-confirm" onClick={e => e.stopPropagation()}>
            <label className="text-xs" style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer'}}>
              <input
                type="checkbox"
                checked={deleteSeriesFiles}
                onChange={e => setDeleteSeriesFiles(e.target.checked)}
                disabled={removingSeries}
              />
              Delete files
            </label>
            <button
              className="btn btn-danger btn-xs"
              onClick={e => { e.stopPropagation(); removeSeries() }}
              disabled={removingSeries}
            >
              {removingSeries ? <span className="spinner" style={{width:10,height:10}} /> : '✓ Confirm'}
            </button>
            <button
              className="btn btn-secondary btn-xs"
              onClick={e => { e.stopPropagation(); setConfirmRemoveSeries(false); setDeleteSeriesFiles(false) }}
              disabled={removingSeries}
            >Cancel</button>
          </div>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            onClick={e => { e.stopPropagation(); setConfirmRemoveSeries(true) }}
            title="Remove series from Sonarr"
          >🗑 Remove</button>
        )}
        <span className="expand-icon">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="show-episodes">
          {loadingEps ? (
            <div className="flex items-center gap-2 text-secondary" style={{padding:'16px 0'}}>
              <span className="spinner" style={{width:16,height:16}} />
              Loading episodes…
            </div>
          ) : seasons.length === 0 ? (
            <div className="text-muted text-sm">No episodes found</div>
          ) : (
            seasons.map(sn => {
              const eps = seasonMap[sn]
              const dlCount = eps.filter(e => e.hasFile).length
              const missingCount = eps.filter(e => !e.hasFile && e.airDateUtc && new Date(e.airDateUtc) < new Date()).length
              const isSeasonOpen = expandedSeasons.has(sn)
              return (
                <div key={sn} className="season-block">
                  <div
                    className="season-header season-header-clickable"
                    onClick={() => toggleSeason(sn)}
                  >
                    <span className="season-expand-icon">{isSeasonOpen ? '▾' : '▸'}</span>
                    <span className="font-semibold">Season {sn}</span>
                    <span className="text-xs text-muted">{dlCount}/{eps.length} episodes</span>
                    {missingCount > 0 && (
                      <button
                        className="btn btn-success btn-xs"
                        onClick={async e => {
                          e.stopPropagation()
                          const ids = eps
                            .filter(e => !e.hasFile && e.airDateUtc && new Date(e.airDateUtc) < new Date())
                            .map(e => e.id)
                          if (!ids.length) return
                          try {
                            const r = await fetch('/api/sonarr/command', {
                              method:'POST',
                              headers:{'Content-Type':'application/json'},
                              body: JSON.stringify({name:'EpisodeSearch', episodeIds: ids}),
                            })
                            const data = await r.json()
                            if (data.error) throw new Error(data.error)
                            onToast(`Searching ${ids.length} missing episodes in S${sn}…`, 'info')
                            pollCommand(data.id, (status, result) => {
                              if (status === 'completed' && result === 'successful') {
                                onToast(`S${sn} search complete — check downloads`, 'success')
                              } else if (status === 'failed' || result === 'unsuccessful') {
                                onToast(`S${sn} search failed — no results found`, 'error')
                              } else if (status === 'timeout') {
                                onToast(`S${sn} search is taking a while — check Sonarr`, 'info')
                              }
                            })
                          } catch(e) {
                            onToast(`Failed: ${e.message}`, 'error')
                          }
                        }}
                      >
                        Search {missingCount} Missing
                      </button>
                    )}
                    {dlCount > 0 && (
                      <div className="season-header-right" onClick={e => e.stopPropagation()}>
                        {confirmSeasonDelete === sn ? (
                          <>
                            <button
                              className="btn btn-danger btn-xs"
                              onClick={e => { e.stopPropagation(); deleteSeasonFiles(sn) }}
                              disabled={deletingSeason === sn}
                            >
                              {deletingSeason === sn
                                ? <span className="spinner" style={{width:10,height:10}} />
                                : `✓ Delete ${dlCount} file${dlCount !== 1 ? 's' : ''}`}
                            </button>
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={e => { e.stopPropagation(); setConfirmSeasonDelete(null) }}
                              disabled={deletingSeason === sn}
                            >Cancel</button>
                          </>
                        ) : (
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={e => { e.stopPropagation(); setConfirmSeasonDelete(sn) }}
                            title={`Delete all ${dlCount} downloaded episode${dlCount !== 1 ? 's' : ''} in Season ${sn}`}
                          >🗑 Remove</button>
                        )}
                      </div>
                    )}
                  </div>
                  {isSeasonOpen && eps.map(ep => (
                    <EpisodeRow
                      key={ep.id}
                      ep={ep}
                      onSearch={searchEpisode}
                      onInteractiveSearch={setInteractiveEp}
                      onDeleted={err => {
                        if (err) onToast(`Delete failed: ${err}`, 'error')
                        else { onToast('Episode deleted and unmonitored', 'info'); fetchEpisodes() }
                      }}
                    />
                  ))}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

export default function ShowsTab({ onToast, sonarrUrl, nzbhydraUrl }) {
  const [series, setSeries] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('alpha')
  const [countdown, setCountdown] = useState(30)
  const [sonarrEvent, setSonarrEvent] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)

  const fetchSeries = useCallback(async () => {
    try {
      const r = await fetch('/api/sonarr/series')
      if (!r.ok) throw new Error((await r.json()).error)
      const data = await r.json()
      setSeries(Array.isArray(data) ? data : [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setCountdown(30)
    }
  }, [])

  useEffect(() => {
    fetchSeries()
    const dataInterval = setInterval(fetchSeries, 30000)
    const cdInterval   = setInterval(() => setCountdown(c => c > 0 ? c - 1 : 30), 1000)
    return () => { clearInterval(dataInterval); clearInterval(cdInterval) }
  }, [fetchSeries])

  // Subscribe to server-sent events from Sonarr webhooks
  useEffect(() => {
    const source = new EventSource('/api/events')
    source.addEventListener('sonarr', e => {
      const event = JSON.parse(e.data)
      setSonarrEvent({ ...event, _ts: Date.now() })
      fetchSeries() // refresh counts immediately
      setCountdown(30)
    })
    source.onerror = () => {} // silently reconnect
    return () => source.close()
  }, [fetchSeries])

  if (loading) {
    return <div className="empty-state"><span className="spinner" /><span>Loading shows…</span></div>
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">⚠️</div>
        <strong>Cannot reach Sonarr</strong>
        <p className="text-sm text-muted">{error}</p>
        <button className="btn btn-secondary mt-4" onClick={fetchSeries}>Retry</button>
      </div>
    )
  }

  const totalMissing = series.reduce((sum, s) => {
    const { total, onDisk } = mainSeasonCounts(s)
    return sum + Math.max(0, total - onDisk)
  }, 0)

  let filtered = series.filter(s => {
    if (search && !s.title.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'missing') {
      const { total, onDisk } = mainSeasonCounts(s)
      return total > onDisk
    }
    if (filter === 'continuing') return s.status?.toLowerCase() === 'continuing'
    if (filter === 'ended') return s.status?.toLowerCase() === 'ended'
    return true
  })

  if (sort === 'alpha') filtered.sort((a, b) => a.title.localeCompare(b.title))
  else if (sort === 'missing') {
    filtered.sort((a, b) => {
      const { total: ta, onDisk: oa } = mainSeasonCounts(a)
      const { total: tb, onDisk: ob } = mainSeasonCounts(b)
      return Math.max(0, tb - ob) - Math.max(0, ta - oa)
    })
  } else if (sort === 'year') filtered.sort((a, b) => (b.year || 0) - (a.year || 0))

  return (
    <div className="shows-tab">
      {/* Stats */}
      <div className="shows-stats card">
        <div className="stat-chip">
          <span className="stat-chip-value">{series.length}</span>
          <span className="stat-chip-label">Shows</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value text-danger">{totalMissing}</span>
          <span className="stat-chip-label">Missing Episodes</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value text-success">
            {series.filter(s => s.status?.toLowerCase() === 'continuing').length}
          </span>
          <span className="stat-chip-label">Continuing</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value text-muted">
            {series.filter(s => s.status?.toLowerCase() === 'ended').length}
          </span>
          <span className="stat-chip-label">Ended</span>
        </div>
        <button className="btn btn-primary btn-sm ml-auto" onClick={() => setShowAddModal(true)}>
          + Add Show
        </button>
      </div>

      {/* Controls */}
      <div className="shows-controls">
        <div className="search-input">
          <input
            type="text"
            placeholder="Search shows…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-buttons">
          {[['all','All'],['missing','Has Missing'],['continuing','Continuing'],['ended','Ended']].map(([v,l]) => (
            <button
              key={v}
              className={`btn btn-sm ${filter === v ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(v)}
            >{l}</button>
          ))}
        </div>
        <select
          className="sort-select"
          value={sort}
          onChange={e => setSort(e.target.value)}
        >
          <option value="alpha">A–Z</option>
          <option value="missing">Most Missing</option>
          <option value="year">Newest First</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={fetchSeries} title={`Refreshes in ${countdown}s`}>
          🔄 {countdown}s
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📺</div>
          <span>No shows match your filter</span>
        </div>
      ) : (
        <div className="shows-list">
          {filtered.map(show => (
            <ShowCard key={show.id} show={show} onToast={onToast} sonarrEvent={sonarrEvent} sonarrUrl={sonarrUrl} nzbhydraUrl={nzbhydraUrl} onRemoved={fetchSeries} />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddMediaModal
          type="show"
          onClose={() => setShowAddModal(false)}
          onAdded={fetchSeries}
          onToast={onToast}
        />
      )}
    </div>
  )
}
