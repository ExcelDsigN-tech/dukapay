import { createClient, type RedisClientType } from 'redis';
import logger from '../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CHANNEL = 'sse:events';

class PubSubService {
  private pubClient: RedisClientType | null = null;
  private subClient: RedisClientType | null = null;

  async publish(event: unknown) {
    try {
      if (!this.pubClient) {
        this.pubClient = createClient({ url: REDIS_URL });
        this.pubClient.on('error', (err) => logger.withContext().error('Redis pub client error', err));
        await this.pubClient.connect();
      }
      await this.pubClient.publish(CHANNEL, JSON.stringify(event));
    } catch (err) {
      logger.withContext().error('Failed to publish SSE event to Redis', { err });
    }
  }

  async initSubscriber(onMessage: (payload: any) => void) {
    try {
      if (!this.subClient) {
        this.subClient = createClient({ url: REDIS_URL });
        this.subClient.on('error', (err) => logger.withContext().error('Redis sub client error', err));
        await this.subClient.connect();
      }

      await this.subClient.subscribe(CHANNEL, (msg) => {
        try {
          const payload = JSON.parse(msg);
          onMessage(payload);
        } catch (e) {
          logger.withContext().error('Failed to parse pubsub message', { err: e });
        }
      });
    } catch (err) {
      logger.withContext().error('Failed to initialize Redis subscriber', { err });
    }
  }
}

export const pubsubService = new PubSubService();
