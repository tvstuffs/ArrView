import { useState, useEffect, useRef } from 'react'
import './AddMediaModal.css'

// Returns the best poster URL from a Sonarr/Radarr result object
function getPoster(item) {
  if (item.remotePoster) return item.remotePoster
  if (item.images) {
    const img = item.images.find(i => i.coverType === 'poster')
    if (img) return img.remoteUrl || img.url
  }
  return null
}

function ResultCard({ item, selected, onSelect, type }) {
  const poster = getPoster(item)
  const alreadyAdded = !!item.id
  const isSelected = selected?.tvdbId === item.tvdbId || selected?.tmdbId === item.tmdbId

  return (
    <div
      className={`result-card ${isSelected ? 'selected' : ''} ${alreadyAdded ? 'already-added' : ''}`}
      onClick={() => !alreadyAdded && onSelect(item)}
    >
      <div className="result-poster">
        {poster
          ? <img src={poster} alt={item.title} loading="lazy" />
          : <div className="result-poster-placeholder">{item.title[0]}</div>
        }
      </div>
      <div className="result-info">
        <div className="result-title font-semibold">{item.title}</div>
        <div className="result-meta text-xs text-muted">
          {item.year > 0 && <span>{item.year}</span>}
          {type === 'show' && item.status && <span>{item.status}</span>}
          {type === 'show' && item.network && <span>{item.network}</span>}
          {type === 'movie' && item.studio && <span>{item.studio}</span>}
        </div>
        {item.overview && (
          <p className="result-overview text-xs text-secondary">{item.overview}</p>
        )}
        {alreadyAdded && <span className="badge badge-accent text-xs">Already in library</span>}
      </div>
    </div>
  )
}

export default function AddMediaModal({ type, onClose, onAdded, onToast }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)

  // Config options
  const [qualityProfiles, setQualityProfiles] = useState([])
  const [rootFolders, setRootFolders] = useState([])
  const [qualityProfileId, setQualityProfileId] = useState('')
  const [rootFolderPath, setRootFolderPath] = useState('')
  const [monitored, setMonitored] = useState(true)
  const [searchOnAdd, setSearchOnAdd] = useState(true)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)

  const inputRef = useRef(null)
  const prefix = type === 'show' ? '/api/sonarr' : '/api/radarr'

  // Focus input on open
  useEffect(() => { inputRef.current?.focus() }, [])

  // Load quality profiles + root folders
  useEffect(() => {
    Promise.all([
      fetch(`${prefix}/qualityprofiles`).then(r => r.json()),
      fetch(`${prefix}/rootfolders`).then(r => r.json()),
    ]).then(([qp, rf]) => {
      const profiles = Array.isArray(qp) ? qp : []
      const folders  = Array.isArray(rf) ? rf : []
      setQualityProfiles(profiles)
      setRootFolders(folders)
      if (profiles.length) setQualityProfileId(String(profiles[0].id))
      if (folders.length)  setRootFolderPath(folders[0].path)
    }).catch(() => {})
  }, [prefix])

  // Debounced lookup
  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(`${prefix}/lookup?term=${encodeURIComponent(q)}`)
        const data = await r.json()
        setResults(Array.isArray(data) ? data.slice(0, 12) : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query, prefix])

  async function handleAdd() {
    if (!selected || !qualityProfileId || !rootFolderPath) return
    setAdding(true)
    setAddError(null)
    try {
      const endpoint = type === 'show' ? `${prefix}/series` : `${prefix}/movie`
      const body = type === 'show'
        ? {
            ...selected,
            id: undefined, // strip id so Sonarr treats it as new
            qualityProfileId: parseInt(qualityProfileId),
            rootFolderPath,
            monitored,
            seasonFolder: true,
            addOptions: { searchForMissingEpisodes: searchOnAdd, monitor: 'all' },
          }
        : {
            ...selected,
            id: undefined,
            qualityProfileId: parseInt(qualityProfileId),
            rootFolderPath,
            monitored,
            addOptions: { searchForMovie: searchOnAdd },
          }

      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      onToast(`"${selected.title}" added to ${type === 'show' ? 'Sonarr' : 'Radarr'}!`, 'success')
      onAdded?.()
      onClose()
    } catch (e) {
      setAddError(e.message)
    } finally {
      setAdding(false)
    }
  }

  const label = type === 'show' ? 'TV Show' : 'Movie'
  const canAdd = selected && qualityProfileId && rootFolderPath

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <h2>Add {label}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Search */}
        <div className="modal-search">
          <input
            ref={inputRef}
            type="text"
            placeholder={`Search for a ${label.toLowerCase()}…`}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null); setAddError(null) }}
          />
          {searching && <span className="spinner modal-search-spinner" />}
        </div>

        {/* Results */}
        {results.length > 0 && !selected && (
          <div className="modal-results">
            {results.map((item, i) => (
              <ResultCard
                key={item.tvdbId || item.tmdbId || i}
                item={item}
                selected={selected}
                onSelect={setSelected}
                type={type}
              />
            ))}
          </div>
        )}

        {/* No results */}
        {query.trim() && !searching && results.length === 0 && (
          <div className="modal-empty text-muted text-sm">No results found for "{query}"</div>
        )}

        {/* Selected item config */}
        {selected && (
          <div className="modal-config">
            <div className="selected-preview">
              {getPoster(selected) && (
                <img src={getPoster(selected)} alt={selected.title} className="selected-poster" />
              )}
              <div>
                <div className="font-semibold" style={{fontSize:15}}>{selected.title}</div>
                <div className="text-sm text-muted">{selected.year > 0 ? selected.year : ''}</div>
                <button className="btn btn-ghost btn-sm mt-2" onClick={() => setSelected(null)}>
                  ← Change selection
                </button>
              </div>
            </div>

            <div className="config-fields">
              <div className="config-row">
                <label>Quality Profile</label>
                <select
                  value={qualityProfileId}
                  onChange={e => setQualityProfileId(e.target.value)}
                >
                  {qualityProfiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                  {qualityProfiles.length === 0 && <option>Loading…</option>}
                </select>
              </div>

              <div className="config-row">
                <label>Root Folder</label>
                <select
                  value={rootFolderPath}
                  onChange={e => setRootFolderPath(e.target.value)}
                >
                  {rootFolders.map(f => (
                    <option key={f.path} value={f.path}>{f.path}</option>
                  ))}
                  {rootFolders.length === 0 && <option>Loading…</option>}
                </select>
              </div>

              <div className="config-checkboxes">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={monitored}
                    onChange={e => setMonitored(e.target.checked)}
                  />
                  Monitored
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={searchOnAdd}
                    onChange={e => setSearchOnAdd(e.target.checked)}
                  />
                  {type === 'show' ? 'Search for missing episodes after add' : 'Search for movie after add'}
                </label>
              </div>
            </div>

            {addError && <div className="error-banner">{addError}</div>}

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={!canAdd || adding}
              >
                {adding
                  ? <><span className="spinner" style={{width:14,height:14}} /> Adding…</>
                  : `Add ${label}`
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
