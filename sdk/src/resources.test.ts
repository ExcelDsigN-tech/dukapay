import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from './http.js';
import type { Paginated, Remittance } from './types.js';
import { RemittanceResource } from './resources.js';

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
});