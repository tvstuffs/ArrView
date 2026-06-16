import { useState, useEffect } from 'react'
import './ConfigPage.css'

const SERVICES = [
  {
    id: 'sabnzbd',
    name: 'SABnzbd',
    icon: '📥',
    description: 'Usenet downloader',
    placeholder: 'http://localhost:8080',
  },
  {
    id: 'nzbhydra',
    name: 'NZBHydra',
    icon: '🔎',
    description: 'Usenet search aggregator',
    placeholder: 'http://localhost:5076',
  },
  {
    id: 'sonarr',
    name: 'Sonarr',
    icon: '📺',
    description: 'TV show management',
    placeholder: 'http://localhost:8989',
  },
  {
    id: 'radarr',
    name: 'Radarr',
    icon: '🎬',
    description: 'Movie management',
    placeholder: 'http://localhost:7878',
  },
]

function ServiceCard({ service, values, onChange, onTest }) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const result = await onTest(service.id, values.url, values.apikey)
    setTestResult(result)
    setTesting(false)
  }

  const hasCredentials = values.url && values.apikey

  return (
    <div className="service-card card">
      <div className="service-header">
        <span className="service-icon">{service.icon}</span>
        <div>
          <div className="font-semibold">{service.name}</div>
          <div className="text-sm text-muted">{service.description}</div>
        </div>
        {testResult && (
          <div className={`test-badge ${testResult.success ? 'badge-success' : 'badge-danger'} badge ml-auto`}>
            {testResult.success
              ? `✓ Connected${testResult.version ? ` v${testResult.version}` : ''}`
              : '✗ Failed'}
          </div>
        )}
      </div>

      <div className="service-fields">
        <div className="field-group">
          <label>Server URL</label>
          <input
            type="url"
            placeholder={service.placeholder}
            value={values.url || ''}
            onChange={e => onChange(service.id, 'url', e.target.value)}
          />
        </div>
        <div className="field-group">
          <label>API Key</label>
          <div className="input-group">
            <input
              type="password"
              placeholder="Enter API key…"
              value={values.apikey || ''}
              onChange={e => onChange(service.id, 'apikey', e.target.value)}
            />
            <button
              className="btn btn-secondary btn-sm"
              disabled={!hasCredentials || testing}
              onClick={handleTest}
            >
              {testing ? <span className="spinner" style={{width:14,height:14}} /> : 'Test'}
            </button>
          </div>
        </div>
      </div>

      {testResult && !testResult.success && (
        <div className="error-banner mt-2" style={{fontSize: 12}}>
          {testResult.error}
        </div>
      )}
    </div>
  )
}

export default function ConfigPage({ initialConfig = {}, onSave, onBack }) {
  const [config, setConfig] = useState(() => ({
    sabnzbd:  { url: '', apikey: '', ...initialConfig.sabnzbd  },
    nzbhydra: { url: '', apikey: '', ...initialConfig.nzbhydra },
    sonarr:   { url: '', apikey: '', ...initialConfig.sonarr   },
    radarr:   { url: '', apikey: '', ...initialConfig.radarr   },
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [version, setVersion] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/arrview/identify')
      .then(r => r.json())
      .then(d => { if (!cancelled) setVersion(d.version) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  function handleChange(service, field, value) {
    setConfig(prev => ({
      ...prev,
      [service]: { ...prev[service], [field]: value },
    }))
  }

  async function handleTest(serviceId, url, apikey) {
    try {
      const normalizedUrl = url && !url.match(/^https?:\/\//) ? `http://${url}` : url
      const r = await fetch(`/api/test/${serviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl, apikey }),
      })
      const data = await r.json()
      return data.success ? data : { success: false, error: data.error }
    } catch (e) {
      return { success: false, error: 'Request failed' }
    }
  }

  async function handleSave() {
    const hasAny = SERVICES.some(s => config[s.id].url && config[s.id].apikey)
    if (!hasAny) {
      setError('Configure at least one service before saving.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const cleanConfig = {}
      SERVICES.forEach(s => {
        if (config[s.id].url && config[s.id].apikey) {
          let url = config[s.id].url.replace(/\/$/, '')
          if (!url.match(/^https?:\/\//)) url = `http://${url}`
          cleanConfig[s.id] = { url, apikey: config[s.id].apikey }
        }
      })
      const r = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanConfig),
      })
      const data = await r.json()
      if (data.success) onSave(cleanConfig)
      else throw new Error('Save failed')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="config-page">
      <div className="config-container">
        <header className="config-header">
          <img className="config-logo" src="/arrview-icon.svg" alt="ArrView" width="72" height="72" />
          <h1>ArrView</h1>
          <p className="text-secondary">
            Configure your media server connections to get started.
            Enter the URL and API key for each service you want to monitor.
          </p>
        </header>

        <div className="services-grid">
          {SERVICES.map(service => (
            <ServiceCard
              key={service.id}
              service={service}
              values={config[service.id]}
              onChange={handleChange}
              onTest={handleTest}
            />
          ))}
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="config-footer">
          {!onBack && (
            <p className="text-sm text-muted">
              You can update these settings later via the Settings button in the dashboard.
            </p>
          )}
          <div className="config-footer-actions">
            {onBack && (
              <button className="btn btn-secondary btn-lg" onClick={onBack} disabled={saving}>
                ← Back
              </button>
            )}
            <button
              className="btn btn-primary btn-lg"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <><span className="spinner" style={{width:16,height:16}} /> Saving…</> : 'Save'}
            </button>
          </div>
          {version && (
            <p className="config-version text-sm text-muted">ArrView v{version}</p>
          )}
        </div>
      </div>
    </div>
  )
}
