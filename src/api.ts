import axios, { AxiosInstance } from 'axios';
import config, { getBaseUrl } from './config';

class Api {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: getBaseUrl(),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.client.interceptors.request.use((req) => {
      const apiKey = config.get('apiKey');
      if (apiKey) {
        req.headers['x-api-key'] = apiKey;
      }
      return req;
    });

    this.client.interceptors.response.use(
      (res) => res,
      (error) => {
        if (error.response?.status === 401) {
          throw new Error('Unauthorized: Please run `curlme login` first.');
        }
        throw error;
      }
    );
  }

  getBaseUrl() {
    return this.client.defaults.baseURL;
  }

  async getBins() {
    const res = await this.client.get('/api/bins');
    return res.data;
  }

  async createBin(name: string) {
    const res = await this.client.post('/api/bins', { name });
    return res.data;
  }

  async deleteBin(binId: string) {
    const res = await this.client.delete(`/api/bins/${binId}`);
    return res.data;
  }

  async getRequests(binId: string, since?: number) {
    const res = await this.client.get(`/api/bins/${binId}/requests`, {
      params: since ? { since } : {}
    });
    return res.data;
  }

  async getWhoAmI() {
    const res = await this.client.get('/api/user');
    return res.data;
  }

  async getUsage() {
    try {
      const res = await this.client.get('/api/user/usage');
      return res.data;
    } catch {
      return null;
    }
  }

  async getBin(binId: string) {
    const res = await this.client.get(`/api/bins/${binId}`);
    return res.data;
  }

  async getExport(binId: string, format: string) {
    const res = await this.client.get(`/api/bins/${binId}/export`, {
      params: { format }
    });
    return res.data;
  }
}

export default new Api();
