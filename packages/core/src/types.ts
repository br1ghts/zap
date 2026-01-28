export type TokenRow = {
  broadcasterId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string;
  tokenType: string;
};

export type ClipRecord = {
  broadcasterId: string;
  clipId?: string;
  url?: string;
  requestedBy: string;
  requestedById?: string;
  note?: string;
  status: 'pending' | 'ok' | 'failed';
  error?: string;
};

export type ClipStore = {
  saveClip(entry: ClipRecord): Promise<void>;
};

export type TokenStore = {
  getToken(broadcasterId: string): Promise<TokenRow | null>;
  upsertToken(token: TokenRow): Promise<void>;
};
