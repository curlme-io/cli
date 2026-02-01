import Conf from 'conf';

interface Config {
  apiKey?: string;
  baseUrl: string;
  activeBinId?: string;
  hasSeenFeedbackPrompt?: boolean;
}

const config = new Conf<Config>({
  projectName: 'curlme-cli',
  defaults: {
    baseUrl: 'https://curlme.io'
  }
});

// Helper to get the actual API URL, prioritising env var
export const getBaseUrl = () => {
  let url = process.env.CURLME_API_URL || config.get('baseUrl');
  if (url && !url.startsWith('http')) {
    url = `http://${url}`;
  }
  return url;
};

export const getActiveBin = () => config.get('activeBinId');
export const setActiveBin = (id: string) => config.set('activeBinId', id);

export default config;
