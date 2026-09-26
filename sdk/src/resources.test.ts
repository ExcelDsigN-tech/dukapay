import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from './http.js';
import type { Paginated, Remittance } from './types.js';
import {
  AuthResource,
  LoansResource,
  PoolResource,
  ScoresResource,
  RemittanceResource,
} from './resources.js';
import { ValidationError } from './errors.js';

describe('RemittanceResource', () => {
  it('sends pagination defaults and preserves response metadata', async () => {
    const response: Paginated<Remittance> = {
      items: [],
      total: 41,
      page: 1,
      pageSize: 20,
    };
    const get = vi.fn().mockResolvedValue(response);
    const resource = new RemittanceResource({ get } as unknown as HttpClient);

    await expect(resource.list({ sender: 'sender-address' })).resolves.toBe(response);
    expect(get).toHaveBeenCalledWith('/remittance', {
      query: { sender: 'sender-address', page: 1, pageSize: 20 },
    });
  });

  it('sends explicit pagination values with remittance filters', async () => {
    const get = vi.fn().mockResolvedValue({ items: [], total: 0, page: 3, pageSize: 10 });
    const resource = new RemittanceResource({ get } as unknown as HttpClient);

    await resource.list({ recipient: 'recipient-address', page: 3, pageSize: 10 });

    expect(get).toHaveBeenCalledWith('/remittance', {
      query: { recipient: 'recipient-address', page: 3, pageSize: 10 },
    });
  });

  it('throws ValidationError when recipient is invalid', () => {
    const resource = new RemittanceResource({ post: vi.fn() } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    expect(() =>
      resource.buildSend({
        recipient: 'invalid-address',
        amount: '100',
        from: validAddress,
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when amount is invalid', () => {
    const resource = new RemittanceResource({ post: vi.fn() } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    expect(() =>
      resource.buildSend({
        recipient: validAddress,
        amount: 'not-a-number',
        from: validAddress,
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when from is invalid', () => {
    const resource = new RemittanceResource({ post: vi.fn() } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    expect(() =>
      resource.buildSend({
        recipient: validAddress,
        amount: '100',
        from: 'invalid-address',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts valid buildSend parameters', async () => {
    const post = vi.fn().mockResolvedValue({ xdr: 'test-xdr' });
    const resource = new RemittanceResource({ post } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.buildSend({
      recipient: validAddress,
      amount: '100.50',
      from: validAddress,
    });

    expect(post).toHaveBeenCalledWith('/remittance/build-send', {
      recipient: validAddress,
      amount: '100.50',
      from: validAddress,
    });
  });
});

describe('AuthResource', () => {
  it('throws ValidationError when publicKey is invalid in challenge', () => {
    const resource = new AuthResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() => resource.challenge('invalid-address')).toThrow(ValidationError);
  });

  it('accepts valid publicKey in challenge', async () => {
    const post = vi.fn().mockResolvedValue({ message: 'test', nonce: 'test', expiresAt: '' });
    const resource = new AuthResource({ post } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.challenge(validAddress);

    expect(post).toHaveBeenCalledWith('/auth/challenge', { publicKey: validAddress }, { anonymous: true });
  });

  it('throws ValidationError when publicKey is invalid in login', () => {
    const resource = new AuthResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() =>
      resource.login({
        publicKey: 'invalid-address',
        message: 'test-message',
        signature: 'test-signature',
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when message is invalid in login', () => {
    const resource = new AuthResource({ post: vi.fn() } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    expect(() =>
      resource.login({
        publicKey: validAddress,
        message: '',
        signature: 'test-signature',
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when signature is invalid in login', () => {
    const resource = new AuthResource({ post: vi.fn() } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    expect(() =>
      resource.login({
        publicKey: validAddress,
        message: 'test-message',
        signature: '',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts valid login parameters', async () => {
    const post = vi.fn().mockResolvedValue({ token: 'test', expiresAt: '', address: '', scopes: [] });
    const resource = new AuthResource({ post } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.login({
      publicKey: validAddress,
      message: 'test-message',
      signature: 'test-signature',
    });

    expect(post).toHaveBeenCalledWith(
      '/auth/login',
      {
        publicKey: validAddress,
        message: 'test-message',
        signature: 'test-signature',
      },
      { anonymous: true },
    );
  });
});

describe('LoansResource', () => {
  it('throws ValidationError when loanId is not positive in get', () => {
    const resource = new LoansResource({ get: vi.fn() } as unknown as HttpClient);

    expect(() => resource.get(-1)).toThrow(ValidationError);
    expect(() => resource.get('0')).toThrow(ValidationError);
    expect(() => resource.get('not-a-number')).toThrow(ValidationError);
  });

  it('accepts valid loanId in get', async () => {
    const get = vi.fn().mockResolvedValue({ id: 1 });
    const resource = new LoansResource({ get } as unknown as HttpClient);

    await resource.get(42);
    expect(get).toHaveBeenCalledWith('/loans/42');

    await resource.get('123');
    expect(get).toHaveBeenCalledWith('/loans/123');
  });

  it('throws ValidationError when loanId is invalid in buildRepay', () => {
    const resource = new LoansResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() => resource.buildRepay(-1, '100')).toThrow(ValidationError);
  });

  it('throws ValidationError when amount is invalid in buildRepay', () => {
    const resource = new LoansResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() => resource.buildRepay(1, 'not-a-number')).toThrow(ValidationError);
    expect(() => resource.buildRepay(1, '-100')).toThrow(ValidationError);
  });

  it('accepts valid buildRepay parameters', async () => {
    const post = vi.fn().mockResolvedValue({ xdr: 'test-xdr' });
    const resource = new LoansResource({ post } as unknown as HttpClient);

    await resource.buildRepay(42, '100.50');

    expect(post).toHaveBeenCalledWith('/loans/42/build-repay', { amount: '100.50' });
  });
});

describe('PoolResource', () => {
  it('throws ValidationError when address is invalid in depositor', () => {
    const resource = new PoolResource({ get: vi.fn() } as unknown as HttpClient);

    expect(() => resource.depositor('invalid-address')).toThrow(ValidationError);
  });

  it('accepts valid address in depositor', async () => {
    const get = vi.fn().mockResolvedValue({});
    const resource = new PoolResource({ get } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.depositor(validAddress);

    expect(get).toHaveBeenCalledWith(`/pool/depositor/${validAddress}`);
  });

  it('throws ValidationError when address is invalid in yieldHistory', () => {
    const resource = new PoolResource({ get: vi.fn() } as unknown as HttpClient);

    expect(() => resource.yieldHistory('invalid-address')).toThrow(ValidationError);
  });

  it('throws ValidationError when parameters are invalid in buildDeposit', () => {
    const resource = new PoolResource({ post: vi.fn() } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    expect(() =>
      resource.buildDeposit({
        token: 'invalid-token',
        amount: '100',
        from: validAddress,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      resource.buildDeposit({
        token: validAddress,
        amount: 'not-a-number',
        from: validAddress,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      resource.buildDeposit({
        token: validAddress,
        amount: '100',
        from: 'invalid-address',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts valid buildDeposit parameters', async () => {
    const post = vi.fn().mockResolvedValue({ xdr: 'test-xdr' });
    const resource = new PoolResource({ post } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.buildDeposit({
      token: validAddress,
      amount: '100.50',
      from: validAddress,
    });

    expect(post).toHaveBeenCalledWith('/pool/build-deposit', {
      token: validAddress,
      amount: '100.50',
      from: validAddress,
    });
  });

  it('accepts valid buildWithdraw parameters', async () => {
    const post = vi.fn().mockResolvedValue({ xdr: 'test-xdr' });
    const resource = new PoolResource({ post } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.buildWithdraw({
      token: validAddress,
      shares: '50.25',
      from: validAddress,
    });

    expect(post).toHaveBeenCalledWith('/pool/build-withdraw', {
      token: validAddress,
      shares: '50.25',
      from: validAddress,
    });
  });
});

describe('ScoresResource', () => {
  it('throws ValidationError when address is invalid in get', () => {
    const resource = new ScoresResource({ get: vi.fn() } as unknown as HttpClient);

    expect(() => resource.get('invalid-address')).toThrow(ValidationError);
  });

  it('accepts valid address in get', async () => {
    const get = vi.fn().mockResolvedValue({ score: 100 });
    const resource = new ScoresResource({ get } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.get(validAddress);

    expect(get).toHaveBeenCalledWith(`/scores/${validAddress}`);
  });
});