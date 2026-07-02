import { ResponsePlus } from './ResponsePlus.js';
import { LiveResponse } from './LiveResponse.js';

export async function fetchPlus(url, { live = false, ...options } = {}, originalFetch = fetch) {
    if (live) {
        const response = await originalFetch(url, {
            ...options,
            headers: {
                'X-Accept-Live': '*',
                ...options.headers,
            },
        });
        const liveResponse = new LiveResponse(response);
        return liveResponse;
    }
    const response = await originalFetch(url, options);
    ResponsePlus.upgradeInPlace(response);
    return response;
}