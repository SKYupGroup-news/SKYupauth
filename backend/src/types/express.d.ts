import type { PublicUser } from '../lib/current-user';

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}
