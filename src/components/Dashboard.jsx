import { useState, useEffect, useCallback } from 'react'
import DownloadsTab from './DownloadsTab.jsx'
import ShowsTab from './ShowsTab.jsx'
import MoviesTab from './MoviesTab.jsx'
import ConfigPage from './ConfigPage.jsx'
import './Dashboard.css'

const TABS = [
  { id: 'downloads', label: 'Downloads', icon: '📥' },
  { id: 'shows',     label: 'TV Shows',  icon: '📺' },
  { id: 'movies',    label: 'Movies',    icon: '🎬' },
]

function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
      ))}
    </div>
  )
}

export default function Dashboard({ config, onReconfigure }) {
  const [activeTab, setActiveTab] = useState('downloads')
  const [serviceStatus, setServiceStatus] = useState({})
  const [showingConfig, setShowingConfig] = useState(false)
  const [toasts, setToasts] = useState([])

  function addToast(message, type = 'info') {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  const checkServices = useCallback(async () => {
    const checks = {}
    const services = Object.keys(config)
    await Promise.allSettled(
      services.map(async svc => {
        try {
          const endpoint =
            svc === 'sabnzbd'  ? '/api/sabnzbd/queue'    :
            svc === 'sonarr'   ? '/api/sonarr/series'    :
            svc === 'radarr'   ? '/api/radarr/movies'    :
            svc === 'nzbhydra' ? '/api/nzbhydra/status'  : null
          if (!endpoint) return
          const r = await fetch(endpoint)
          checks[svc] = r.ok ? 'online' : 'offline'
        } catch {
          checks[svc] = 'offline'
        }
      })
    )
    setServiceStatus(checks)
  }, [config])

  useEffect(() => {
    checkServices()
    const interval = setInterval(checkServices, 60000)
    return () => clearInterval(interval)
  }, [checkServices])

  if (showingConfig) {
    return (
      <ConfigPage
        initialConfig={config}
        onBack={() => setShowingConfig(false)}
        onSave={newConfig => {
          onReconfigure()
          // App will re-read config and re-render
          window.location.reload()
        }}
      />
    )
  }

  const configuredServices = Object.keys(config)

  return (
    <div className="dashboard">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-left">
          <img className="topbar-logo" src="/arrview-icon.svg" alt="" width="28" height="28" />
          <span className="topbar-title">ArrView</span>
        </div>

        <div className="topbar-services">
          {['sabnzbd', 'nzbhydra', 'sonarr', 'radarr'].map(svc => {
            if (!config[svc]) return null
            const icons = { sabnzbd: '📥', nzbhydra: '🔎', sonarr: '📺', radarr: '🎬' }
            const labels = { sabnzbd: 'SABnzbd', nzbhydra: 'NZBHydra', sonarr: 'Sonarr', radarr: 'Radarr' }
            const status = serviceStatus[svc] || 'unknown'
            return (
              <a
                key={svc}
                className="service-pill"
                href={config[svc].url}
                target="_blank"
                rel="noopener noreferrer"
                title={`${labels[svc]}: ${status} — click to open`}
              >
                <span className={`status-dot ${status}`} />
                <span className="service-pill-name">{labels[svc]}</span>
              </a>
            )
          })}
        </div>

        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowingConfig(true)}
          title="Settings"
        >
          ⚙️ Settings
        </button>
      </header>

      {/* Tab bar */}
      <nav className="tabbar">
        {TABS.map(tab => {
          const serviceMap = { downloads: 'sabnzbd', shows: 'sonarr', movies: 'radarr' }
          const requiredService = serviceMap[tab.id]
          if (requiredService && !config[requiredService]) return null
          return (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon} {tab.label}
            </button>
          )
        })}
      </nav>

      {/* Content */}
      <main className="dashboard-content">
        {activeTab === 'downloads' && (
          config.sabnzbd
            ? <DownloadsTab onToast={addToast} />
            : <NotConfigured service="SABnzbd" onSettings={() => setShowingConfig(true)} />
        )}
        {activeTab === 'shows' && (
          config.sonarr
            ? <ShowsTab onToast={addToast} sonarrUrl={config.sonarr?.url} nzbhydraUrl={config.nzbhydra?.url} />
            : <NotConfigured service="Sonarr" onSettings={() => setShowingConfig(true)} />
        )}
        {activeTab === 'movies' && (
          config.radarr
            ? <MoviesTab onToast={addToast} />
            : <NotConfigured service="Radarr" onSettings={() => setShowingConfig(true)} />
        )}
      </main>

      <Toast toasts={toasts} />
    </div>
  )
}

function NotConfigured({ service, onSettings }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">⚙️</div>
      <strong>{service} is not configured</strong>
      <p>Add your {service} connection details in Settings.</p>
      <button className="btn btn-secondary mt-4" onClick={onSettings}>Open Settings</button>
    </div>
  )
}
