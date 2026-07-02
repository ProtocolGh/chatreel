import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, getCorsOriginOption } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import profilesRoutes from './routes/profiles.routes';
import friendshipsRoutes from './routes/friendships.routes';
import groupsRoutes from './routes/groups.routes';
import messagesRoutes from './routes/messages.routes';
import keysRoutes from './routes/keys.routes';
import uploadsRoutes from './routes/uploads.routes';
import chatsRoutes from './routes/chats.routes';
import qrRoutes from './routes/qr.routes';
import notificationsRoutes from './routes/notifications.routes';
import reelsRoutes from './routes/reels.routes';
import callsRoutes from './routes/calls.routes';
import momentsRoutes from './routes/moments.routes';
import chatSettingsRoutes from './routes/chat-settings.routes';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: getCorsOriginOption(),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '25mb' }));
  app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/profiles', profilesRoutes);
  app.use('/api/friendships', friendshipsRoutes);
  app.use('/api/groups', groupsRoutes);
  app.use('/api/messages', messagesRoutes);
  app.use('/api/keys', keysRoutes);
  app.use('/api/uploads', uploadsRoutes);
  app.use('/api/chats', chatsRoutes);
  app.use('/api/qr', qrRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/reels', reelsRoutes);
  app.use('/api/calls', callsRoutes);
  app.use('/api/moments', momentsRoutes);
  app.use('/api/chat-settings', chatSettingsRoutes);

  app.use(errorHandler);

  return app;
}
