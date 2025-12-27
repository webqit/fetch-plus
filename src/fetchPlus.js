import { ResponsePlus } from './ResponsePlus.js';

export async function fetchPlus(url, options = {}) {
    const response = await fetch(url, options);
    ResponsePlus.upgradeInPlace(response);
    return response;
}