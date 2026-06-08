import { useState, useEffect } from 'react'
import ConfigPage from './components/ConfigPage.jsx'
import Dashboard from './components/Dashboard.jsx'

export default function App() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(data => { setConfig(data); setLoading(false) })
      .catch(() => { setConfig({}); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <div className="loading-screen">
        <span className="spinner" />
        Loading…
      </div>
    )
  }

  const isConfigured =
    config &&
    ((config.sabnzbd?.url && config.sabnzbd?.apikey) ||
     (config.sonarr?.url   && config.sonarr?.apikey)  ||
     (config.radarr?.url   && config.radarr?.apikey))

  if (!isConfigured) {
    return (
      <ConfigPage
        initialConfig={config}
        onSave={newConfig => setConfig(newConfig)}
      />
    )
  }

  return (
    <Dashboard
      config={config}
      onReconfigure={() => setConfig({})}
    />
  )
}
