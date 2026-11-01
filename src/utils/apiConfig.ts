export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // If hosted on GitHub Pages or custom static host, connect to the deployed Cloud Run backend
    if (window.location.hostname.includes('github.io')) {
      return 'https://ais-pre-zavrwtfvdasagrpfmd3scd-760935448485.europe-west2.run.app';
    }
  }
  // Otherwise use relative path on the same host
  return '';
}

export function getLiveWsUrl(): string {
  if (typeof window !== 'undefined') {
    if (window.location.hostname.includes('github.io')) {
      return 'wss://ais-pre-zavrwtfvdasagrpfmd3scd-760935448485.europe-west2.run.app/live';
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/live`;
  }
  return '';
}
