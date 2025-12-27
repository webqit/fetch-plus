import { messageParserMixin, _meta, _wq } from './core.js';
import { HeadersPlus } from './HeadersPlus.js';

export class ResponsePlus extends messageParserMixin(Response) {

    constructor(body, init = {}) {
        super(body, init);
        HeadersPlus.upgradeInPlace(this.headers);
    }

    static upgradeInPlace(response) {
        Object.setPrototypeOf(response, ResponsePlus.prototype);
        HeadersPlus.upgradeInPlace(response.headers);
    }

    static from(body, { memoize = false, ...init } = {}) {
        if (body instanceof Response) return body;

        let $type, $body = body;
        if (body || body === 0) {
            let headers;
            ({ body, headers, $type } = super.from({ body, headers: init.headers }));
            init = { ...init, headers };
        }

        const instance = new this.constructor(body, init);

        if (memoize) {
            const cache = _meta(instance, 'cache');
            const typeMap = { json: 'json', FormData: 'formData', text: 'text', ArrayBuffer: 'arrayBuffer', Blob: 'blob', Bytes: 'bytes' };
            cache.set(typeMap[$type] || 'original', body);
        }

        return instance;
    }

    get status() {
        // Support framework-injected app-level 'status'
        return _meta(this).get('status') ?? super.status;
    }

    clone() {
        const clone = super.clone();
        ResponsePlus.upgradeInPlace(clone);

        const responseMeta = _meta(this);
        _wq(clone).set('meta', new Map(responseMeta));
        if (responseMeta.has('cache')) {
            responseMeta.set('cache', new Map(responseMeta.get('cache')));
        }

        return clone;
    }
}


