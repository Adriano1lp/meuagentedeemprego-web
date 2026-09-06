export type User = {
  user_id?: string;
  id?: string;
  email?: string;
  display_name?: string;
  terms_version?: string | null;
  privacy_version?: string | null;
  [key: string]: unknown;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user?: User;
};

export type RegisterPayload = {
  display_name: string;
  email: string;
  password: string;
  terms_accepted: boolean;
  terms_version: string;
  privacy_accepted: boolean;
  privacy_version: string;
};
