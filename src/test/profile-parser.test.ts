import { describe, expect, it } from 'vitest';

import {
  hasProfileIdentity,
  parseCurrentUser,
  profileErrorLeaksInternals,
  PROFILE_LOAD_FAILED,
  PROFILE_SESSION_EXPIRED,
  safeProfileErrorMessage,
  subscriptionStatusLabel,
} from '../api/profile';
import { planLabel } from '../api/status';

describe('parseCurrentUser', () => {
  it('espelha nome, email, plano e status de GET /users/me sem inventar cota', () => {
    const user = parseCurrentUser({
      user_id: 'user-1',
      auth_mode: 'jwt',
      display_name: 'Ada Lovelace',
      email: 'ada@example.com',
      plan: 'essencial',
      subscription_status: 'active',
      terms_accepted: true,
      privacy_version: '1.0',
      used: 99,
      limit: 30,
      remaining: 1,
    });

    expect(user).toEqual({
      user_id: 'user-1',
      email: 'ada@example.com',
      display_name: 'Ada Lovelace',
      plan: 'essencial',
      subscription_status: 'active',
    });
    expect(user).not.toHaveProperty('used');
    expect(user).not.toHaveProperty('limit');
    expect(user).not.toHaveProperty('remaining');
    expect(planLabel(user.plan)).toBe('Essencial');
    expect(subscriptionStatusLabel(user.subscription_status)).toBe('Ativa');
    expect(hasProfileIdentity(user)).toBe(true);
  });

  it('nao preenche plano ou status quando o JSON nao traz esses campos', () => {
    const user = parseCurrentUser({
      user_id: 'user-1',
      display_name: 'Ada Lovelace',
      email: 'ada@example.com',
    });

    expect(user.plan).toBeUndefined();
    expect(user.subscription_status).toBeUndefined();
    expect(planLabel(user.plan)).toBeNull();
    expect(subscriptionStatusLabel(user.subscription_status)).toBeNull();
  });

  it('trata payload sem identidade como vazio, sem default Free', () => {
    const user = parseCurrentUser({ user_id: 'user-1', auth_mode: 'jwt' });
    expect(hasProfileIdentity(user)).toBe(false);
    expect(user.plan).toBeUndefined();
    expect(planLabel(undefined)).toBeNull();
  });

  it('rejeita corpo que nao e objeto', () => {
    expect(() => parseCurrentUser(null)).toThrow(/formato invalido/);
    expect(() => parseCurrentUser([])).toThrow(/formato invalido/);
    expect(() => parseCurrentUser('ada')).toThrow(/formato invalido/);
  });

  it('rotula so os status reais e preserva valor desconhecido', () => {
    expect(subscriptionStatusLabel('none')).toBe('Sem assinatura');
    expect(subscriptionStatusLabel('past_due')).toBe('Pagamento pendente');
    expect(subscriptionStatusLabel('canceled')).toBe('Cancelada');
    expect(subscriptionStatusLabel('trialing')).toBe('trialing');
    expect(subscriptionStatusLabel(undefined)).toBeNull();
  });
});

describe('safeProfileErrorMessage', () => {
  it('nao devolve path, URL ou token', () => {
    const message = safeProfileErrorMessage({
      status: 500,
      message:
        'File "/app/main.py" GET /users/me https://meu-agente-de-emprego.onrender.com Bearer jwt-abc',
    });
    expect(message).toBe(PROFILE_LOAD_FAILED);
    expect(profileErrorLeaksInternals(message)).toBe(false);
  });

  it('401 vira sessao expirada sem vazar o corpo', () => {
    const message = safeProfileErrorMessage({
      status: 401,
      message: 'Token jwt-secret em /users/me',
    });
    expect(message).toBe(PROFILE_SESSION_EXPIRED);
    expect(profileErrorLeaksInternals(message)).toBe(false);
  });
});
